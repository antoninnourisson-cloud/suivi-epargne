// Point d'entrée commun des tests de bout en bout : à importer à la place de '@playwright/test'
// (règle ESLint dans eslint.config.js).
//
// Garde-fou : AUCUN test ne joint le vrai serveur (Worker de production). Le build testé en CI
// pointe vers lui (.env.production), et certains appels partent sans session (clé des
// notifications, veille fiscale) : sans ce garde-fou, la CI dépendrait du serveur en ligne.
// Toute requête vers lui échoue donc comme hors ligne, pour chaque test. Un test qui simule le
// serveur (faux Drive, démarrage) pose sa propre règle avec page.route, prioritaire sur
// celle-ci (règle du contexte).
import { test as base } from '@playwright/test';
import { WORKER_ORIGIN } from './target';

export const test = base.extend<{ noRealWorker: void }>({
  noRealWorker: [async ({ context }, use) => {
    await context.route(WORKER_ORIGIN, route => route.abort('internetdisconnected'));
    await use();
  }, { auto: true }],
});

export { expect } from '@playwright/test';
export type { Page, Route } from '@playwright/test';
