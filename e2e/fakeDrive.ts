// Faux Google Drive (et faux serveur) pour les tests de bout en bout SANS le mode démo : les
// requêtes de l'app vers www.googleapis.com et vers le Worker sont interceptées (page.route)
// et servies depuis la mémoire. L'app suit donc son vrai chemin de synchronisation :
// recherche du fichier, révision, lecture, écriture vérifiée, copie mensuelle.
//
// Session : un jeton Google valide est posé sur l'appareil, plus une session serveur (le build
// de production est relié au Worker ; en développement, sans serveur, elle est ignorée).
import type { Page, Route } from '@playwright/test';
import { LATEST_VERSION } from '../src/changelog';
import { DEMO_DATA } from '../src/dev/demoData';
import { WORKER_ORIGIN } from './target';

export const FILE_ID = 'file-e2e';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE',
};

type Data = typeof DEMO_DATA;
const copyOf = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** Données de démonstration avec le LDDS à `amount` €. */
export const withLdds = (amount: number, base: Data = DEMO_DATA): Data => {
  const d = copyOf(base);
  const ldds = d.accounts.find(a => a.name === 'LDDS')!;
  ldds.totalAmount = amount;
  ldds.ownedAmount = amount;
  return d;
};
export const lddsOf = (data: unknown): number | undefined =>
  (data as { accounts?: { name: string; totalAmount: number }[] } | null)?.accounts?.find(a => a.name === 'LDDS')?.totalAmount;

export interface FakeDrive {
  /** Contenu et révision en tête du fichier. */
  content: unknown;
  head: string;
  modifiedTime: string;
  revisions: { id: string; modifiedTime: string; content: unknown }[];
  /** Contenus écrits par l'app (PATCH du fichier de données), dans l'ordre. */
  writes: unknown[];
  /** Statut renvoyé à la place des réponses de Drive (0 = normal). */
  failStatus: number;
  /** Drive refuse le jeton (401) ; le serveur refuse aussi d'en donner un nouveau. */
  sessionRevoked: boolean;
  /** Écriture d'un autre appareil : nouvelle révision en tête. */
  remoteWrite: (content: unknown) => void;
}

export const installFakeDrive = async (page: Page, initial: unknown = DEMO_DATA, opts: { localStorage?: Record<string, string> } = {}): Promise<FakeDrive> => {
  const drive: FakeDrive = {
    content: copyOf(initial),
    head: 'r1',
    modifiedTime: '2026-10-18T19:00:00.000Z',
    revisions: [{ id: 'r1', modifiedTime: '2026-10-18T19:00:00.000Z', content: copyOf(initial) }],
    writes: [],
    failStatus: 0,
    sessionRevoked: false,
    remoteWrite(content) {
      const id = `r${this.revisions.length + 1}`;
      this.modifiedTime = new Date(Date.parse(this.modifiedTime) + 60_000).toISOString();
      this.revisions.push({ id, modifiedTime: this.modifiedTime, content: copyOf(content) });
      this.head = id;
      this.content = copyOf(content);
    },
  };

  // SDK Google : jamais chargés pendant ces parcours (sauf Google Identity Services pour un
  // rafraîchissement sans serveur, refusé comme une session révoquée).
  await page.route(/^https:\/\/apis\.google\.com\//, route => route.abort());
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
    contentType: 'text/javascript', headers: CORS,
    body: `window.google = { accounts: { oauth2: {
      initTokenClient: () => { const c = { callback: '', requestAccessToken() { setTimeout(() => c.callback({ error: 'interaction_required' }), 0); } }; return c; },
      revoke() {},
    } } };`,
  }));

  // Serveur (build de production) : jeton refusé si la session est révoquée ; rien d'autre.
  await page.route(WORKER_ORIGIN, (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (new URL(req.url()).pathname === '/token') {
      return drive.sessionRevoked
        ? route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: '{"error":"REAUTH_REQUIRED"}' })
        : route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"access_token":"e2e","expires_in":3599}' });
    }
    return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"error":"NOT_FOUND"}' });
  });

  await page.route(/^https:\/\/www\.googleapis\.com\//, async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = decodeURIComponent(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (drive.sessionRevoked) return json({ error: { code: 401, errors: [{ reason: 'authError' }] } }, 401);
    if (drive.failStatus) return json({ error: { code: drive.failStatus, errors: [{ reason: 'backendError' }] } }, drive.failStatus);

    // Copies mensuelles (fichiers à part) : liste vide, création acceptée.
    if (url.includes('suivi_epargne_backup_')) return json({ files: [] });
    if (method === 'POST' && url.includes('/upload/drive/v3/files?uploadType=multipart')) return json({ id: `copie-${Date.now()}` });
    // Écriture du fichier de données.
    if (method === 'PATCH' && url.includes(`/upload/drive/v3/files/${FILE_ID}`)) {
      const content = JSON.parse(req.postData() ?? 'null');
      drive.writes.push(content);
      drive.remoteWrite(content);
      return json({ headRevisionId: drive.head });
    }
    const rev = url.match(/\/revisions\/([^?]+)/);
    if (rev) {
      const r = drive.revisions.find(x => x.id === rev[1]);
      if (!r) return json({ error: { code: 404 } }, 404);
      return method === 'PATCH' ? json({ id: r.id }) : json(r.content);
    }
    if (url.includes(`/files/${FILE_ID}/revisions`)) return json({ revisions: drive.revisions.map(r => ({ id: r.id, modifiedTime: r.modifiedTime })) });
    if (url.includes(`/files/${FILE_ID}?alt=media`)) return json(drive.content);
    if (url.includes(`/files/${FILE_ID}?fields=`)) return json({ headRevisionId: drive.head, modifiedTime: drive.modifiedTime });
    if (url.includes('/drive/v3/files?')) {
      return json({ files: [{ id: FILE_ID, name: 'suivi_epargne.json', createdTime: '2026-01-01T00:00:00.000Z', modifiedTime: drive.modifiedTime, headRevisionId: drive.head }] });
    }
    return json({ error: { code: 404 } }, 404);
  });

  await page.addInitScript(({ version, extra }) => {
    // Une seule fois par onglet : un rechargement garde ce que l'app a écrit entre-temps.
    if (sessionStorage.getItem('e2e_seeded')) return;
    sessionStorage.setItem('e2e_seeded', '1');
    localStorage.setItem('last_seen_version', version);
    localStorage.setItem('google_token', JSON.stringify({ access_token: 'e2e' }));
    localStorage.setItem('token_expiry', String(Date.now() + 3_600_000));
    localStorage.setItem('auth_persistence', 'true');
    localStorage.setItem('backend_session', 'e2e-session');
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
  }, { version: LATEST_VERSION, extra: opts.localStorage ?? {} });
  return drive;
};

/** Ajoute un dépôt de `amount` € sur le LDDS (bouton flottant). */
export const addLddsDeposit = async (page: Page, amount: number) => {
  await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
  await dialog.getByLabel('Compte').selectOption({ label: 'LDDS' });
  await dialog.getByLabel('Montant').fill(String(amount));
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
};
