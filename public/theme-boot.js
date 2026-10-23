/* global window, document */
// Thème sombre appliqué AVANT le premier affichage : sans lui, un appareil en mode sombre
// voyait un éclair clair le temps que l'app se charge (la CSP interdit un script intégré à la
// page, d'où ce petit fichier chargé tôt, sans attendre). Même règle que
// src/lib/theme.ts (initialPreference puis resolveDark) : choix enregistré (« theme_choice »),
// sinon l'ancienne clé « theme », sinon le réglage de l'appareil. src/hooks/useTheme.ts
// reprend la main au démarrage de l'app ; src/lib/themeBoot.test.ts vérifie l'accord.
(function () {
  try {
    var store = window.localStorage;
    var choice = store.getItem('theme_choice');
    var legacy = store.getItem('theme');
    var saved = choice === 'light' || choice === 'dark' ? choice : legacy === 'light' || legacy === 'dark' ? legacy : null;
    var dark = saved ? saved === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch { /* stockage bloqué : l'app appliquera le thème au démarrage */ }
})();
