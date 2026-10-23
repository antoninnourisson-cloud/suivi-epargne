// Écran courant : dernier écran ouvert, liens directs (notifications, raccourci d'ajout
// rapide, messages du service worker), et ce qui suit un changement d'écran (titre de
// l'onglet, retour en haut, focus sur le titre).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { isView, navLabel, type View } from '../navigation';
import { isSettingsSection, openSettingsSection } from '../components/settings/sections';

/** Retire un paramètre de l'adresse sans recharger la page (les autres paramètres restent). */
export const stripParam = (name: string) => {
  const params = new URLSearchParams(window.location.search);
  params.delete(name);
  const rest = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
};

/**
 * Écran affiché. Au premier chargement, le dernier écran ouvert (`lastView`, enregistré dans
 * le fichier) remplace l'Accueil, sauf si un lien direct a déjà choisi l'écran. Chaque
 * changement est mémorisé sur l'appareil (setLastView ne déclenche pas d'écriture Drive).
 */
export const useViewState = (lastView: string, setLastView: (v: string) => void) => {
  const [view, setView] = useState<View>('dashboard');
  const deepLinkedRef = useRef(false);
  /** Écran ouvert par un lien direct : le dernier écran enregistré ne le remplace plus. */
  const openLinkedView = useCallback((v: View) => { deepLinkedRef.current = true; setView(v); }, []);
  // Mise à jour fonctionnelle : on lit l'écran courant sans dépendre de `view`, sinon revenir
  // à l'Accueil relancerait l'effet (avec l'ancien `lastView`) et renverrait aussitôt vers
  // l'écran précédent.
  useEffect(() => {
    if (!isView(lastView) || deepLinkedRef.current) return;
    setView(v => (v === 'dashboard' ? lastView : v));
  }, [lastView]);
  useEffect(() => { setLastView(view); }, [view, setLastView]);
  return { view, setView, openLinkedView };
};

/**
 * Liens directs, traités une fois connecté et déverrouillé (`ready`) pour ne jamais rien
 * montrer par-dessus l'écran de connexion ou le verrou ; l'adresse est nettoyée ensuite pour
 * qu'un simple rechargement ne les rejoue pas.
 * - `?action=quickadd` : raccourci PWA « Ajouter un mouvement » (appui long sur l'icône) ;
 * - `?view=update` : écran ouvert par une notification. Un écran inconnu de cette version
 *   (lien d'une version plus récente, encore en cours de mise à jour) reste dans l'adresse
 *   pour que la nouvelle version, chargée juste après, l'ouvre ;
 * - message `open-view` du service worker : app déjà ouverte au clic sur une notification.
 */
export const useDeepLinks = (ready: boolean, openLinkedView: (v: View) => void, openQuickAdd: () => void) => {
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'quickadd') {
      openQuickAdd();
      stripParam('action');
    }
    const target = params.get('view');
    if (isView(target)) {
      openLinkedView(target);
      stripParam('view');
    }
  }, [ready, openLinkedView, openQuickAdd]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const target: unknown = e.data && e.data.type === 'open-view' ? e.data.view : null;
      if (!isView(target)) return;
      // « Votre année » (notification de janvier) : l'année passe par l'adresse, lue par
      // Historique à l'ouverture, et par un événement s'il est déjà affiché.
      const year = typeof e.data.year === 'string' && /^\d{4}$/.test(e.data.year) ? e.data.year : null;
      if (year) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?year=${year}`);
        window.dispatchEvent(new CustomEvent('pecule:open-year', { detail: Number(year) }));
      }
      // Alertes de sécurité (retrait du verrou, suppression de sauvegarde) : la carte
      // concernée des Paramètres s'ouvre aussi, comme avec `?section=` au démarrage.
      if (target === 'settings' && isSettingsSection(e.data.section)) openSettingsSection(e.data.section);
      openLinkedView(target);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [openLinkedView]);
};

/**
 * Changer d'écran : titre de l'onglet, retour en haut, et focus sur le titre de l'écran
 * (annoncé par les lecteurs d'écran). Pas au tout premier affichage.
 */
export const useViewFocus = (view: View, isAuthenticated: boolean, mainRef: RefObject<HTMLElement | null>) => {
  const firstViewRef = useRef(true);
  useEffect(() => {
    document.title = isAuthenticated ? `${navLabel(view)} · Pécule` : 'Pécule';
    const main = mainRef.current;
    if (!main) return;
    main.scrollTo({ top: 0 });
    if (firstViewRef.current) { firstViewRef.current = false; return; }
    // Le titre de l'écran (h1 ou h2) ; à défaut, la zone principale elle-même. Les écrans
    // chargés à la demande peuvent arriver après coup : on réessaie tant que le focus n'est
    // pas posé dans le nouvel écran (1,5 s au plus).
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const h = main.querySelector<HTMLElement>('h1, h2');
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      const settled = h && document.activeElement === h;
      if (settled || tries >= 15) {
        clearInterval(t);
        if (!settled) main.focus({ preventScroll: true });
      }
    }, 100);
    return () => clearInterval(t);
  }, [view, isAuthenticated, mainRef]);
};
