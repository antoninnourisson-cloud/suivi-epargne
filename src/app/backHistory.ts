// Geste « Retour » (Android) : Pécule ajoute des entrées à l'historique du navigateur pour que
// Retour ferme la fenêtre du dessus, puis revienne à l'écran précédent, au lieu de quitter l'app.
// - une fenêtre ouverte (Modal) pose une entrée `{ pecModal }` et la retire à sa fermeture ;
// - un changement d'écran pose une entrée `{ pecNav: profondeur }` (useViewState).
// L'adresse ne change jamais (pushState sans adresse) : ?partage=, ?demo=1 et les alias
// d'anciennes adresses restent intacts. Un seul écouteur `popstate` dispatche les gestes.

interface PecState { pecNav?: number; pecModal?: boolean }

const readState = (): PecState => {
  const s: unknown = window.history.state;
  return s && typeof s === 'object' ? (s as PecState) : {};
};

/** Profondeur de navigation courante (0 = entrée de départ). */
let navDepth = 0;
export const getNavDepth = () => navDepth;
export const setNavDepth = (d: number) => { navDepth = d; };

/** Retours qu'on a demandés nous-mêmes (retrait d'une entrée) : leur `popstate` est ignoré. */
let expected = 0;
/** Entrées de fenêtres déjà fermées, encore dans l'historique (fenêtre dessous toujours ouverte). */
let debt = 0;
/** Entrées de fenêtres reprises par un changement d'écran (replaceState) : plus rien à retirer. */
let surrendered = 0;

type PopHandler = () => void;
const modalHandlers: PopHandler[] = [];
let navHandler: ((state: PecState) => void) | null = null;
let listening = false;

const onPop = () => {
  if (expected > 0) { expected--; return; }
  const top = modalHandlers[modalHandlers.length - 1];
  if (top) { top(); return; }
  navHandler?.(readState());
};

const listen = () => {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPop);
};

/** Pose l'entrée d'une fenêtre (à son ouverture ou quand un Retour refusé la remet). */
export const pushModalEntry = () => {
  try { window.history.pushState({ pecModal: true, pecNav: navDepth } satisfies PecState, ''); } catch { /* historique indisponible */ }
};

/** Enregistre la fenêtre la plus haute ; renvoie le retrait de l'écouteur. */
export const registerModal = (handler: PopHandler): (() => void) => {
  listen();
  modalHandlers.push(handler);
  return () => {
    const at = modalHandlers.indexOf(handler);
    if (at !== -1) modalHandlers.splice(at, 1);
  };
};

/**
 * Une fenêtre se ferme. `entryPopped` : le geste Retour a déjà retiré son entrée. Sinon
 * l'entrée est retirée ici, dès que plus aucune fenêtre n'est ouverte (sinon elle est
 * « due » et partira avec la dernière).
 */
export const releaseModalEntry = (entryPopped: boolean) => {
  if (!entryPopped) {
    if (surrendered > 0) surrendered--; else debt++;
  }
  if (modalHandlers.length > 0 || debt === 0) return;
  // On ne retire que ce qui est vraiment au sommet de l'historique : jamais une entrée d'écran.
  if (!readState().pecModal) { debt = 0; return; }
  const n = debt;
  debt = 0;
  expected++;
  try { window.history.go(-n); } catch { expected--; }
};

/** Écoute les retours vers un écran précédent (une seule fois, par useViewState). */
export const registerNav = (handler: (state: PecState) => void): (() => void) => {
  listen();
  navHandler = handler;
  return () => { if (navHandler === handler) navHandler = null; };
};

/**
 * Nouvelle entrée pour un changement d'écran. Si l'entrée du sommet est celle d'une fenêtre qui
 * se ferme (lien de la feuille vers un écran), elle est reprise au lieu d'en empiler une
 * seconde : sa fermeture ne ferait sinon reculer d'un écran.
 */
export const pushNavEntry = (): number => {
  const depth = navDepth + 1;
  const state: PecState = { pecNav: depth };
  try {
    if (readState().pecModal) { window.history.replaceState(state, ''); surrendered++; }
    else window.history.pushState(state, '');
  } catch { /* historique indisponible */ }
  navDepth = depth;
  return depth;
};

/** Marque l'entrée courante (rechargement d'une page ouverte sur une entrée d'écran). */
export const initNavDepth = () => {
  const d = readState().pecNav;
  navDepth = typeof d === 'number' && d >= 0 ? d : 0;
};
