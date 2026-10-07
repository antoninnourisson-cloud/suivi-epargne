// Vérification APRÈS écriture d'une sauvegarde Drive (fonction pure, sans réseau).
//
// Drive v3 n'offre pas d'écriture conditionnelle du contenu (pas d'If-Match sur un
// files.update) : entre « je relis la révision » et « j'écris », un autre appareil peut
// glisser sa propre écriture, que la nôtre écrase alors sans erreur. On ne peut pas
// empêcher cette course, mais on peut la CONSTATER juste après coup : dans l'historique des
// révisions du fichier, la révision qui précède immédiatement la nôtre doit être celle que
// l'on croyait écraser (`expected`). Si c'en est une autre, quelqu'un a écrit entre les deux,
// et cette révision intermédiaire contient la version de l'autre appareil.

export interface RevisionEntry { id: string; modifiedTime?: string }

export type WriteVerdict =
  /** Exactement une écriture (la nôtre) depuis la révision attendue. */
  | { kind: 'clean' }
  /** Une autre écriture s'est intercalée : `otherRevisionId` porte la version de l'autre appareil. */
  | { kind: 'intervened'; otherRevisionId: string }
  /** L'historique ne permet pas de conclure (liste incomplète ou en retard). */
  | { kind: 'unknown' };

/**
 * Remet les révisions dans l'ordre chronologique. La doc de revisions.list ne garantit pas
 * l'ordre (en pratique : de la plus ancienne à la plus récente), d'où le tri par
 * `modifiedTime` quand toutes les entrées l'ont ; tri stable, l'ordre de l'API départage.
 */
export const orderRevisions = (revisions: RevisionEntry[]): string[] => {
  const indexed = revisions.map((r, i) => ({ r, i }));
  const allDated = revisions.length > 0 && revisions.every(r => !!r.modifiedTime && !Number.isNaN(Date.parse(r.modifiedTime)));
  if (allDated) {
    indexed.sort((a, b) => (Date.parse(a.r.modifiedTime!) - Date.parse(b.r.modifiedTime!)) || (a.i - b.i));
  }
  return indexed.map(x => x.r.id);
};

/**
 * Décide si notre écriture (`ours`, révision renvoyée par le PATCH) a bien succédé
 * directement à `expected`.
 *
 * Une écriture d'un autre appareil APRÈS la nôtre n'est pas notre affaire ici : notre
 * révision reste correctement chaînée, et c'est l'autre appareil qui verra, par la même
 * vérification, que sa révision ne suit pas celle qu'il attendait.
 */
export const verifyWriteChain = (revisions: RevisionEntry[], expected: string, ours: string): WriteVerdict => {
  const ids = orderRevisions(revisions);
  const i = ids.indexOf(ours);
  if (i > 0) {
    const previous = ids[i - 1];
    return previous === expected ? { kind: 'clean' } : { kind: 'intervened', otherRevisionId: previous };
  }
  if (i === 0) {
    // Notre révision est la plus ancienne listée : l'historique a été tronqué avant elle.
    return { kind: 'unknown' };
  }
  // Notre révision n'apparaît pas encore (liste en retard). Si des révisions suivent déjà
  // `expected`, ce ne sont pas les nôtres : quelqu'un d'autre a écrit.
  const e = ids.indexOf(expected);
  if (e >= 0 && e < ids.length - 1) return { kind: 'intervened', otherRevisionId: ids[ids.length - 1] };
  return { kind: 'unknown' };
};
