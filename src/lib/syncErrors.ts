// Classement des échecs de synchronisation avec Drive : passagers (on réessaie tout seul)
// ou durables (on le dit clairement et on attend l'utilisateur, au lieu de réessayer en
// boucle toutes les deux minutes une requête qui échouera toujours).
//
// Codes et raisons d'après la documentation de l'API Drive, « Resolve errors » :
// https://developers.google.com/drive/api/guides/handle-errors
// - à réessayer (attente croissante) : 429 rateLimitExceeded, 403 rateLimitExceeded et
//   userRateLimitExceeded, 500, 502, 503, 504 ;
// - à corriger : 400 badRequest, 403 storageQuotaExceeded, insufficientFilePermissions,
//   appNotAuthorizedToFile, domainPolicy…

export type SyncErrorReason =
  | 'network' | 'server' | 'rate-limit'
  | 'permission' | 'quota' | 'rejected' | 'malformed' | 'unknown';

export interface SyncErrorInfo {
  reason: SyncErrorReason;
  /** true : nouvel essai automatique ; false : rien ne changera sans l'utilisateur. */
  transient: boolean;
}

/** Ce qu'on sait d'une erreur : statut HTTP et raison Drive, ou nom/message JavaScript. */
export interface FailureLike {
  status?: number;
  reason?: string;
  name?: string;
  message?: string;
}

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'sharingRateLimitExceeded']);
const QUOTA_REASONS = new Set(['storageQuotaExceeded', 'activeItemCreationLimitExceeded', 'teamDriveFileLimitExceeded']);

/** Classe un échec. Inconnu = passager : on préfère réessayer que d'abandonner des données. */
export const classifySyncFailure = (f: FailureLike): SyncErrorInfo => {
  const { status, reason } = f;
  if (typeof status === 'number') {
    if (status === 429 || (reason && RATE_REASONS.has(reason))) return { reason: 'rate-limit', transient: true };
    if (status >= 500 || status === 408) return { reason: 'server', transient: true };
    if (reason && QUOTA_REASONS.has(reason)) return { reason: 'quota', transient: false };
    if (status === 403 || status === 401) return { reason: 'permission', transient: false };
    if (status >= 400) return { reason: 'rejected', transient: false };
  }
  // fetch échoue par TypeError quand la requête ne part pas (réseau, délai dépassé).
  if (f.name === 'TypeError') return { reason: 'network', transient: true };
  // Contenu reçu mais illisible (JSON abîmé, fichier vide) : réessayer ne le réparera pas.
  if (f.name === 'SyntaxError' || f.message === 'EMPTY_FILE') return { reason: 'malformed', transient: false };
  if (f.message === 'TOKEN_REQUEST_TIMEOUT' || f.message === 'REVISION_UNAVAILABLE') return { reason: 'network', transient: true };
  return { reason: 'unknown', transient: true };
};

/** Explication en clair, à la suite de « La dernière sauvegarde a échoué. » ou « Impossible de charger… ». */
export const SYNC_ERROR_MESSAGES: Record<SyncErrorReason, string> = {
  network: 'Drive est injoignable pour le moment. Nouvel essai automatique.',
  server: 'Drive ne répond pas correctement pour le moment. Nouvel essai automatique.',
  'rate-limit': 'Drive demande de patienter un peu. Nouvel essai automatique.',
  permission: 'Pécule n\'a plus le droit de modifier votre fichier sur Drive. Déconnectez-vous puis reconnectez-vous pour redonner l\'accès.',
  quota: 'Votre espace Google Drive est plein. Libérez de la place, puis touchez « Réessayer ».',
  rejected: 'Drive a refusé l\'enregistrement. Touchez « Réessayer » ; si cela continue, exportez vos données depuis Paramètres.',
  malformed: 'Le fichier de données sur Drive est illisible. Rien n\'y a été modifié : vous pouvez revenir à une copie depuis Paramètres, Sauvegardes.',
  unknown: 'Nouvel essai automatique.',
};

/** Même chose après un CHARGEMENT raté (rien n'a été enregistré : pas de mot « enregistrement »). */
export const SYNC_LOAD_ERROR_MESSAGES: Record<SyncErrorReason, string> = {
  ...SYNC_ERROR_MESSAGES,
  permission: 'Pécule n\'a plus accès à votre fichier sur Drive. Déconnectez-vous puis reconnectez-vous pour redonner l\'accès.',
  rejected: 'Drive a refusé la demande. Touchez « Réessayer » ; si cela continue, déconnectez-vous puis reconnectez-vous.',
};

/** Phrase complète du bandeau d'erreur, selon que le chargement ou l'enregistrement a échoué. */
export const syncErrorText = (phase: 'load' | 'save', reason: SyncErrorReason = 'unknown'): string =>
  phase === 'load'
    ? `Impossible de charger vos données depuis Drive (rien n'y a été modifié). ${SYNC_LOAD_ERROR_MESSAGES[reason]}`
    : `La dernière sauvegarde a échoué. ${SYNC_ERROR_MESSAGES[reason]}`;
