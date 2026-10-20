// ================================================
// FILE: src/services/googleDriveService.ts
// Version web-only (PWA). Auth Google Identity Services + Drive via fetch.
// ================================================

import {
  isBackendEnabled, hasBackendSession, fetchAccessToken, startBackendLogin, backendLogout, consumeLoginCode,
  saveBackendSession, type LoginOptions,
} from './backendService';
import { verifyWriteChain, RevisionEntry } from '../lib/driveWriteCheck';

const CLIENT_ID = '763862877733-hl1an9vcn0ibnoq2iq035927528mimd5.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'suivi_epargne.json';

// Types minimaux des SDK Google (gapi pour le Picker, GIS pour la connexion sans serveur) :
// uniquement ce que l'app utilise. Ils sont chargés à la demande (voir loadScript).
interface TokenResponse { access_token?: string; expires_in?: number; error?: string }
type TokenCallback = ((resp: TokenResponse) => void) | '';
interface TokenClient { callback: TokenCallback; requestAccessToken: (opts: { prompt: string }) => void }
interface Gapi {
  load: (lib: string, cb: (() => void) | { callback: () => void; onerror: (e?: unknown) => void }) => void;
}
interface PickerCallbackData { action: string; docs?: { id: string; name: string; mimeType: string }[] }
interface PickerDocsView {
  setMimeTypes: (types: string) => PickerDocsView;
  setIncludeFolders: (on: boolean) => PickerDocsView;
  setSelectFolderEnabled: (on: boolean) => PickerDocsView;
}
interface PickerBuilder {
  addView: (view: PickerDocsView) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setCallback: (cb: (data: PickerCallbackData) => void) => PickerBuilder;
  build: () => { setVisible: (on: boolean) => void };
}
interface PickerApi {
  DocsView: new (viewId: string) => PickerDocsView;
  ViewId: { DOCS: string };
  PickerBuilder: new () => PickerBuilder;
  Action: { PICKED: string; CANCEL: string };
}
interface GoogleSdk {
  accounts: { oauth2: {
    initTokenClient: (opts: { client_id: string; scope: string; callback: TokenCallback; include_granted_scopes?: boolean }) => TokenClient;
    revoke: (token: string, done: () => void) => void;
  } };
  picker: PickerApi;
}
interface GoogleGlobals { gapi: Gapi; google: GoogleSdk }
const googleWindow = () => window as unknown as Partial<GoogleGlobals>;

let tokenClient: TokenClient | undefined;

// Callback déclenché quand la session est définitivement perdue (401 + refresh KO).
// L'UI s'y abonne pour afficher une bannière de reconnexion.
let onAuthLost: (() => void) | null = null;
export const setOnAuthLost = (cb: (() => void) | null) => { onAuthLost = cb; };

// --- SDK GOOGLE, CHARGÉS À LA DEMANDE ---
// Plus aucun <script> Google dans index.html : toutes les requêtes Drive passent par fetch.
// En mode serveur, rien n'en a besoin au démarrage (environ 260 Kio et 1 à 2 s gagnés à
// chaque ouverture, et l'app démarre hors ligne). GIS ne sert qu'à la connexion sans serveur,
// api.js qu'au Google Picker (dons, fiches de paie). La CSP d'index.html (script-src)
// autorise toujours ces deux origines.
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
// Délai maximal de chargement d'un SDK : au-delà, on échoue avec un message plutôt que de
// laisser l'écran en attente.
const SDK_WAIT_TIMEOUT_MS = 20_000;

/** Échec de chargement d'un SDK Google : traité comme un problème réseau (TypeError). */
const sdkUnavailable = (what: string) => new TypeError(`GOOGLE_SDK_UNAVAILABLE:${what}`);

const scriptLoads = new Map<string, Promise<void>>();
/** Insère le script une seule fois ; un échec (hors ligne, bloqueur) laisse réessayer plus tard. */
const loadScript = (src: string): Promise<void> => {
  const pending = scriptLoads.get(src);
  if (pending) return pending;
  const loading = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    const timer = setTimeout(() => fail(), SDK_WAIT_TIMEOUT_MS);
    const fail = () => { clearTimeout(timer); el.remove(); reject(sdkUnavailable(src)); };
    el.onload = () => { clearTimeout(timer); resolve(); };
    el.onerror = fail;
    document.head.appendChild(el);
  });
  scriptLoads.set(src, loading);
  loading.catch(() => { if (scriptLoads.get(src) === loading) scriptLoads.delete(src); });
  return loading;
};

