// Tests de bout en bout : surtout en mode démo (données fictives, aucun compte Google, rien
// n'est écrit sur Drive), plus quelques parcours sans démo contre un faux Drive (page.route).
// Cible : le build de production en CI, le serveur de développement en local (e2e/target.ts).
// En local : le Chrome installé ; en CI : le Chromium de Playwright.
import { defineConfig, devices } from '@playwright/test';
import { E2E_BUILD, E2E_DIST } from './e2e/target';

const CI = !!process.env.CI;
const PORT = E2E_BUILD ? 4173 : 5173;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // Le serveur de dev compile chaque écran à la première ouverture : peu de navigateurs à la fois.
  workers: 2,
  timeout: 60_000,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    // Le service worker du build répondrait à la place du réseau et échapperait à page.route
    // (faux Drive). Il est testé à part (e2e/production.spec.ts, qui l'autorise).
    serviceWorkers: 'block',
    ...(CI ? {} : { channel: 'chrome' }),
  },
  projects: [
    { name: 'ordinateur', use: { ...devices['Desktop Chrome'], ...(CI ? {} : { channel: 'chrome' }) } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...(CI ? {} : { channel: 'chrome' }) } },
  ],
  webServer: E2E_DIST
    ? {
      // Build déjà construit (CI : `dist`, le dossier que deploy.yml publie), servi tel quel.
      command: `npx vite preview --outDir "${E2E_DIST}" --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    }
    : E2E_BUILD
    ? {
      // Build de production (dossier à part, mode démo compris), servi tel quel.
      command: `npx vite build --outDir dist-e2e --emptyOutDir --logLevel warn && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
      env: { PECULE_E2E_BUILD: '1' },
      url: `http://localhost:${PORT}`,
      // Toujours reconstruit : un ancien build servi par erreur ferait tester autre chose.
      reuseExistingServer: false,
      timeout: 240_000,
    }
    : {
      command: 'npm run dev',
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
});
