// Endroit courant (écran et onglet) : dernier endroit ouvert, liens directs (notifications,
// raccourci d'ajout rapide, messages du service worker), onglet mémorisé de chaque écran, et
// ce qui suit un changement d'écran (titre de l'onglet, retour en haut, focus sur le titre).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  encodePlace, isTabOf, isView, parsePlace, placeIn, placeLabel, placeOf, samePlace,
  type Place, type Screen, type ScreenTab, type View,
} from '../navigation';
import { isSettingsSection, openSettingsSection } from '../components/settings/sections';
import { requestPaySheet } from '../components/pilot/paySheetRequest';
import { lsGetJSON, lsSetJSON } from '../lib/storage';
import { storageKey } from '../lib/storageKeys';
import { getNavDepth, initNavDepth, pushNavEntry, registerNav, setNavDepth } from './backHistory';

/** Retire un paramètre de l'adresse sans recharger la page (les autres paramètres restent). */
export const stripParam = (name: string) => {
  const params = new URLSearchParams(window.location.search);
  params.delete(name);
  const rest = params.toString();
  // L'état de l'entrée est gardé : il porte la profondeur de navigation (geste Retour).
  window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : ''));
};

// ---------------------------------------------------------------------------
// Onglet mémorisé de chaque écran (préférence de cet appareil)
// ---------------------------------------------------------------------------

const TABS_KEY = storageKey('screenTabs');
const isTabMap = (v: unknown): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Dernier onglet affiché de cet écran, s'il existe encore ; sinon l'onglet par défaut. */
export const rememberedPlace = (screen: Screen): Place => placeIn(screen, lsGetJSON(TABS_KEY, {}, isTabMap)[screen]);

const rememberTab = (screen: Screen, tab: ScreenTab) => {
  const map = lsGetJSON(TABS_KEY, {}, isTabMap);
  if (map[screen] === tab) return;
  lsSetJSON(TABS_KEY, { ...map, [screen]: tab });
};

// ---------------------------------------------------------------------------
// Endroit courant
// ---------------------------------------------------------------------------

interface NavState {
  place: Place;
  /** Compteur des changements d'endroit par navigation (pas par un onglet touché) : focus. */
  seq: number;
}

/**
 * Endroit affiché. Au premier chargement, le dernier endroit ouvert (`lastView`, enregistré
 * dans le fichier, ancien format compris) remplace l'Accueil, sauf si un lien direct a déjà
 * choisi l'écran. Chaque changement est mémorisé sur l'appareil (setLastView ne déclenche pas
 * d'écriture Drive), et l'onglet de chaque écran à onglets aussi.
 * - `navigate(view, tab?)` : liens internes et liens directs, toujours l'onglet de l'alias ;
 * - `openScreen(screen)` : barre du bas, « Plus », menu latéral, l'onglet mémorisé ;
 * - `selectTab(tab)` : un onglet touché dans l'écran (le focus reste sur l'onglet).
 * Geste Retour : changer d'écran ajoute une entrée à l'historique (l'adresse ne change pas) ;
 * Retour revient à l'écran précédent, avec son onglet. Un onglet touché n'en ajoute pas. Sur
 * l'entrée de départ, Retour quitte l'app comme avant.
 */
export const useViewState = (lastView: string, setLastView: (v: string) => void) => {
  const [{ place, seq }, setState] = useState<NavState>({ place: { screen: 'dashboard' }, seq: 0 });
  const deepLinkedRef = useRef(false);
  // Endroit de chaque profondeur d'historique (Retour y revient), et endroit courant lisible
  // hors d'un setState (l'entrée d'historique ne se pose pas dans une mise à jour d'état).
  const placesRef = useRef<Place[]>([]);
  const currentRef = useRef<Place>({ screen: 'dashboard' });
  const go = useCallback((next: Place) => {
    const current = currentRef.current;
    if (samePlace(current, next)) return;
    if (current.screen !== next.screen) pushNavEntry();
    currentRef.current = next;
    setState(s => (samePlace(s.place, next) ? s : { place: next, seq: s.seq + 1 }));
  }, []);
  const navigate = useCallback((v: View, tab?: string) => go(placeOf(v, tab)), [go]);
  /** Endroit ouvert par un lien direct : le dernier endroit enregistré ne le remplace plus. */
  const openLinkedView = useCallback((v: View, tab?: string) => { deepLinkedRef.current = true; navigate(v, tab); }, [navigate]);
  const openScreen = useCallback((screen: Screen) => go(rememberedPlace(screen)), [go]);
  const selectTab = useCallback((tab: ScreenTab) => setState(s => (
    isTabOf(s.place.screen, tab) && s.place.tab !== tab ? { place: { screen: s.place.screen, tab }, seq: s.seq } : s
  )), []);
  useEffect(() => {
    initNavDepth();
    return registerNav(state => {
      const depth = typeof state.pecNav === 'number' ? state.pecNav : 0;
      // Entrée de fenêtre restée dans l'historique (même profondeur) : rien à changer.
      if (depth === getNavDepth()) return;
      setNavDepth(depth);
      const target = placesRef.current[depth] ?? { screen: 'dashboard' };
      currentRef.current = target;
      setState(s => ({ place: target, seq: s.seq + 1 }));
    });
  }, []);
  // Mise à jour fonctionnelle : on lit l'endroit courant sans dépendre de lui, sinon revenir
  // à l'Accueil relancerait l'effet (avec l'ancien `lastView`) et renverrait aussitôt vers
  // l'écran précédent.
  useEffect(() => {
    const saved = parsePlace(lastView);
    if (!saved || deepLinkedRef.current) return;
    setState(s => (s.place.screen === 'dashboard' && !samePlace(s.place, saved) ? { place: saved, seq: s.seq + 1 } : s));
  }, [lastView]);
  useEffect(() => {
    currentRef.current = place;
    placesRef.current[getNavDepth()] = place;
    setLastView(encodePlace(place));
    if (place.tab) rememberTab(place.screen, place.tab);
  }, [place, setLastView]);
  return { place, seq, navigate, openLinkedView, openScreen, selectTab };
};