/** Attend qu'un objet défini par un SDK soit disponible (il l'est d'ordinaire dès le chargement). */
const waitFor = <T,>(get: () => T | undefined, what: string, timeoutMs = SDK_WAIT_TIMEOUT_MS): Promise<T> =>
  new Promise((resolve, reject) => {
    const existing = get();
    if (existing) { resolve(existing); return; }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const value = get();
      if (value) { clearInterval(timer); resolve(value); return; }
      if (Date.now() - startedAt >= timeoutMs) { clearInterval(timer); reject(sdkUnavailable(what)); }
    }, 100);
  });

let tokenClientLoad: Promise<TokenClient> | null = null;
/** Client de jeton de Google Identity Services (connexion sans serveur), chargé au premier besoin. */
const ensureTokenClient = (): Promise<TokenClient> => {
  if (tokenClient) return Promise.resolve(tokenClient);
  if (!tokenClientLoad) {
    tokenClientLoad = (async () => {
      await loadScript(GIS_SRC);
      const oauth2 = await waitFor(() => googleWindow().google?.accounts?.oauth2, 'gis');
      tokenClient = oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        // Seulement drive.file : sans ça, Google rajoute les autorisations accordées autrefois
        // (gmail.send) et affiche « Google n'a pas validé cette application ».
        include_granted_scopes: false,
        callback: '',
      });
      return tokenClient;
    })();
    tokenClientLoad.catch(() => { tokenClientLoad = null; });
  }
  return tokenClientLoad;
};

/**
 * Prépare le bouton de connexion. Mode serveur : rien à charger (la connexion est une
 * redirection vers le Worker). Sans serveur : charge Google Identity Services.
 */
export const initGoogleApi = async (): Promise<void> => {
  if (isBackendEnabled()) return;
  await ensureTokenClient();
};

// --- GESTION DU TOKEN ---
const storeToken = (resp: TokenResponse) => {
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
//
// `tokenClient.callback` est un champ UNIQUE et partagé : deux requestToken concurrents
// se marchent dessus, le second écrasant le callback du premier, dont la promesse ne se
// règle alors jamais (ni resolve ni reject). Symptôme observé : une sauvegarde figée
// indéfiniment, `isSaving` collé à true, sans aucune erreur remontée. On ajoute donc un
// timeout pour qu'une promesse orpheline échoue au lieu de pendre pour toujours.
const TOKEN_TIMEOUT_MS = 30_000;
const requestToken = async (prompt: '' | 'none' | 'consent' | 'select_account consent'): Promise<void> => {
  // GIS chargé au premier besoin ; un échec de chargement remonte en TypeError (« hors ligne »).
  const client = await ensureTokenClient();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('TOKEN_REQUEST_TIMEOUT'));
    }, TOKEN_TIMEOUT_MS);
    client.callback = (resp: TokenResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (resp.error) { reject(resp); return; }
      // storeToken fait des localStorage.setItem qui PEUVENT jeter (mode privé Safari,
      // quota plein, stockage désactivé). `settled` étant déjà true et le timer annulé,
      // une exception qui s'échapperait ici laisserait la promesse pendante à jamais —
      // login gelé et tous les appels Drive suivants bloqués derrière refreshInFlight.
      try {
        storeToken(resp);
      } catch {
        reject(new Error('TOKEN_STORAGE_FAILED'));
        return;
      }
      resolve();
    };
    client.requestAccessToken({ prompt });
  });
};

// Connexion manuelle (bouton). prompt='' évite de redemander le consentement à
// chaque fois une fois qu'il a été donné. `chooseAccount` (réinitialisation du verrou de
// l'appareil) : choix du compte et consentement toujours affichés, jamais de connexion
// silencieuse au compte déjà ouvert dans le navigateur.
export const handleAuthClick = async (silent: boolean = false, opts: LoginOptions = {}): Promise<void> => {
  if (isBackendEnabled()) {
    // Mode serveur : silencieux = le Worker émet un jeton frais à partir du refresh token ;
    // sinon, redirection vers la connexion Google (la page quitte l'app, d'où la promesse
    // jamais résolue — le retour recharge tout).
    if (silent) return refreshTokenSilently();
    startBackendLogin(opts);
    return new Promise<void>(() => {});
  }
  await requestToken(silent ? 'none' : opts.chooseAccount ? 'select_account consent' : '');
};

