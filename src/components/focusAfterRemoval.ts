// Après la suppression d'un élément de liste, le focus ne doit pas retomber sur <body>
// (WCAG 2.4.3 : au clavier, on repartirait du haut de la page). Il va sur l'élément voisin
// (le suivant, sinon le précédent), ou sur le repli (champ, bouton ou titre proche) si la
// liste est vide. Si une cible ne peut pas prendre le focus (bouton désactivé ou absent),
// on essaie la suivante, et en dernier recours le titre de l'écran.
//
// Chaque ligne marque l'élément à focaliser avec l'attribut `data-focus-after-removal`.
export const FOCUS_AFTER_REMOVAL = 'data-focus-after-removal';

const HEADING = 'h1, h2, h3, h4, h5, h6';

/** Donne le focus à `el` ; vrai seulement s'il l'a vraiment pris. Un titre sans tabindex
 *  reçoit tabIndex = -1 (focalisable par le code, pas par la touche Tab), comme le fait la
 *  navigation entre écrans. */
const tryFocus = (el: HTMLElement | null | undefined): boolean => {
  if (!el?.isConnected) return false;
  if (!el.hasAttribute('tabindex') && el.matches(HEADING)) el.tabIndex = -1;
  el.focus();
  return document.activeElement === el;
};

/** Titre de l'écran courant (le même que celui que vise la navigation, voir useAppNavigation). */
const pageHeading = () => (document.querySelector('main') ?? document.body).querySelector<HTMLElement>('h1, h2');

/**
 * À appeler juste après la suppression (React a re-rendu la liste au tour suivant).
 * `removedIndex` : position, dans la liste affichée, de l'élément supprimé.
 */
export const focusAfterRemoval = (
  getList: () => HTMLElement | null,
  removedIndex: number,
  getFallback?: () => HTMLElement | null | undefined,
) => {
  setTimeout(() => {
    const list = getList();
    const targets = list?.isConnected
      ? Array.from(list.querySelectorAll<HTMLElement>(`[${FOCUS_AFTER_REMOVAL}]`)).filter(el => el.isConnected)
      : [];
    const i = Math.min(Math.max(0, removedIndex), targets.length - 1);
    // Voisin d'abord (même place, puis en remontant, puis en descendant), puis le repli.
    const candidates = [...targets.slice(0, i + 1).reverse(), ...targets.slice(i + 1)];
    for (const el of candidates) if (tryFocus(el)) return;
    if (tryFocus(getFallback?.())) return;
    tryFocus(pageHeading());
  }, 0);
};
