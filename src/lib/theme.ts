// Thème de l'app : suivre le réglage du système, sauf choix explicite de l'utilisateur.
// Fonctions pures (le hook useTheme applique le résultat à la page).
// - « Automatique » (system) : clair ou sombre selon l'appareil, et suit ses changements
//   (bascule jour/nuit du téléphone) ;
// - « Clair » ou « Sombre » : choix enregistré sur cet appareil, seulement quand il est fait.

export type ThemePreference = 'system' | 'light' | 'dark';

/** Thème réellement affiché. */
export const resolveDark = (preference: ThemePreference, systemDark: boolean): boolean =>
  preference === 'system' ? systemDark : preference === 'dark';

/**
 * Choix enregistré lu au démarrage. L'ancienne clé « theme » était écrite dès le premier
 * lancement, même sans choix : une valeur identique au thème du système n'est donc pas un
 * choix (on revient à « Automatique ») ; une valeur différente en est très probablement un.
 * `choice` (nouvelle clé) l'emporte toujours.
 */
export const initialPreference = (choice: string | null, legacy: string | null, systemDark: boolean): ThemePreference => {
  if (choice === 'light' || choice === 'dark') return choice;
  if (legacy === 'light' || legacy === 'dark') return (legacy === 'dark') === systemDark ? 'system' : legacy;
  return 'system';
};

/** Bouton rapide de l'en-tête : passe au thème inverse de celui affiché (choix explicite). */
export const toggledPreference = (shownDark: boolean): ThemePreference => (shownDark ? 'light' : 'dark');

/**
 * Couleur de la barre d'état (meta theme-color) : celle de l'en-tête mobile
 * (surface-container), dans le thème affiché. Valeurs de secours = src/theme/m3.css.
 */
export const THEME_COLOR_FALLBACK = { light: '#ecefe9', dark: '#1d201d' } as const;

export const PREFERENCE_LABEL: Record<ThemePreference, string> = {
  system: 'Automatique',
  light: 'Clair',
  dark: 'Sombre',
};
