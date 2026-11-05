// ================================================
// FILE: src/services/drive/dataFile.ts
// Fichier de données sur Drive : recherche, lecture, création, révisions, écriture vérifiée.
// Découpé de googleDriveService.ts sans changement de comportement.
// ================================================
import { verifyWriteChain, type RevisionEntry, type WriteVerdict } from '../../lib/driveWriteCheck';
import { authedFetch } from './session';

const FILE_NAME = 'suivi_epargne.json';

// --- DRIVE ---
/**
 * Cherche les fichiers de données. Retourne une liste vide UNIQUEMENT si le compte n'en a
 * réellement aucun ; toute autre erreur est propagée.
 *
 * Ce point est critique : l'appelant interprète « aucun » comme « premier démarrage »
 * et crée alors un fichier vide. Répondre « aucun » à n'importe quelle panne (403
 * rateLimitExceeded, 503 backendError — courants chez Drive) créerait un SECOND
 * `suivi_epargne.json` vide, y basculerait l'app et y écrirait un portefeuille à zéro :
 * les vraies données deviendraient inatteignables. Un échec doit donc remonter et faire
 * échouer le chargement, jamais se déguiser en « pas de données ».
 *
 * Plusieurs fichiers homonymes peuvent exister (fichier mis à la corbeille puis restauré
 * pendant qu'un autre appareil en recréait un) : ils sont tous renvoyés, LE PLUS RÉCEMMENT
 * MODIFIÉ D'ABORD (le plus ancien, par date de création, aurait des données périmées).
 * L'appelant signale les doublons et laisse l'utilisateur choisir (voir usePortfolioData).
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
 * aucune intervention extérieure). Le relire juste après un PATCH donnerait donc une
 * valeur périmée d'avance, et la sauvegarde suivante croirait détecter un autre
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
 *
 * Historique illisible (réseau coupé, Drive saturé, session expirée juste après le PATCH) :
 * l'écriture, elle, a RÉUSSI. Ce n'est donc pas un échec d'écriture : on la garde, avec un
 * verdict « inconnu » (avertissement en console), comme un historique non concluant. Remontée
 * comme un échec de sauvegarde, l'erreur ferait garder l'ancienne révision, puis ouvrir un
 * faux conflit contre notre propre écriture (ou croire l'app hors ligne).
 */
const verifyWrite = async (fileId: string, expectedRevision: string, ourRevision: string): Promise<void> => {
  const check = async (): Promise<WriteVerdict | null> => {
    try {
      return verifyWriteChain(await listRevisions(fileId), expectedRevision, ourRevision);
    } catch (e) {
      console.warn('Écriture Drive faite, mais son historique est illisible pour l\'instant : vérification abandonnée', { expectedRevision, ourRevision }, e);
      return null;
    }
  };
  let verdict = await check();
  if (!verdict) return;
  if (verdict.kind === 'unknown') {
    await new Promise(r => setTimeout(r, VERIFY_RETRY_MS));
    verdict = await check();
    if (!verdict) return;
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
