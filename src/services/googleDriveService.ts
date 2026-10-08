// ================================================
// FILE: src/services/googleDriveService.ts
// Version web-only (PWA). Auth Google Identity Services + Drive via fetch.
// ================================================

import {
  isBackendEnabled, hasBackendSession, fetchAccessToken, startBackendLogin, backendLogout, consumeLoginCode,
  saveBackendSession,
} from './backendService';
import { verifyWriteChain, RevisionEntry } from '../lib/driveWriteCheck';

const CLIENT_ID = '763862877733-hl1an9vcn0ibnoq2iq035927528mimd5.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'suivi_epargne.json';

// Types minimaux des SDK Google chargés par <script> (gapi, GIS, Picker) : uniquement ce
// que l'app utilise.
interface TokenResponse { access_token?: string; expires_in?: number; error?: string }
type TokenCallback = ((resp: TokenResponse) => void) | '';
interface TokenClient { callback: TokenCallback; requestAccessToken: (opts: { prompt: string }) => void }
interface Gapi {
  load: (lib: string, cb: (() => void) | { callback: () => void; onerror: (e?: unknown) => void }) => void;
  client: { init: (opts: { discoveryDocs: string[] }) => Promise<void>; setToken: (token: string) => void };
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
let gapiInited = false;
let gisInited = false;

// Callback déclenché quand la session est définitivement perdue (401 + refresh KO).
// L'UI s'y abonne pour afficher une bannière de reconnexion.
let onAuthLost: (() => void) | null = null;
export const setOnAuthLost = (cb: (() => void) | null) => { onAuthLost = cb; };

// --- INITIALISATION (web) ---
/**
 * Attend que les deux SDK Google (gapi + GIS, chargés en `async defer` depuis
 * index.html) soient disponibles, puis les initialise.
 *
 * Avant, on testait `window.gapi`/`window.google` UNE SEULE FOIS, au montage : si les
 * scripts n'étaient pas encore évalués (connexion lente, cache froid), aucune branche ne
 * s'exécutait, la promesse ne se réglait jamais et l'app restait bloquée sur
 * « Chargement API… » sans erreur exploitable. On attend donc activement, avec un délai
 * maximal au-delà duquel on rejette pour que l'UI puisse afficher un vrai message.
 */
const SDK_WAIT_TIMEOUT_MS = 20_000;

const waitForGlobal = <K extends keyof GoogleGlobals>(name: K, timeoutMs: number): Promise<GoogleGlobals[K]> =>
  new Promise((resolve, reject) => {
    const existing = googleWindow()[name];
    if (existing) { resolve(existing); return; }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const value = googleWindow()[name];
      if (value) { clearInterval(timer); resolve(value); return; }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`GOOGLE_SDK_UNAVAILABLE:${name}`));
      }
    }, 100);
  });

export const initGoogleApi = async (): Promise<void> => {
  const [gapi, google] = await Promise.all([
    waitForGlobal('gapi', SDK_WAIT_TIMEOUT_MS),
    waitForGlobal('google', SDK_WAIT_TIMEOUT_MS),
  ]);

  if (!gapiInited) {
    await new Promise<void>((resolve, reject) => {
      gapi.load('client', () => {
        void (async () => {
          try {
            await gapi.client.init({
              discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
            });
            gapiInited = true;
            resolve();
          } catch (e) {
            reject(e);
          }
        })();
      });
    });
  }

  if (!gisInited) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      // Seulement drive.file : sans ça, Google rajoute les autorisations accordées autrefois
      // (gmail.send) et affiche « Google n'a pas validé cette application ».
      include_granted_scopes: false,
      callback: '',
    });
    gisInited = true;
  }
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
const requestToken = (prompt: '' | 'none' | 'consent'): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!tokenClient) { reject(new Error('tokenClient not ready')); return; }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('TOKEN_REQUEST_TIMEOUT'));
    }, TOKEN_TIMEOUT_MS);
    tokenClient.callback = (resp: TokenResponse) => {
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
    tokenClient.requestAccessToken({ prompt });
  });

// Connexion manuelle (bouton). prompt='' évite de redemander le consentement à
// chaque fois une fois qu'il a été donné.
export const handleAuthClick = async (silent: boolean = false): Promise<void> => {
  if (isBackendEnabled()) {
    // Mode serveur : silencieux = le Worker émet un jeton frais à partir du refresh token ;
    // sinon, redirection vers la connexion Google (la page quitte l'app, d'où la promesse
    // jamais résolue — le retour recharge tout).
    if (silent) return refreshTokenSilently();
    startBackendLogin();
    return new Promise<void>(() => {});
  }
  await requestToken(silent ? 'none' : '');
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
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status; }
}

const ensureOk = async (res: Response): Promise<Response> => {
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  throw new ApiError(`Google API ${res.status} ${res.statusText} — ${body.slice(0, 300)}`, res.status);
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
      const token = JSON.parse(stored).access_token;
      googleWindow().google?.accounts?.oauth2?.revoke(token, () => {});
    }
    googleWindow().gapi?.client?.setToken('');
  } catch { /* no-op */ }
};

// --- DRIVE ---
/**
 * Cherche le fichier de config. Retourne `null` UNIQUEMENT si le compte n'en a
 * réellement aucun ; toute autre erreur est propagée.
 *
 * Ce point est critique : l'appelant interprète `null` comme « premier démarrage »
 * et crée alors un fichier vide. Avant, un `catch` global renvoyait `null` pour
 * n'importe quelle panne (403 rateLimitExceeded, 503 backendError — courants chez
 * Drive), ce qui créait un SECOND `suivi_epargne.json` vide, y basculait l'app et
 * y écrivait un portefeuille à zéro. Les vraies données survivaient mais devenaient
 * inatteignables (la recherche renvoyant `files[0]` sans tri). Un échec doit donc
 * remonter et faire échouer le chargement, jamais se déguiser en « pas de données ».
 *
 * On trie aussi par date de création pour rester déterministe si plusieurs fichiers
 * homonymes existent déjà (dégât d'une version antérieure de ce bug).
 */
export const findConfigFile = async (): Promise<string | null> => {
  const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
  const res = await authedFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime`
  );
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
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
  const gapi = await waitForGlobal('gapi', SDK_WAIT_TIMEOUT_MS);
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
