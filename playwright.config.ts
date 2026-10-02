// Tests de bout en bout, en mode démo (données fictives, aucun compte Google, rien
// n'est écrit sur Drive). En local : le Chrome installé ; en CI : le Chromium de Playwright.
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

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
    baseURL: 'http://localhost:5173',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    ...(CI ? {} : { channel: 'chrome' }),
  },
  projects: [
    { name: 'ordinateur', use: { ...devices['Desktop Chrome'], ...(CI ? {} : { channel: 'chrome' }) } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...(CI ? {} : { channel: 'chrome' }) } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
