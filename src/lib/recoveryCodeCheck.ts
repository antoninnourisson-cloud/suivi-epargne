// Vérification que le code de secours a vraiment été noté, avant d'activer la sauvegarde
// chiffrée (fonctions pures). Le code n'est affiché qu'une fois : s'il n'a pas été noté,
// toutes les copies deviennent illisibles pour toujours. On demande donc de recopier deux
// groupes de 4 caractères, choisis au hasard, sans le code à l'écran.

/** Nombre de groupes d'un code de secours (« XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX »). */
export const RECOVERY_GROUPS = 7;

/**
 * Deux groupes distincts et non voisins (numérotés de 1 à 7, dans l'ordre), tirés au hasard :
 * on ne peut pas les deviner d'avance, et deux groupes éloignés montrent que tout le code
 * a été recopié. `random` : nombre dans [0, 1[ (Math.random par défaut).
 */
export const pickCheckGroups = (random: () => number = Math.random): [number, number] => {
  const pairs: [number, number][] = [];
  for (let a = 1; a <= RECOVERY_GROUPS; a++) for (let b = a + 2; b <= RECOVERY_GROUPS; b++) pairs.push([a, b]);
  return pairs[Math.min(pairs.length - 1, Math.floor(random() * pairs.length))];
};

/** Saisie relue comme le code complet (src/lib/cloudBackupCrypto.ts) : casse, espaces, O → 0, I et L → 1. */
export const normalizeGroup = (s: string): string =>
  s.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

/** Groupe `n` (de 1 à 7) du code affiché. */
export const groupOf = (code: string, n: number): string => code.split('-')[n - 1] ?? '';

/** Les groupes recopiés correspondent-ils au code ? */
export const checkGroups = (code: string, groups: readonly number[], inputs: readonly string[]): boolean =>
  groups.length > 0 && groups.length === inputs.length
  && groups.every((g, i) => groupOf(code, g).length === 4 && normalizeGroup(inputs[i]) === normalizeGroup(groupOf(code, g)));

/** Contenu du fichier texte proposé au téléchargement (à ranger hors de l'appareil). */
export const recoveryCodeFileText = (code: string, createdAt: Date): string => [
  'Pécule : code de secours de la sauvegarde chiffrée',
  `Créé le ${createdAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
  '',
  code,
  '',
  'Rangez ce fichier hors de cet appareil (gestionnaire de mots de passe, clé USB, papier).',
  'Sans ce code, les copies de secours sont illisibles, pour vous comme pour le serveur.',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// Vérification annuelle (sauvegarde déjà activée)
// ---------------------------------------------------------------------------

/** Sauvegarde de secours activée sur cet appareil : depuis quand, et code retapé juste quand. */
export interface BackupEnrollment { enabledAt: string; codeCheckedAt?: string }

/** Un an entre deux vérifications du code de secours. */
const BACKUP_CODE_CHECK_DAYS = 365;

/**
 * Le rappel « votre code de secours est-il toujours à portée de main ? » est-il dû ? Un an
 * après l'activation sur cet appareil, puis un an après chaque code retapé juste. Une copie
 * dont le code est perdu ne se découvre sinon que le jour où on en a besoin.
 * Dates illisibles : pas de rappel (rien ne permet de dire qu'un an est passé).
 */
export const backupCodeCheckDue = (enrollment: BackupEnrollment | null | undefined, now: Date): boolean => {
  if (!enrollment) return false;
  const since = Date.parse(enrollment.codeCheckedAt ?? enrollment.enabledAt);
  if (!Number.isFinite(since)) return false;
  return now.getTime() - since >= BACKUP_CODE_CHECK_DAYS * 86_400_000;
};

// ---------------------------------------------------------------------------
// Envoi de la copie chiffrée en échec ou en retard (tâche de l'Accueil)
// ---------------------------------------------------------------------------

/** Ce que dit l'état local de la sauvegarde (services/cloudBackup, `readStatus`). */
export interface BackupUploadStatus { lastUploadAt?: string; lastError?: string; lastErrorAt?: string }

export type BackupUploadProblem =
  | { kind: 'stale'; days: number; /** Aucun envoi réussi depuis l'activation. */ never: boolean }
  | { kind: 'error'; code: string };

/** Au-delà de 30 jours sans envoi réussi, ou avec une erreur de moins de 7 jours : la tâche apparaît. */
const BACKUP_STALE_DAYS = 30;
const BACKUP_ERROR_RECENT_DAYS = 7;

/**
 * La sauvegarde activée sur cet appareil a-t-elle un problème à signaler ? Une erreur récente
 * d'abord (elle dit pourquoi), sinon un dernier envoi vieux de plus de 30 jours. Un envoi réussi
 * efface l'erreur et rajeunit la date : la tâche disparaît d'elle-même. Dates illisibles : rien.
 */
export const backupUploadProblem = (
  enrollment: BackupEnrollment | null | undefined, status: BackupUploadStatus, now: Date,
): BackupUploadProblem | null => {
  if (!enrollment) return null;
  const DAY = 86_400_000;
  if (status.lastError) {
    const at = Date.parse(status.lastErrorAt ?? '');
    if (Number.isFinite(at) && now.getTime() - at <= BACKUP_ERROR_RECENT_DAYS * DAY) return { kind: 'error', code: status.lastError };
  }
  const since = Date.parse(status.lastUploadAt ?? enrollment.enabledAt);
  if (!Number.isFinite(since)) return null;
  const days = Math.floor((now.getTime() - since) / DAY);
  return days > BACKUP_STALE_DAYS ? { kind: 'stale', days, never: !status.lastUploadAt } : null;
};