/** Cet appareil garde-t-il de quoi accéder à Drive (jeton Google ou session serveur) ? */
export const hasStoredSession = (): boolean => {
  try { if (localStorage.getItem('google_token')) return true; } catch { /* stockage bloqué */ }
  return isBackendEnabled() && hasBackendSession();
};

/**
 * Mode serveur : finalise une connexion si l'URL porte le code de retour du Worker.
 * Renvoie true si une session vient d'être ouverte.
 */
export const completeBackendLoginIfPresent = async (): Promise<boolean> => {
  if (!isBackendEnabled()) return false;
  const result = await consumeLoginCode();
  if (!result) return false;
  storeToken({ access_token: result.access_token, expires_in: result.expires_in });
  saveBackendSession(result.session);
  return true;
};

// Rafraîchissement mutualisé : plusieurs appels concurrents (ex. une sauvegarde Drive et
// une lecture qui partent ensemble sur un token expiré) doivent partager UNE seule
// requête en vol, sinon ils s'écrasent mutuellement le callback ci-dessus.
let refreshInFlight: Promise<void> | null = null;
const refreshTokenSilently = (): Promise<void> => {
  if (!refreshInFlight) {
    // Mode serveur : le jeton vient du Worker (refresh token longue durée), plus de l'iframe
    // silencieuse de GIS — celle qui échouait régulièrement en PWA et forçait à se reconnecter.
    const pending = isBackendEnabled() ? fetchAccessToken().then(storeToken) : requestToken('none');
    refreshInFlight = pending.finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
};

/**
 * Au démarrage, la session de cet appareil est-elle utilisable ?
 * - 'ready' : jeton valide (ou rafraîchi), Drive peut être chargé ;
 * - 'offline' : session gardée, mais réseau ou serveur injoignable : l'app s'ouvre sur la
 *   dernière copie connue (voir usePortfolioData) et recharge Drive au retour du réseau ;
 * - 'signed-out' : aucune session, ou session refusée : écran de connexion.
 * Aucun SDK Google n'est attendu en mode serveur, et rien n'est tenté hors ligne.
 * Lève une TypeError si le code de retour de connexion n'a pas pu être échangé faute de
 * réseau alors qu'aucune session n'existait.
 * `onNewLogin` : appelé quand une connexion vient d'aboutir (code de retour du Worker),
 * peut-être avec un autre compte Google que la session précédente.
 */
export type SessionStart = 'ready' | 'offline' | 'signed-out';
export const resumeSession = async (opts: { onNewLogin?: () => void } = {}): Promise<SessionStart> => {
  if (isBackendEnabled()) {
    try {
      if (await completeBackendLoginIfPresent()) { opts.onNewLogin?.(); return 'ready'; }
    } catch (e) {
      // Code de connexion refusé ou serveur injoignable : une session plus ancienne reste utilisable.
      if (!hasBackendSession()) throw e;
    }
    if (!hasBackendSession()) return 'signed-out';
  } else {
    let persisted = false;
    try { persisted = !!localStorage.getItem('google_token') && localStorage.getItem('auth_persistence') === 'true'; } catch { /* stockage bloqué */ }
    if (!persisted) return 'signed-out';
  }
  if (isTokenValid()) return 'ready';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  try {
    await refreshTokenSilently();
    return 'ready';
  } catch (e) {
    // Réseau, serveur ou SDK injoignable : la session n'est pas en cause.
    return e instanceof TypeError ? 'offline' : 'signed-out';
  }
};

// Exporté pour le Google Picker (voir openDrivePicker), qui a besoin du token courant
// pour n'afficher/autoriser que ce à quoi le compte connecté a accès.
const getAccessToken = async (): Promise<string> => {
  const stored = localStorage.getItem('google_token');
  if (!stored && !(isBackendEnabled() && hasBackendSession())) throw new Error('NO_TOKEN');
  if (!stored || !isTokenValid()) {
    // Tente un refresh silencieux avant d'échouer.
    await refreshTokenSilently();
  }
  // Relecture APRÈS l'await : si handleAuthLost/handleSignOut a purgé le token dans
  // l'intervalle, JSON.parse(null) jetait un TypeError — que le chemin de sauvegarde
  // classait à tort comme "hors ligne" (il réserve TypeError aux échecs réseau de fetch),
  // gelant l'autosave sans aucune bannière. On lève une erreur explicitement typée.
  const fresh = localStorage.getItem('google_token');
  if (!fresh) throw new Error('SESSION_EXPIRED');
  return JSON.parse(fresh).access_token;
};

const handleAuthLost = () => {
  localStorage.removeItem('google_token');
  localStorage.removeItem('token_expiry');
  localStorage.removeItem('auth_persistence');
  if (onAuthLost) onAuthLost();
};

// Erreur d'API portant le statut HTTP : permet aux appelants de réagir différemment à un
// 404 (fichier supprimé côté Drive → re-résolution) qu'à un 500 (bannière d'erreur).
// `reason` : la raison donnée par Drive (`error.errors[0].reason`, ex. storageQuotaExceeded,
// userRateLimitExceeded) : elle distingue une panne passagère d'un blocage durable (voir
// src/lib/syncErrors.ts).
export class ApiError extends Error {
  status: number;
  reason?: string;
  constructor(message: string, status: number, reason?: string) { super(message); this.name = 'ApiError'; this.status = status; this.reason = reason; }
}

/** Raison d'erreur dans le corps d'une réponse Drive (`{ error: { errors: [{ reason }] } }`). */
export const driveErrorReason = (body: string): string | undefined => {
  try {
    const err = (JSON.parse(body) as { error?: { errors?: { reason?: unknown }[]; status?: unknown } }).error;
    const reason = err?.errors?.[0]?.reason ?? err?.status;
    return typeof reason === 'string' && reason ? reason : undefined;
  } catch { return undefined; }
};

const ensureOk = async (res: Response): Promise<Response> => {
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  throw new ApiError(`Google API ${res.status} ${res.statusText} — ${body.slice(0, 300)}`, res.status, driveErrorReason(body));
};

// Toute requête a un délai maximal : sans lui, un fetch qui pend (portail captif, TLS
// bloqué) laissait le mutex de sauvegarde occupé POUR TOUJOURS — plus aucune écriture
// Drive ne partait, isSaving restait allumé, zéro message. AbortError est converti en
// TypeError pour rejoindre le chemin "problème réseau" existant des appelants.
const FETCH_TIMEOUT_MS = 30_000;
const fetchWithTimeout = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e: unknown) {
    if ((e as { name?: string } | null)?.name === 'AbortError') throw new TypeError('NETWORK_TIMEOUT');
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// Fetch authentifié : injecte le token, retente une fois après refresh sur 401,
// et lève une erreur claire sinon (jamais de réponse d'erreur traitée comme data).
const authedFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const build = async () => {
    const token = await getAccessToken();
    return fetchWithTimeout(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  };
  let res = await build();
  if (res.status === 401) {
    try {
      await refreshTokenSilently();
    } catch (e) {
      // Réseau/serveur injoignable (TypeError) : c'est « hors ligne », pas une session
      // perdue — sinon une simple coupure pendant un rafraîchissement déconnectait.
      if (e instanceof TypeError) throw e;
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
  if (isBackendEnabled()) {
    // Surtout PAS de révocation Google ici : révoquer un jeton d'accès révoque tout
    // l'accord, refresh token du serveur compris — ce qui déconnecterait aussi les AUTRES
    // appareils. On ferme uniquement la session de cet appareil.
    await backendLogout();
    return;
  }
  try {
    if (stored) {
      const token = JSON.parse(stored).access_token as string;
      const oauth2 = googleWindow().google?.accounts?.oauth2;
      if (oauth2) oauth2.revoke(token, () => {});
      // GIS pas chargé dans cette page (jeton encore valide à l'ouverture) : révocation
      // directe, sans attendre ni charger le SDK. L'adresse n'accepte pas CORS, d'où
      // `no-cors` (réponse illisible, mais la demande part) ; le jeton voyage dans le corps.
      else void fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      }).catch(() => { /* hors ligne : le jeton expire seul dans l'heure */ });
    }
  } catch { /* no-op */ }
};

// --- DRIVE ---
/**
 * Cherche les fichiers de données. Retourne une liste vide UNIQUEMENT si le compte n'en a
 * réellement aucun ; toute autre erreur est propagée.
 *
 * Ce point est critique : l'appelant interprète « aucun » comme « premier démarrage »
 * et crée alors un fichier vide. Avant, un `catch` global renvoyait `null` pour
 * n'importe quelle panne (403 rateLimitExceeded, 503 backendError — courants chez
 * Drive), ce qui créait un SECOND `suivi_epargne.json` vide, y basculait l'app et
 * y écrivait un portefeuille à zéro. Les vraies données survivaient mais devenaient
 * inatteignables (la recherche renvoyant `files[0]` sans tri). Un échec doit donc
 * remonter et faire échouer le chargement, jamais se déguiser en « pas de données ».
 *
 * Plusieurs fichiers homonymes peuvent exister (fichier mis à la corbeille puis restauré
 * pendant qu'un autre appareil en recréait un) : ils sont tous renvoyés, LE PLUS RÉCEMMENT
 * MODIFIÉ D'ABORD. Avant, le plus ancien (tri par date de création) était ouvert en silence
 * au démarrage suivant, avec des données périmées. L'appelant signale les doublons et
 * laisse l'utilisateur choisir (voir usePortfolioData).
 */
// `headRevisionId` est lu dans la même requête (le champ File « headRevisionId », disponible
// pour un fichier au contenu binaire comme ce JSON : developers.google.com/workspace/drive/
// api/reference/rest/v3/files) : au démarrage, la révision est connue AVANT la lecture du
// contenu, sans un aller-retour de plus (voir getFileMeta pour l'ordre des lectures).
export interface DriveFileInfo { id: string; modifiedTime?: string; createdTime?: string; headRevisionId?: string }
export const findConfigFiles = async (): Promise<DriveFileInfo[]> => {
  const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
  const res = await authedFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,modifiedTime,headRevisionId)&orderBy=${encodeURIComponent('modifiedTime desc')}&pageSize=20`
  );
  const data = await res.json() as { files?: DriveFileInfo[] };
  const files = (data.files || []).filter(f => f && typeof f.id === 'string');
  // Tri refait ici : l'ordre de l'API n'est pas une garantie.
  return files.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
};

export const readConfigFile = async (fileId: string): Promise<unknown> => {
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
  // Une révision absente/vide n'est pas exploitable : la renvoyer telle quelle ferait
  // silencieusement sauter le contrôle de concurrence (voir updateConfigFile).
  if (!data.headRevisionId) throw new Error('REVISION_UNAVAILABLE');
  return String(data.headRevisionId);
};

/**
 * Révision courante ET date du dernier enregistrement (pour l'afficher lors d'un conflit).
 * À lire AVANT le contenu : si une écriture tombe entre les deux, le contenu lu est plus
 * récent que la révision notée, et la prochaine écriture lèvera un conflit de trop, jamais
 * un écrasement.
 */
export interface FileMeta { headRevisionId: string; modifiedTime: string | null }
export const getFileMeta = async (fileId: string): Promise<FileMeta> => {
  const res = await authedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=headRevisionId,modifiedTime`);
  const data = await res.json() as { headRevisionId?: unknown; modifiedTime?: unknown };
  if (!data.headRevisionId) throw new Error('REVISION_UNAVAILABLE');
  return { headRevisionId: String(data.headRevisionId), modifiedTime: typeof data.modifiedTime === 'string' ? data.modifiedTime : null };
};

