// Recherche d'une nouvelle version publiée pendant que l'app reste ouverte.
//
// Le navigateur ne vérifie le service worker qu'à une navigation (ou au plus une fois par
// 24 h lors d'un événement push ou sync : web.dev/articles/service-worker-lifecycle#updates).
// Une PWA laissée en arrière-plan ne navigue jamais : elle pouvait garder l'ancien code des
// jours après un déploiement, et le garde-fou de src/index.tsx (rechargement quand un
// nouveau service worker prend la main) ne se déclenchait pas. On demande donc la
// vérification au retour au premier plan et toutes les heures, au plus une fois par quart
// d'heure. Si une version est trouvée, elle s'installe et prend la main seule (autoUpdate) :
// la page se recharge alors (createSafeReload), mais jamais au milieu d'une saisie.

/** Écart minimal entre deux vérifications. */
export const UPDATE_CHECK_MIN_GAP_MS = 15 * 60_000;
/** Vérification périodique, app ouverte et visible. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60_000;

type Registrations = Pick<ServiceWorkerContainer, 'getRegistration'>;

/**
 * Lance les vérifications. `lastCheckAt` : la page vient d'être chargée, donc le navigateur
 * vient de vérifier lui-même. Renvoie de quoi tout arrêter.
 */
export const watchForAppUpdates = (sw: Registrations, now: () => number = Date.now): (() => void) => {
  let lastCheckAt = now();
  const check = () => {
    if (document.visibilityState !== 'visible') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (now() - lastCheckAt < UPDATE_CHECK_MIN_GAP_MS) return;
    lastCheckAt = now();
    sw.getRegistration()
      .then(reg => reg?.update())
      // Hors ligne, serveur injoignable : on réessaiera au prochain retour ou à l'heure suivante.
      .catch(() => undefined);
  };
  document.addEventListener('visibilitychange', check);
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  return () => {
    document.removeEventListener('visibilitychange', check);
    clearInterval(timer);
  };
};

// --- Rechargement sans rien faire perdre ---
// La nouvelle version prend la main tout de suite (autoUpdate) et l'ancien code doit partir
// vite (voir src/index.tsx). Mais recharger pendant une saisie ferait perdre un formulaire à
// moitié rempli, et des saisies pas encore sur Drive ne seraient plus qu'une « sauvegarde
// locale » à restaurer. Le rechargement attend donc que rien ne soit en cours : aucune
// fenêtre ouverte, aucun champ en cours de saisie, rien en attente d'envoi.

const reloadBlockers = new Set<() => boolean>();

/** Ajoute une raison de repousser le rechargement (ex. saisies pas encore sur Drive). Renvoie de quoi la retirer. */
export const registerReloadBlocker = (blocked: () => boolean): (() => void) => {
  reloadBlockers.add(blocked);
  return () => { reloadBlockers.delete(blocked); };
};

const EDITABLE = /^(INPUT|TEXTAREA|SELECT)$/;

/** Un rechargement maintenant ferait-il perdre quelque chose ? */
export const isBusyForReload = (doc: Document = document): boolean => {
  if (doc.querySelector('[aria-modal="true"]')) return true; // fenêtre ou formulaire ouvert
  const el = doc.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || EDITABLE.test(el.tagName))) return true; // saisie en cours
  for (const blocked of reloadBlockers) {
    try { if (blocked()) return true; } catch { /* une vérification en échec ne bloque pas */ }
  }
  return false;
};

/** Intervalle entre deux essais quand le rechargement a dû attendre. */
export const RELOAD_RETRY_MS = 3_000;

/**
 * Renvoie la fonction à appeler quand une nouvelle version prend la main : recharge tout de
 * suite si rien n'est en cours, sinon dès que c'est le cas (essai toutes les 3 s et à chaque
 * passage en arrière-plan ou retour au premier plan).
 */
export const createSafeReload = (reload: () => void, isBusy: () => boolean = isBusyForReload): (() => void) => {
  let waiting = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    waiting = false;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', attempt);
  };
  function attempt(): boolean {
    if (isBusy()) return false;
    stop();
    reload();
    return true;
  }
  return () => {
    if (waiting || attempt()) return;
    waiting = true;
    timer = setInterval(attempt, RELOAD_RETRY_MS);
    document.addEventListener('visibilitychange', attempt);
  };
};
