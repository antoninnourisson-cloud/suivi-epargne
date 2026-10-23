// ================================================
// FILE: worker/src/backupRetention.ts
// Conservation des sauvegardes de secours chiffrées (fonctions pures, testées).
//
// Le serveur ne peut pas lire ces copies : il ne peut donc pas distinguer une bonne copie
// d'une copie illisible envoyée avec une session volée. Plutôt que « les 8 dernières » (8
// envois suffisaient à tout remplacer), la conservation est échelonnée et garde toujours
// des copies ANCIENNES, qu'aucun nouvel envoi ne peut chasser :
//   - les 7 copies les plus récentes ;
//   - la plus ANCIENNE copie de chacune des 5 dernières semaines où il y a eu une copie ;
//   - la plus ANCIENNE copie de chacun des 12 derniers mois où il y a eu une copie.
// Une copie par jour au plus (un nouvel envoi le même jour remplace celle du jour) : il faut
// donc des semaines d'envois pour atteindre les copies d'avant. Chaque copie s'efface
// d'elle-même au bout d'un an.
// ================================================

export const BACKUP_RECENT = 7;
export const BACKUP_WEEKS = 5;
export const BACKUP_MONTHS = 12;
/** Nombre maximal de copies gardées (7 + 5 + 12). */
export const BACKUP_MAX_COPIES = BACKUP_RECENT + BACKUP_WEEKS + BACKUP_MONTHS;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Lundi de la semaine (ISO) de `date`, au format AAAA-MM-JJ. */
export const mondayOf = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
};

/** La plus ancienne date de chacun des `n` groupes les plus récents. */
const oldestPerGroup = (ascending: string[], groupOf: (d: string) => string, n: number): string[] => {
  const firstOfGroup = new Map<string, string>();
  for (const d of ascending) if (!firstOfGroup.has(groupOf(d))) firstOfGroup.set(groupOf(d), d);
  return [...firstOfGroup.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, n).map(([, d]) => d);
};

/** Dates (AAAA-MM-JJ) à garder parmi `dates` ; les autres peuvent être effacées. */
export const backupsToKeep = (dates: string[]): Set<string> => {
  const ascending = [...new Set(dates.filter(d => DATE.test(d)))].sort();
  return new Set([
    ...ascending.slice(-BACKUP_RECENT),
    ...oldestPerGroup(ascending, mondayOf, BACKUP_WEEKS),
    ...oldestPerGroup(ascending, d => d.slice(0, 7), BACKUP_MONTHS),
  ]);
};
