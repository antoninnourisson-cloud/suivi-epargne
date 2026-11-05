// Geste Retour (Android) en mode démo : Retour ferme la feuille du dessus sans quitter l'app,
// puis revient à l'écran précédent ; l'adresse (?demo=1) reste intacte.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';
import { placeTitle } from './nav';

const openDemo = async (page: Page) => {
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
  await page.setViewportSize({ width: 412, height: 800 });
};

test.describe('Geste Retour', () => {
  test('Retour ferme la feuille, l\'app reste ouverte ; changer d\'écran, Retour revient', async ({ page }) => {
    await openDemo(page);

    // Une feuille : Retour la ferme et l'app reste là.
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveTitle(placeTitle('Accueil'));
    expect(page.url()).toContain('demo=1');

    // Fermée par son bouton : plus d'entrée en trop, un seul Retour suffit pour l'écran d'avant.
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).first().click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Fermer' }).click();
    await expect(sheet).toBeHidden();

    // Changer d'écran : Retour revient à l'Accueil.
    await page.getByRole('navigation').getByRole('button', { name: 'Pilotage' }).click();
    await expect(page).toHaveTitle(placeTitle('Pilotage'));
    await page.goBack();
    await expect(page).toHaveTitle(placeTitle('Accueil'));
    expect(page.url()).toContain('demo=1');
  });
});
