// Démarrage hors ligne, sans le mode démo : une session et la copie hors ligne sont sur
// l'appareil, Drive est injoignable. L'app s'ouvre aussitôt sur les dernières données avec un
// bandeau « Hors ligne », garde une saisie sur l'appareil, puis l'envoie à Drive (avec
// contrôle de révision) quand Drive répond de nouveau. Aucun SDK Google n'est chargé.
import { test, expect, type Route } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';
import { DEMO_DATA } from '../src/dev/demoData';
import { WORKER_ORIGIN } from './target';

const FILE_ID = 'file-e2e';
// Dernière synchronisation : 18 octobre, 21 h 04 à Paris.
const COPY = { savedAt: '2026-10-18T19:04:00.000Z', fileId: FILE_ID, data: DEMO_DATA };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH',
};

test.describe('Démarrage hors ligne', () => {
  test('les dernières données tout de suite, la saisie part au retour de Drive', async ({ page }) => {
    const drive = { up: false, head: 'r1', patches: [] as unknown[] };
    const sdkRequests: string[] = [];
    await page.route(/^https:\/\/(accounts|apis)\.google\.com\//, route => { sdkRequests.push(route.request().url()); return route.abort(); });
    // Build de production (relié au serveur) : le jeton est encore valide, le serveur n'a pas
    // à être appelé ; jamais le vrai depuis les tests.
    await page.route(WORKER_ORIGIN, route => route.abort('internetdisconnected'));
    // Faux Drive : injoignable, puis de retour avec le fichier tel que la copie le connaît.
    await page.route(/^https:\/\/www\.googleapis\.com\//, async (route: Route) => {
      if (!drive.up) return route.abort('internetdisconnected');
      const req = route.request();
      const url = decodeURIComponent(req.url());
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (req.method() === 'PATCH' && url.includes('/upload/')) {
        drive.patches.push(JSON.parse(req.postData() ?? 'null'));
        drive.head = `r${drive.patches.length + 1}`;
        return json({ headRevisionId: drive.head });
      }
      if (req.method() === 'POST') return json({ id: 'monthly-copy' }); // copie mensuelle
      if (url.includes('/revisions')) return json({ revisions: [{ id: 'r1', modifiedTime: '2026-10-18T19:00:00Z' }, ...drive.patches.map((_, i) => ({ id: `r${i + 2}`, modifiedTime: '2026-10-19T08:00:00Z' }))] });
      if (url.includes('alt=media')) return json(DEMO_DATA);
      if (url.includes(`/files/${FILE_ID}?fields=`)) return json({ headRevisionId: drive.head, modifiedTime: '2026-10-18T19:00:00Z' });
      if (url.includes("suivi_epargne_backup_")) return json({ files: [] });
      if (url.includes('/drive/v3/files?')) return json({ files: [{ id: FILE_ID, name: 'suivi_epargne.json', modifiedTime: '2026-10-18T19:00:00Z', headRevisionId: drive.head }] });
      return route.fulfill({ status: 404, headers: CORS, body: '{}' });
    });
    await page.addInitScript(({ version, copy }) => {
      localStorage.setItem('last_seen_version', version);
      localStorage.setItem('google_token', JSON.stringify({ access_token: 'e2e' }));
      localStorage.setItem('token_expiry', String(Date.now() + 3_600_000));
      localStorage.setItem('auth_persistence', 'true');
      localStorage.setItem('backend_session', 'e2e-session'); // ignorée sans serveur (développement)
      // Pas encore ouverte (miroir de la session précédente) : pas d'écrasement au rechargement.
      if (!localStorage.getItem('pecule_offline_copy')) localStorage.setItem('pecule_offline_copy', JSON.stringify(copy));
    }, { version: LATEST_VERSION, copy: COPY });

    await page.goto('/');
    const banner = page.getByRole('status').filter({ hasText: 'Hors ligne : données du 18 octobre à 21:04' });
    // Le serveur de développement compile les modules à la première visite : marge.
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();

    // Saisie hors ligne : gardée sur l'appareil, rien n'est envoyé.
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await dialog.getByLabel('Compte').selectOption({ label: 'LDDS' });
    await dialog.getByLabel('Montant').fill('123');
    await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(2500);
    expect(drive.patches).toHaveLength(0);

    // Drive répond de nouveau : chargement, puis envoi de la saisie (Drive n'a pas changé).
    drive.up = true;
    await banner.getByRole('button', { name: 'Réessayer' }).click();
    await expect(banner).toBeHidden();
    await expect.poll(() => drive.patches.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    const ldds = (drive.patches[drive.patches.length - 1] as { accounts: { name: string; totalAmount: number }[] }).accounts.find(a => a.name === 'LDDS');
    expect(ldds?.totalAmount).toBe(3123);
    expect(sdkRequests).toEqual([]);
  });
});
