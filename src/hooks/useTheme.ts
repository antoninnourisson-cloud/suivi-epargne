// Thème de l'app, partagé par tous les écrans (en-tête, Paramètres) : un seul état pour la
// page. Les règles sont dans lib/theme ; ici on les applique :
// - classe `dark` sur <html> ;
// - couleur de la barre d'état (meta theme-color) accordée au thème AFFICHÉ, pas à celui du
//   système (barre sombre au-dessus d'une app claire dans la PWA installée) ;
// - « Automatique » suit les changements du système en direct (matchMedia) ;
// - rien n'est enregistré tant que l'utilisateur n'a pas choisi.
import { useSyncExternalStore } from 'react';
import { lsDel, lsGet, lsSet } from '../lib/storage';
import { storageKey } from '../lib/storageKeys';
import {
  THEME_COLOR_FALLBACK, initialPreference, resolveDark, toggledPreference, type ThemePreference,
} from '../lib/theme';

const CHOICE_KEY = storageKey('themeChoice');
const LEGACY_KEY = storageKey('theme');
const DARK_QUERY = '(prefers-color-scheme: dark)';

interface ThemeState { preference: ThemePreference; isDark: boolean }

let state: ThemeState | null = null;
let systemDark = false;
const listeners = new Set<() => void>();

const query = (): MediaQueryList | null => {
  try { return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null; } catch { return null; }
};

/** Couleur de l'en-tête mobile dans le thème affiché (lue sur la page, sinon valeur connue). */
const syncThemeColor = (dark: boolean) => {
  let color = '';
  try { color = getComputedStyle(document.documentElement).getPropertyValue('--md-surface-container').trim(); } catch { /* page sans styles */ }
  if (!color) color = dark ? THEME_COLOR_FALLBACK.dark : THEME_COLOR_FALLBACK.light;
  const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
  metas.forEach((meta, i) => {
    // Une seule balise, sans condition « media » : le navigateur prendrait sinon celle du
    // système, même si l'app affiche l'autre thème.
    if (i === 0) { meta.removeAttribute('media'); meta.content = color; } else meta.remove();
  });
  if (metas.length === 0) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = color;
    document.head.appendChild(meta);
  }
};

const apply = (preference: ThemePreference) => {
  const isDark = resolveDark(preference, systemDark);
  document.documentElement.classList.toggle('dark', isDark);
  syncThemeColor(isDark);
  state = { preference, isDark };
  listeners.forEach(l => l());
};

const init = (): ThemeState => {
  if (state) return state;
  const mq = query();
  systemDark = !!mq?.matches;
  const preference = initialPreference(lsGet(CHOICE_KEY), lsGet(LEGACY_KEY), systemDark);
  // Ancienne clé reprise une fois : un choix probable est recopié, puis elle disparaît.
  if (lsGet(LEGACY_KEY) !== null) {
    if (preference !== 'system') lsSet(CHOICE_KEY, preference);
    lsDel(LEGACY_KEY);
  }
  mq?.addEventListener?.('change', e => {
    systemDark = e.matches;
    if (state?.preference === 'system') apply('system');
  });
  apply(preference);
  return state!;
};

const subscribe = (listener: () => void) => {
  init();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Choix explicite : enregistré (sauf « Automatique », qui efface le choix). */
const setThemePreference = (preference: ThemePreference) => {
  init();
  if (preference === 'system') lsDel(CHOICE_KEY);
  else lsSet(CHOICE_KEY, preference);
  apply(preference);
};

/** Pour les tests : oublie l'état (nouvelle lecture du stockage et du système). */
export const resetThemeForTests = () => { state = null; listeners.clear(); };

export const useTheme = () => {
  const current = useSyncExternalStore(subscribe, init, init);
  return {
    preference: current.preference,
    isDark: current.isDark,
    setPreference: setThemePreference,
    /** Bouton rapide : passe au thème inverse de celui affiché. */
    toggleTheme: () => setThemePreference(toggledPreference(current.isDark)),
  };
};
