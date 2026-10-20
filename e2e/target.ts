// Cible des tests de bout en bout.
// - En CI (et avec E2E_TARGET=build en local) : le BUILD DE PRODUCTION (vite build, puis
//   vite preview sur le port 4173). Mêmes réglages que le build publié (CSP de production avec
//   l'origine du serveur, service worker, minification, découpage en morceaux), à un écart
//   près : le mode démo (`?demo=1`) y reste disponible (__E2E_DEMO__, vite.config.ts). Le
//   dossier dist-e2e n'est jamais publié.
// - Avec E2E_DIST=<dossier> : un build DÉJÀ construit, servi tel quel sans rien reconstruire.
//   La CI s'en sert pour passer e2e/production.spec.ts sur `dist`, le dossier exact que
//   deploy.yml publie. Ce build n'a pas le mode démo : seuls les parcours sans démo y ont un sens.
// - En local par défaut (ou E2E_TARGET=dev) : le serveur de développement (port 5173).
export const E2E_DIST = process.env.E2E_DIST || '';
export const E2E_BUILD = !!E2E_DIST || (process.env.E2E_TARGET ? process.env.E2E_TARGET === 'build' : !!process.env.CI);

/** Origine du serveur (Worker) : celle du build publié (.env.production), absente en développement. */
export const WORKER_ORIGIN = /^https:\/\/[^/]+\.workers\.dev\//;
