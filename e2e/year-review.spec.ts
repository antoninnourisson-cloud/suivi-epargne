// « Votre année Pécule » en mode démo (?demo=1) : l'entrée de l'Historique, la feuille des
// pages, le lien direct de la notification et la désactivation de la motivation.
import { test, expect, type Page } from '@playwright/test';
import { LATEST_VERSION } from '../src/changelog';

const YEAR = new Date().getFullYear();

const openDemo = async (page: Page, query = '') => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto(`/?demo=1${query}`);
};

/** Ouvre un écran : barre latérale sur ordinateur, menu « Plus » sur mobile. */
const goTo = async (page: Page, label: string, isMobile: boolean) => {
  if (!isMobile) {
    await page.locator('aside').getByRole('button', { name: label, exact: true }).click();
    return;
  }
  const bar = page.getByRole('navigation', { name: 'Navigation principale' });
  const tab = bar.getByRole('button', { name: label, exact: true });
  if (await tab.count()) { await tab.click(); return; }
  await bar.getByRole('button', { name: 'Plus', exact: true }).click();
  await page.getByRole('dialog', { name: "Plus d'écrans" }).getByRole('button', { name: label, exact: true }).click();
};

const openYearSheet = async (page: Page) => {
  const entry = page.getByRole('region', { name: new RegExp(`Votre année ${YEAR}`) });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('année en cours');
  await expect(entry).toContainText(`Mis de côté en ${YEAR}`);
  await expect(entry).toContainText(/\d\s?€/);
  await entry.getByRole('button', { name: `Voir votre année ${YEAR}` }).click();
  const sheet = page.getByRole('dialog', { name: `Votre année ${YEAR}` });
  await expect(sheet).toBeVisible();
  return sheet;
};

test.describe('Votre année (démo)', () => {
  test('l\'Historique propose « Votre année » et ses pages', async ({ page, isMobile }) => {
    await openDemo(page);
    await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
    await goTo(page, 'Historique', isMobile);
    const sheet = await openYearSheet(page);
    await expect(sheet).toContainText('Année en cours');
    const pages = sheet.getByRole('list', { name: new RegExp(`Votre année ${YEAR}`) }).locator(':scope > li');
    expect(await pages.count()).toBeGreaterThanOrEqual(4);
    await expect(sheet.getByRole('heading', { name: new RegExp(`Mis de côté en ${YEAR}`) })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: /Épargne nette/ })).toBeAttached();
    await expect(sheet.getByRole('heading', { name: /Bons mois/ })).toBeAttached();
    await expect(sheet.getByRole('heading', { name: new RegExp(`Cap sur ${YEAR + 1}`) })).toBeAttached();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('le lien de la notification ouvre directement la feuille', async ({ page }) => {
    await openDemo(page, `&view=history&year=${YEAR}`);
    await expect(page.getByRole('dialog', { name: `Votre année ${YEAR}` })).toBeVisible();
    await expect(page).not.toHaveURL(/year=/);
  });

  test('sans « Bons mois et jalons », les pages de motivation disparaissent', async ({ page, isMobile }) => {
    await openDemo(page);
    await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
    await goTo(page, 'Paramètres', isMobile);
    const toggle = page.getByRole('switch', { name: 'Bons mois et jalons' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await goTo(page, 'Historique', isMobile);
    // Le bilan en chiffres bruts reste affiché, comme avant.
    await expect(page.getByRole('heading', { name: new RegExp(`Bilan ${YEAR}`) })).toBeVisible();
    const sheet = await openYearSheet(page);
    const pages = sheet.getByRole('list', { name: new RegExp(`Votre année ${YEAR}`) }).locator(':scope > li');
    expect(await pages.count()).toBeGreaterThanOrEqual(4);
    await expect(sheet.locator('[data-page="good-months"], [data-page="milestones"]')).toHaveCount(0);
    await expect(sheet.getByRole('heading', { name: /Bons mois/ })).toHaveCount(0);
    await expect(sheet.getByRole('heading', { name: /Jalons/ })).toHaveCount(0);
  });
});