export const createConfigFile = async (data: unknown, name: string = FILE_NAME): Promise<string> => {
  const metadata = { name, mimeType: 'application/json' };
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
 * Conflit constaté APRÈS l'écriture : un autre appareil a écrit entre notre contrôle de
 * révision et notre PATCH. Notre version est désormais la tête du fichier
 * (`ourRevisionId`), celle de l'autre appareil est la révision juste avant
 * (`otherRevisionId`) ; `otherContent` est son contenu quand on a pu le relire
 * (`undefined` sinon : il reste récupérable plus tard via fetchRevisionContent).
 * Hérite de ConflictError : tout code qui traite les conflits le traite aussi.
 */
export class ConcurrentWriteError extends ConflictError {
  ourRevisionId: string;
  otherRevisionId: string;
  otherContent: unknown;
  constructor(ourRevisionId: string, otherRevisionId: string, otherContent: unknown) {
    super();
    this.name = 'ConcurrentWriteError';
    this.ourRevisionId = ourRevisionId;
    this.otherRevisionId = otherRevisionId;
    this.otherContent = otherContent;
  }
}

/** Historique des révisions du fichier (toutes les pages), avec leur date. */
const listRevisions = async (fileId: string): Promise<RevisionEntry[]> => {
  const all: RevisionEntry[] = [];
  let pageToken: string | undefined;
  do {
    const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const res = await authedFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/revisions?pageSize=1000&fields=nextPageToken,revisions(id,modifiedTime)${page}`
    );
    const data = await res.json() as { nextPageToken?: string; revisions?: { id: string; modifiedTime?: string }[] };
    for (const r of data.revisions || []) all.push({ id: String(r.id), modifiedTime: r.modifiedTime });
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
};

/**
 * Relit le contenu d'une ancienne révision (la version d'un autre appareil écrasée par
 * une course). Pour un fichier non-Google (blob), Drive ne permet de télécharger que les
 * révisions marquées « Keep Forever » (doc « Manage file revisions ») : on la marque donc
 * d'abord, ce qui la protège aussi de la purge automatique (30 jours / 100 révisions)
 * tant que l'utilisateur n'a pas tranché. Le marquage est laissé en place : quelques Ko,
 * et seulement lors d'une course réelle. revisions.update et revisions.get acceptent
 * tous deux le scope drive.file.
 */
export const fetchRevisionContent = async (fileId: string, revisionId: string): Promise<unknown> => {
  const rev = encodeURIComponent(revisionId);
  try {
    await authedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/revisions/${rev}?fields=id`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepForever: true }),
    });
  } catch (e) {
    // On tente quand même le téléchargement (déjà marquée, ou Drive le permet malgré tout).
    console.warn('Révision non marquée « Keep Forever »', e);
  }
  const res = await authedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/revisions/${rev}?alt=media`);
  return await res.json();
};

// Après un premier historique non concluant (liste en retard juste après le PATCH), on le
// relit une fois après ce délai.
const VERIFY_RETRY_MS = 1500;

/**
 * Vérifie qu'aucune écriture ne s'est glissée entre le contrôle de révision et notre PATCH,
 * et lève ConcurrentWriteError sinon (voir src/lib/driveWriteCheck.ts).
 *
 * Signal choisi : l'historique des révisions (revisions.list), pas `version`.
 * - `version` compte toutes les mutations, métadonnées comprises, et continue de
 *   s'incrémenter seul quelques secondes après un PATCH (voir getFileRevision) :
 *   « nouvelle version = attendue + 1 » donnerait de faux conflits à chaque sauvegarde.
 * - `headRevisionId` seul ne dit rien : après une course, c'est bien notre révision.
 * - L'historique, lui, montre la révision qui précède la nôtre : si ce n'est pas celle
 *   qu'on croyait écraser, un autre appareil a écrit entre-temps. Une requête de
 *   métadonnées en plus par sauvegarde, aucune écriture supplémentaire.
 * Les copies mensuelles sont des fichiers à part : elles n'ajoutent rien à cet historique.
 *
 * Historique non concluant même après une relecture : on accepte l'écriture (avec un
 * avertissement en console) plutôt que d'inventer un conflit sans version à proposer.
 */
const verifyWrite = async (fileId: string, expectedRevision: string, ourRevision: string): Promise<void> => {
  let verdict = verifyWriteChain(await listRevisions(fileId), expectedRevision, ourRevision);
  if (verdict.kind === 'unknown') {
    await new Promise(r => setTimeout(r, VERIFY_RETRY_MS));
    verdict = verifyWriteChain(await listRevisions(fileId), expectedRevision, ourRevision);
  }
  if (verdict.kind === 'clean') return;
  if (verdict.kind === 'unknown') {
    console.warn('Écriture Drive non vérifiable : historique des révisions incomplet', { expectedRevision, ourRevision });
    return;
  }
  let otherContent: unknown = undefined;
  try {
    otherContent = await fetchRevisionContent(fileId, verdict.otherRevisionId);
  } catch (e) {
    console.error("Version de l'autre appareil non relue (révision gardée sur Drive)", verdict.otherRevisionId, e);
  }
  throw new ConcurrentWriteError(ourRevision, verdict.otherRevisionId, otherContent);
};

/**
 * Sauvegarde le fichier. Si expectedRevision est fourni et que la révision Drive a
 * changé entre-temps (écriture depuis un autre appareil), lève ConflictError au lieu
 * d'écraser. Retourne la nouvelle révision, lue directement dans la réponse du PATCH
 * (`fields=headRevisionId`) : c'est la valeur autoritative post-écriture, et ça évite
 * l'aller-retour supplémentaire que demandait l'ancienne relecture de version.
 *
 * Le contrôle préalable ne suffit pas (Drive n'a pas d'écriture conditionnelle) : une
 * écriture distante peut tomber entre lui et le PATCH. L'écriture est donc VÉRIFIÉE
 * après coup (verifyWrite) et lève ConcurrentWriteError, avec la version de l'autre
 * appareil, si c'est arrivé : rien n'est perdu silencieusement.
 *
 * `expectedRevision` nul/vide signifie « écrire sans contrôle », ce qui n'est légitime
 * que sur une action explicite de l'utilisateur (résolution de conflit « garder mes
 * modifications »). L'appelant automatique doit TOUJOURS fournir une révision : si elle
 * est indisponible, mieux vaut échouer que d'écraser à l'aveugle une écriture distante.
 */
export const updateConfigFile = async (
  fileId: string,
  data: unknown,
  expectedRevision?: string | null
): Promise<string> => {
  const checked = expectedRevision != null && expectedRevision !== '';
  if (checked) {
    // getFileRevision lève si la révision est illisible : on laisse remonter plutôt
    // que de retomber en mode « écriture sans contrôle ».
    const current = await getFileRevision(fileId);
    if (current !== expectedRevision) throw new ConflictError();
  }
  const newRevision = await patchContent(fileId, data);
  if (checked) await verifyWrite(fileId, expectedRevision, newRevision);
  return newRevision;
};

const patchContent = async (fileId: string, data: unknown): Promise<string> => {
  const res = await authedFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=headRevisionId`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data, null, 2),
    }
  );
  const result = await res.json();
  if (result.headRevisionId) return String(result.headRevisionId);
  // Réponse sans headRevisionId (rare mais observé possible) : on relit la révision plutôt
  // que de retourner '' — la chaîne vide est le sentinelle "écriture sans contrôle" et la
  // laisser se propager dans driveRevisionRef désactiverait la détection de conflit.
  return getFileRevision(fileId);
};

