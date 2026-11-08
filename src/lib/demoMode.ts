// Porte du mode démo (`?demo=1`, données fictives, sans Google) : ouverte en développement et
// dans le build de production des tests de bout en bout (__E2E_DEMO__, voir vite.config.ts),
// fermée dans le build publié. Rolldown ne replie PAS un appel de fonction : chaque `import()` de
// src/dev/ est donc gardé par la condition écrite en toutes lettres
// (`import.meta.env.DEV || __E2E_DEMO__`), repliée à `false` au build publié, qui emporte
// l'import() : aucun fichier demo*.js dans dist ni dans le précache (scripts/check-bundle-size.mjs
// le vérifie).
/** Vrai si la page est ouverte avec `?demo=1` ET que la porte est ouverte. */
export const demoRequested = (): boolean => (import.meta.env.DEV || __E2E_DEMO__) && new URLSearchParams(window.location.search).has('demo');