/**
 * Liens directs, traités une fois connecté et déverrouillé (`ready`) pour ne jamais rien
 * montrer par-dessus l'écran de connexion ou le verrou ; l'adresse est nettoyée ensuite pour
 * qu'un simple rechargement ne les rejoue pas.
 * - `?action=quickadd` : raccourci PWA « Ajouter un mouvement » (appui long sur l'icône) ;
 *   `?action=transfer` : la même feuille, ouverte sur Virement (« Faire un virement ») ;
 *   `?action=wish` : la même feuille, ouverte sur Envie (noter un achat envisagé à la volée) ;
 * - `?action=pay` (avec ou sans `view=pilot`) : raccourci « J'ai reçu ma paie » et
 *   notification de paie : le Pilotage s'ouvre directement sur le rituel (onglet « Ce mois »,
 *   jamais l'onglet mémorisé) ;
 * - `?view=update` (ancienne clé ou écran, avec `&tab=` facultatif) : endroit ouvert par une
 *   notification. Un écran inconnu de cette version (lien d'une version plus récente, encore
 *   en cours de mise à jour) reste dans l'adresse pour que la nouvelle version, chargée juste
 *   après, l'ouvre ;
 * - message `open-view` du service worker : app déjà ouverte au clic sur une notification.
 */
export const useDeepLinks = (ready: boolean, openLinkedView: (v: View, tab?: string) => void, openQuickAdd: (kind?: 'TRANSFER' | 'WISH') => void) => {
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action === 'quickadd' || action === 'transfer' || action === 'wish') {
      if (action === 'transfer') openQuickAdd('TRANSFER'); else if (action === 'wish') openQuickAdd('WISH'); else openQuickAdd();
      stripParam('action');
    }
    const target = params.get('view');
    if (params.get('action') === 'pay') {
      requestPaySheet();
      stripParam('action');
      if (!target) openLinkedView('pilot');
    }
    if (isView(target)) {
      // Le rituel de paie vit dans Pilotage › Ce mois : un lien de paie l'ouvre toujours.
      const tab = params.get('action') === 'pay' && placeOf(target).screen === 'pilot' ? null : params.get('tab');
      if (tab) openLinkedView(target, tab); else openLinkedView(target);
      stripParam('view');
      stripParam('tab');
    }
  }, [ready, openLinkedView, openQuickAdd]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const target: unknown = e.data && e.data.type === 'open-view' ? e.data.view : null;
      if (!isView(target)) return;
      // « Votre année » (notification de janvier) : l'année passe par l'adresse, lue par
      // Analyses › Évolution à l'ouverture, et par un événement s'il est déjà affiché.
      const year = typeof e.data.year === 'string' && /^\d{4}$/.test(e.data.year) ? e.data.year : null;
      if (year) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?year=${year}`);
        window.dispatchEvent(new CustomEvent('pecule:open-year', { detail: Number(year) }));
      }
      // Alertes de sécurité (retrait du verrou, suppression de sauvegarde) : la carte
      // concernée des Paramètres s'ouvre aussi, comme avec `?section=` au démarrage.
      if (target === 'settings' && isSettingsSection(e.data.section)) openSettingsSection(e.data.section);
      // Notification de paie : le rituel « J'ai reçu ma paie » s'ouvre avec Pilotage › Ce mois.
      const pay = target === 'pilot' && e.data.action === 'pay';
      if (pay) requestPaySheet();
      if (!pay && typeof e.data.tab === 'string') openLinkedView(target, e.data.tab); else openLinkedView(target);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [openLinkedView]);
};

/**
 * Titre de l'onglet du navigateur (« Comptes · Mouvements · Pécule ») à chaque changement
 * d'endroit, onglet compris. Changer d'écran (`seq`) : retour en haut et focus sur le titre de
 * l'écran (annoncé par les lecteurs d'écran), pas au tout premier affichage ; un onglet
 * touché garde le focus sur l'onglet.
 */
export const useViewFocus = (place: Place, seq: number, isAuthenticated: boolean, mainRef: RefObject<HTMLElement | null>) => {
  const label = placeLabel(place);
  useEffect(() => {
    document.title = isAuthenticated ? `${label} · Pécule` : 'Pécule';
  }, [label, isAuthenticated]);
  const firstViewRef = useRef(true);
  useEffect(() => {
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
  }, [seq, isAuthenticated, mainRef]);
};