// --- SAUVEGARDES MENSUELLES ---
// Drive ne garde les anciennes révisions d'un fichier que 30 jours (ou 100 révisions), et
// l'app sauvegarde souvent : sans copie à part, une erreur découverte trop tard n'aurait
// plus de version saine où revenir. Une copie par mois, les 12 dernières gardées (les plus
// anciennes vont à la corbeille Drive, récupérables 30 jours).
const BACKUP_PREFIX = 'suivi_epargne_backup_';
const BACKUPS_KEPT = 12;

export interface DriveBackup { id: string; name: string; createdTime: string; month: string }

export const listBackups = async (): Promise<DriveBackup[]> => {
  const q = encodeURIComponent(`name contains '${BACKUP_PREFIX}' and trashed = false`);
  const res = await authedFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime desc&pageSize=50`);
  const data = await res.json();
  return (data.files || [])
    .filter((f: { name: string }) => f.name.startsWith(BACKUP_PREFIX))
    .map((f: { id: string; name: string; createdTime: string }) => ({ ...f, month: f.name.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + 7) }));
};

/** Crée la copie du mois si elle n'existe pas encore. Renvoie true si une copie a été créée. */
export const writeMonthlyBackup = async (monthKey: string, data: unknown): Promise<boolean> => {
  const existing = await listBackups();
  if (existing.some(b => b.month === monthKey)) return false;
  await createConfigFile(data, `${BACKUP_PREFIX}${monthKey}.json`);
  const stale = [...existing].sort((a, b) => b.month.localeCompare(a.month)).slice(BACKUPS_KEPT - 1);
  for (const b of stale) {
    await authedFetch(`https://www.googleapis.com/drive/v3/files/${b.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
    }).catch(() => { /* une copie de trop n'est pas grave */ });
  }
  return true;
};

