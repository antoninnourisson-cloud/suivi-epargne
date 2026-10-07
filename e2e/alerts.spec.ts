// Alertes chiffrées en euros (lib/alerts) dans « À faire », en mode démo (?demo=1).
import { test, expect, type Page } from '@playwright/test';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

test.describe('Alertes chiffrées (démo)', () => {
  test("l'argent qui dort sur le compte courant est chiffré, et « Plus tard » le masque", async ({ page }) => {
    await openDemo(page);
    const list = page.locator('#todo-list');
    await expect(list).toBeVisible();
    const alert = list.getByRole('listitem').filter({ hasText: /dorment sur votre compte courant/ });
    await expect(alert).toBeVisible();
    // Puce du gain : « +39 €/an », avec le texte complet pour les lecteurs d'écran.
    const chip = alert.getByTestId('gain-chip');
    await expect(chip).toContainText(/\+\d[\d\s]*\s€\/an/);
    await expect(chip).toContainText(/Gain estimé : \d[\d\s]*\s€ d'intérêts par an/);
    await alert.getByRole('button', { name: 'Plus tard' }).click();
    await expect(list.getByRole('listitem').filter({ hasText: /dorment sur votre compte courant/ })).toHaveCount(0);
  });

  test('la place libérée par la restitution est annoncée avec sa valeur', async ({ page }) => {
    await openDemo(page);
    const list = page.locator('#todo-list');
    const more = list.getByRole('button', { name: /^Voir tout/ });
    if (await more.count()) await more.click();
    const alert = list.getByRole('listitem').filter({ hasText: /Après la restitution/ });
    await expect(alert).toContainText(/7\s000\s€ de place sur le Livret A/);
    await expect(alert.getByTestId('gain-chip')).toContainText(/€\/an/);
  });
});
