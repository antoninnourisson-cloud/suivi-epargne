// Sécurité côté serveur, contre un faux Drive et un faux serveur (build de production
// seulement : en développement, l'app n'est reliée à aucun serveur) :
// - la session se lie à l'appareil (POST /auth/bind), puis chaque requête est signée sur le
//   nonce rendu par le serveur (en-tête X-Pecule-Nonce) ;
// - « Appareils connectés » : déconnecter un appareil qu'on ne reconnaît pas ;
// - effacement des copies de secours programmé : annoncé en haut de l'app, annulable ;
// - sauvegarde de secours : le code n'est activé qu'après en avoir recopié deux groupes.
import { test, expect, type Page, type Route } from './fixtures';
import { installFakeDrive } from './fakeDrive';
import { E2E_BUILD, WORKER_ORIGIN } from './target';

// Nonce rendu avec chaque réponse, comme le vrai serveur (lisible par l'app grâce à Expose-Headers).
const NONCE = 'N'.repeat(43);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-pecule-proof',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
  'Access-Control-Expose-Headers': 'x-pecule-nonce',
  'X-Pecule-Nonce': NONCE,
};

interface FakeServer {
  calls: { method: string; path: string; proof: string | null }[];
  sessions: { id: string; device: string | null; current: boolean }[];
  backups: string[];
  deletion: { requestedAt: string; purgeAt: string } | null;
}

/** Faux serveur pour les routes de ce parcours ; le reste (/token) passe au faux Drive. */
const installFakeServer = async (page: Page): Promise<FakeServer> => {
  const server: FakeServer = {
    calls: [],
    sessions: [
      { id: 'cet-appareil', device: 'téléphone Android (Chrome)', current: true },
      { id: 'inconnu', device: null, current: false },
    ],
    backups: [],
    deletion: null,
  };
  await page.route(WORKER_ORIGIN, async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    server.calls.push({ method: req.method(), path, proof: await req.headerValue('x-pecule-proof') });
    if (path === '/auth/bind') return json({ ok: true, bound: true });
    if (path === '/auth/sessions') {
      return json({ sessions: server.sessions.map(s => ({ ...s, createdAt: '2026-10-01T08:00:00.000Z', lastUsedAt: '2026-10-19T08:00:00.000Z', bound: true })) });
    }
    if (path === '/auth/sessions/revoke') {
      const { id } = req.postDataJSON() as { id: string };
      server.sessions = server.sessions.filter(s => s.id !== id);
      return json({ ok: true, current: false });
    }
    if (path === '/push/devices') return json({ devices: [] });
    if (path === '/health') return json({ lastRunAt: null, ok: null });
    if (path === '/backup/deletion' && req.method() === 'GET') return json({ deletion: server.deletion });
    if (path === '/backup/deletion' && req.method() === 'DELETE') { const cancelled = !!server.deletion; server.deletion = null; return json({ ok: true, cancelled }); }
    if (path === '/backup' && req.method() === 'GET') return json({ dates: server.backups, ...(server.deletion ? { deletion: server.deletion } : {}) });
    if (path === '/backup' && req.method() === 'PUT') { server.backups.unshift('2026-10-20'); return json({ ok: true, date: '2026-10-20', dates: server.backups }); }
    return route.fallback();
  });
  return server;
};

test.describe('Sécurité du serveur (faux serveur)', () => {
  test.skip(!E2E_BUILD, 'build de production seulement (relié au serveur)');

  test('appareils connectés : la session se lie à l’appareil, puis un appareil inconnu est déconnecté', async ({ page }) => {
    await installFakeDrive(page);
    const server = await installFakeServer(page);
    await page.goto('/?view=settings&section=account');
    const list = page.getByRole('list', { name: 'Appareils connectés' });
    await expect(list.getByRole('listitem')).toHaveCount(2, { timeout: 20_000 });
    await expect(list.getByRole('listitem').first()).toContainText('(cet appareil)');

    await page.getByRole('button', { name: "Déconnecter l'appareil inconnu" }).click();
    await page.getByRole('button', { name: 'Confirmer' }).click();
    await expect(page.getByText('Appareil déconnecté')).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(1);

    // Liaison faite une fois, avant toute autre requête ; ensuite, tout est signé sur le nonce
    // rendu par le serveur.
    expect(server.calls.filter(c => c.path === '/auth/bind')).toHaveLength(1);
    const signed = server.calls.filter(c => c.path.startsWith('/auth/sessions'));
    expect(signed.length).toBeGreaterThanOrEqual(3);
    for (const c of signed) expect(c.proof, `${c.method} ${c.path}`).toMatch(new RegExp(`^${NONCE}\\.[A-Za-z0-9_-]{86}$`));
  });

  test('effacement des copies programmé : annoncé en haut de l’app, annulable sur place', async ({ page }) => {
    await installFakeDrive(page);
    const server = await installFakeServer(page);
    server.backups = ['2026-10-12'];
    server.deletion = { requestedAt: '2026-10-20T10:00:00.000Z', purgeAt: '2026-10-27T10:00:00.000Z' };
    await page.goto('/');
    const banner = page.getByTestId('backup-deletion-notice');
    await expect(banner).toContainText('Vos copies de secours seront effacées le 27 octobre', { timeout: 20_000 });
    await banner.getByRole('button', { name: "Annuler l'effacement" }).click();
    await expect(banner).toHaveCount(0);
    expect(server.deletion).toBeNull();
    const cancel = server.calls.find(c => c.method === 'DELETE' && c.path === '/backup/deletion');
    expect(cancel?.proof).toMatch(new RegExp(`^${NONCE}\\.`));
  });

  test('sauvegarde de secours : activation seulement après avoir recopié deux groupes du code', async ({ page }) => {
    await installFakeDrive(page);
    const server = await installFakeServer(page);
    await page.goto('/?view=settings&section=data');
    await page.getByRole('button', { name: 'Activer', exact: true }).click({ timeout: 20_000 });
    const code = (await page.getByTestId('recovery-code').textContent())!;
    await page.getByRole('button', { name: "Je l'ai mis en lieu sûr" }).click();
    await expect(page.getByTestId('recovery-code')).toHaveCount(0);

    const fields = page.getByLabel(/^Groupe n° \d$/);
    await expect(fields).toHaveCount(2);
    // Mauvaise saisie : rien n'est activé.
    await fields.nth(0).fill('ZZZZ');
    await fields.nth(1).fill('ZZZZ');
    await page.getByRole('button', { name: 'Vérifier et activer' }).click();
    await expect(page.getByText(/Ce n'est pas ce qui était affiché/)).toBeVisible();
    expect(server.calls.some(c => c.method === 'PUT')).toBe(false);

    for (const i of [0, 1]) {
      const label = await fields.nth(i).evaluate(el => (el as HTMLInputElement).labels?.[0]?.textContent ?? '');
      const n = Number(/\d/.exec(label)![0]);
      await fields.nth(i).fill(code.split('-')[n - 1]);
    }
    await page.getByRole('button', { name: 'Vérifier et activer' }).click();
    await expect(page.getByText('Sauvegarde de secours activée et première copie envoyée')).toBeVisible();
    expect(server.calls.filter(c => c.method === 'PUT' && c.path === '/backup')).toHaveLength(1);
  });
});