// --- GOOGLE PICKER (sélection de fichiers existants sur le Drive de l'utilisateur) ---
//
// Le scope `drive.file` ne donne accès qu'aux fichiers créés par l'app : impossible de
// parcourir un dossier existant par chemin. Le Picker contourne ça proprement, SANS élargir
// le scope OAuth : l'utilisateur choisit lui-même le fichier dans une fenêtre native Google,
// et l'app reçoit un accès scopé à *exactement* ce qui a été sélectionné (persistant, donc
// pas besoin de rouvrir le Picker à chaque session pour un même fichier déjà choisi).
let pickerApiLoaded = false;

const loadPickerApi = async (): Promise<PickerApi> => {
  // api.js n'est chargé qu'ici, à la première ouverture du Picker.
  await loadScript(GAPI_SRC);
  const gapi = await waitFor(() => googleWindow().gapi, 'gapi');
  if (!pickerApiLoaded) {
    await new Promise<void>((resolve, reject) => {
      gapi.load('picker', { callback: resolve, onerror: reject });
    });
    pickerApiLoaded = true;
  }
  return googleWindow().google!.picker;
};

export interface PickedDriveFile {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Ouvre le sélecteur Google Drive natif, restreint aux PDF et images (fiches de paie).
 * Résout avec le fichier choisi, ou `null` si l'utilisateur annule.
 *
 * `pickerApiKey` est la clé API Google Cloud créée par l'utilisateur (Cloud Console →
 * Identifiants → Clé API, restreinte à l'API Picker) — distincte du CLIENT_ID OAuth,
 * exigée par l'API Picker elle-même.
 */
export const openDrivePicker = async (pickerApiKey: string): Promise<PickedDriveFile | null> => {
  if (!pickerApiKey) throw new Error('PICKER_API_KEY_MISSING');
  const [picker, token] = await Promise.all([loadPickerApi(), getAccessToken()]);

  return new Promise((resolve, reject) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setMimeTypes('application/pdf,image/png,image/jpeg,image/webp')
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const pickerInstance = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      // Indispensable avec le scope drive.file : sans l'ID du projet (le préfixe
      // numérique du CLIENT_ID), le fichier choisi apparaît sélectionnable dans le
      // Picker mais l'accès n'est en réalité JAMAIS accordé — la lecture suivante
      // échoue avec un 404 "fileId" alors que le fichier existe bel et bien.
      .setAppId(CLIENT_ID.split('-')[0])
      .setDeveloperKey(pickerApiKey)
      .setCallback((data: PickerCallbackData) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name, mimeType: doc.mimeType } : null);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        } else if (data.action === 'error') {
          // Sans cette branche, une erreur interne du Picker laissait la promesse pendante
          // à jamais — bouton "Importer" mort jusqu'au rechargement de la page.
          reject(new Error('PICKER_ERROR'));
        }
      })
      .build();
    try {
      pickerInstance.setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
};

/**
 * Télécharge un fichier sélectionné via le Picker et le renvoie encodé en base64, prêt à
 * être envoyé à l'API Gemini (`inline_data`). Le fichier n'est jamais recopié sur Drive :
 * on ne fait que le lire, pour l'envoyer directement au fournisseur d'extraction.
 */
export const downloadFileAsBase64 = async (fileId: string): Promise<string> => {
  const res = await authedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  const buffer = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  // Par blocs pour éviter de dépasser la limite d'arguments de String.fromCharCode sur
  // un gros PDF (au-delà d'environ 65k octets passés d'un coup selon les moteurs JS).
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};
