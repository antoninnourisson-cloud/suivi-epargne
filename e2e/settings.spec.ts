// Paramètres en mode démo (?demo=1) : cartes repliables au clavier, cartes ouvertes
// mémorisées, saisie gardée dans une carte refermée, liens directs vers une carte.
import { test, expect, type Page } from '@playwright/test';
import { LATEST_VERSION } from '../src/changelog';

const openSettings = async (page: Page, query = '') => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto(`/?demo=1&view=settings${query}`);
  await expect(page.getByRole('heading', { name: 'Paramètres', level: 2 })).toBeVisible();
};

const cardButton = (page: Page, name: string) => page.locator('main').getByRole('button', { name, exact: true });
const cardRegion = (page: Page, name: string) => page.locator('main').getByRole('region', { name, exact: true });

test.describe('Paramètres (démo)', () => {
  test('toutes les cartes sont fermées au départ, avec un résumé', async ({ page }) => {
    await openSettings(page);
    const buttons = page.locator('main button[aria-expanded][aria-controls]');
    expect(await buttons.count()).toBeGreaterThanOrEqual(8);
    for (const b of await buttons.all()) await expect(b).toHaveAttribute('aria-expanded', 'false');
    await expect(cardButton(page, 'Motivation')).toHaveAccessibleDescription(/Activée · seuil 500/);
    await expect(cardButton(page, 'À propos')).toHaveAccessibleDescription(`Version ${LATEST_VERSION}`);
  });

  test('une carte s\'ouvre et se ferme au clavier', async ({ page }) => {
    await openSettings(page);
    const button = cardButton(page, 'Clés et services');
    const region = cardRegion(page, 'Clés et services');
    await expect(region).toBeHidden();
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(region).toBeVisible();
    await expect(region.getByLabel('Clé API Gemini (cet appareil)')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(region).toBeHidden();
  });

  test('les cartes ouvertes sont mémorisées après un rechargement', async ({ page }) => {
    await openSettings(page);
    await cardButton(page, 'Motivation').click();
    await cardButton(page, 'Fiscalité et barème').click();
    await expect(cardRegion(page, 'Motivation')).toBeVisible();
    await page.goto('/?demo=1&view=settings');
    await expect(page.getByRole('heading', { name: 'Paramètres', level: 2 })).toBeVisible();
    await expect(cardButton(page, 'Motivation')).toHaveAttribute('aria-expanded', 'true');
    await expect(cardButton(page, 'Fiscalité et barème')).toHaveAttribute('aria-expanded', 'true');
    await expect(cardButton(page, 'Clés et services')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('switch', { name: 'Bons mois et jalons' })).toBeVisible();
  });

  test('une saisie reste en place quand on referme puis rouvre la carte', async ({ page }) => {
    await openSettings(page);
    const button = cardButton(page, 'Clés et services');
    await button.click();
    const field = page.getByLabel('Modèle Gemini (facultatif)');
    await field.fill('gemini-test');
    await button.click();
    await expect(field).toBeHidden();
    await button.click();
    await expect(field).toHaveValue('gemini-test');
  });

  test('un lien direct ouvre la bonne carte et l\'amène à l\'écran', async ({ page }) => {
    await openSettings(page, '&section=tax-notice');
    const button = cardButton(page, "Avis d'imposition (LEP)");
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const region = cardRegion(page, "Avis d'imposition (LEP)");
    await expect(region).toBeVisible();
    await expect(region).toBeInViewport();
    await expect(button).toBeFocused();
    await expect(page).not.toHaveURL(/section=/);
    // Les autres cartes restent fermées.
    await expect(cardButton(page, 'Veille fiscale')).toHaveAttribute('aria-expanded', 'false');
  });

  test('la version dans la barre latérale ouvre « À propos »', async ({ page, isMobile }) => {
    test.skip(isMobile, 'barre latérale affichée sur ordinateur seulement');
    await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
    await page.goto('/?demo=1');
    await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
    await page.locator('aside').getByRole('button', { name: new RegExp(`version ${LATEST_VERSION.replace(/\./g, '\\.')}`) }).click();
    await expect(cardButton(page, 'À propos')).toHaveAttribute('aria-expanded', 'true');
    // L'en-tête de la carte est amené à l'écran (son contenu peut dépasser vers le bas).
    await expect(cardButton(page, 'À propos')).toBeInViewport();
    await expect(cardRegion(page, 'À propos').getByText('Historique des mises à jour')).toBeAttached();
  });
});
