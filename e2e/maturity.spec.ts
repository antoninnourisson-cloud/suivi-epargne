// Libellés de maturité fiscale et taux nets honnêtes, en mode démo (?demo=1).
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const open = async (page: Page, view: string) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto(`/?demo=1&view=${view}`);
};

test.describe('Maturité fiscale (démo)', () => {
  test("l'assurance vie annonce un impôt réduit, et rappelle les prélèvements sociaux dus", async ({ page }) => {
    await open(page, 'accounts');
    const row = page.getByRole('row').filter({ hasText: 'Assureur Démo' });
    await expect(row).toContainText(/Impôt réduit dans \d+ mois/);
    await expect(row).toContainText(/prélèvements sociaux \(17,2\s%\) toujours dus/);
    await expect(row).not.toContainText(/Exonéré d'impôt/i);
  });
});
