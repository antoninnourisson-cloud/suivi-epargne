// ================================================
// FILE: src/services/googleDriveService.ts
// Version web-only (PWA). Auth Google Identity Services + Drive/Gmail via fetch.
// ================================================

const CLIENT_ID = '763862877733-hl1an9vcn0ibnoq2iq035927528mimd5.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send';
const FILE_NAME = 'suivi_epargne.json';

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

// Callback déclenché quand la session est définitivement perdue (401 + refresh KO).
// L'UI s'y abonne pour afficher une bannière de reconnexion.
let onAuthLost: (() => void) | null = null;
export const setOnAuthLost = (cb: (() => void) | null) => { onAuthLost = cb; };

// --- INITIALISATION (web) ---
export const initGoogleApi = async (): Promise<void> => {
  return new Promise((resolve) => {
    const loadGapi = () => {
      (window as any).gapi.load('client', async () => {
        await (window as any).gapi.client.init({
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        gapiInited = true;
        check();
      });
    };
    const loadGis = () => {
      tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '',
      });
      gisInited = true;
      check();
    };
    const check = () => { if (gapiInited && gisInited) resolve(); };

    if ((window as any).gapi) loadGapi();
    if ((window as any).google) loadGis();
  });
};

// --- GESTION DU TOKEN ---
const storeToken = (resp: any) => {
  localStorage.setItem('google_token', JSON.stringify(resp));
  // Les expires_in de GIS valent ~3600s ; on garde une marge.
  const ttl = (resp.expires_in ? resp.expires_in : 3500) * 1000;
  localStorage.setItem('token_expiry', (Date.now() + ttl - 60_000).toString());
  localStorage.setItem('auth_persistence', 'true');
};

export const isTokenValid = (): boolean => {
  const expiry = localStorage.getItem('token_expiry');
  return expiry ? parseInt(expiry) > Date.now() : false;
};

// Demande un token. prompt='' réutilise le consentement déjà accordé (pas de
// ré-affichage de l'écran de consentement) ; prompt='none' = refresh silencieux.
const requestToken = (prompt: '' | 'none' | 'consent'): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!tokenClient) { reject(new Error('tokenClient not ready')); return; }
    tokenClient.callback = (resp: any) => {
      if (resp.error) { reject(resp); return; }
      storeToken(resp);
      resolve();
    };
    tokenClient.requestAccessToken({ prompt });
  });

// Connexion manuelle (bouton). prompt='' évite de redemander le consentement à
// chaque fois une fois qu'il a été donné.
export const handleAuthClick = async (silent: boolean = false): Promise<void> => {
  await requestToken(silent ? 'none' : '');
};

const refreshTokenSilently = (): Promise<void> => requestToken('none');

const getAccessToken = async (): Promise<string> => {
  const stored = localStorage.getItem('google_token');
  if (!stored) throw new Error('NO_TOKEN');
  if (!isTokenValid()) {
    // Tente un refresh silencieux avant d'échouer.
    await refreshTokenSilently();
  }
  return JSON.parse(localStorage.getItem('google_token') as string).access_token;
};

const handleAuthLost = () => {
  localStorage.removeItem('google_token');
  localStorage.removeItem('token_expiry');
  localStorage.removeItem('auth_persistence');
  if (onAuthLost) onAuthLost();
};

const ensureOk = async (res: Response): Promise<Response> => {
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  throw new Error(`Google API ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
};

// Fetch authentifié : injecte le token, retente une fois après refresh sur 401,
// et lève une erreur claire sinon (jamais de réponse d'erreur traitée comme data).
const authedFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const build = async () => {
    const token = await getAccessToken();
    return fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  };
  let res = await build();
  if (res.status === 401) {
    try {
      await refreshTokenSilently();
    } catch {
      handleAuthLost();
      throw new Error('SESSION_EXPIRED');
    }
    res = await build();
    if (res.status === 401) { handleAuthLost(); throw new Error('SESSION_EXPIRED'); }
  }
  return ensureOk(res);
};

// --- DÉCONNEXION ---
export const handleSignOut = async () => {
  const stored = localStorage.getItem('google_token');
  localStorage.removeItem('google_token');
  localStorage.removeItem('token_expiry');
  localStorage.removeItem('auth_persistence');
  try {
    if (stored) {
      const token = JSON.parse(stored).access_token;
      (window as any).google?.accounts?.oauth2?.revoke(token, () => {});
    }
    (window as any).gapi?.client?.setToken('');
  } catch { /* no-op */ }
};

// --- DRIVE ---
export const findConfigFile = async (): Promise<string | null> => {
  try {
    const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
    const res = await authedFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
    const data = await res.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
  } catch (e) {
    if (e instanceof Error && e.message === 'SESSION_EXPIRED') throw e;
    return null;
  }
};

export const readConfigFile = async (fileId: string): Promise<any> => {
  const res = await authedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return await res.json();
};

/**
 * Identifiant de la révision courante du contenu : sert à détecter les modifications
 * concurrentes (autre appareil) avant d'écraser.
 *
 * On utilise `headRevisionId` et SURTOUT PAS `version` : le champ `version` de Drive
 * compte toutes les mutations du fichier, métadonnées incluses, et il continue de
 * s'incrémenter tout seul quelques secondes APRÈS une écriture (mesuré : un simple
 * PATCH le fait passer de N à N+1 immédiatement, puis à N+2 ~2 s plus tard, sans
 * aucune intervention extérieure). Le relire juste après un PATCH donnait donc une
 * valeur périmée d'avance, et la sauvegarde suivante croyait détecter un autre
 * appareil → faux conflits à répétition sur un seul et même appareil.
 * `headRevisionId` ne change, lui, qu'à une vraie écriture de contenu.
 */
export const getFileRevision = async (fileId: string): Promise<string> => {
  const res = await authedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=headRevisionId`);
  const data = await res.json();
  return String(data.headRevisionId ?? '');
};

export const createConfigFile = async (data: any): Promise<string> => {
  const metadata = { name: FILE_NAME, mimeType: 'application/json' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));

  const res = await authedFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    body: form,
  });
  const result = await res.json();
  return result.id;
};

export class ConflictError extends Error {
  constructor() { super('CONFLICT'); this.name = 'ConflictError'; }
}

/**
 * Sauvegarde le fichier. Si expectedRevision est fourni et que la révision Drive a
 * changé entre-temps (écriture depuis un autre appareil), lève ConflictError au lieu
 * d'écraser. Retourne la nouvelle révision, lue directement dans la réponse du PATCH
 * (`fields=headRevisionId`) : c'est la valeur autoritative post-écriture, et ça évite
 * l'aller-retour supplémentaire que demandait l'ancienne relecture de version.
 */
export const updateConfigFile = async (
  fileId: string,
  data: any,
  expectedRevision?: string | null
): Promise<string> => {
  if (expectedRevision != null && expectedRevision !== '') {
    const current = await getFileRevision(fileId);
    if (current && current !== expectedRevision) throw new ConflictError();
  }
  const res = await authedFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=headRevisionId`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data, null, 2),
    }
  );
  const result = await res.json();
  return String(result.headRevisionId ?? '');
};

// --- GMAIL ---
export const sendGmail = async (to: string, subject: string, body: string): Promise<void> => {
  try {
    const utf8Subject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
    const message = [`To: ${to}`, 'Content-Type: text/html; charset=utf-8', 'MIME-Version: 1.0', `Subject: ${utf8Subject}`, '', body].join('\n');
    const raw = btoa(unescape(encodeURIComponent(message))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await authedFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
  } catch (e) {
    console.error('Erreur mail', e);
  }
};
