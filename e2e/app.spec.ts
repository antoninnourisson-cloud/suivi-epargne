// Parcours principaux en mode démo (?demo=1) : chaque écran s'affiche, l'ajout rapide
// fonctionne, la part des parents ne peut pas être retirée, le clavier suffit.
import { test, expect, type Page } from '@playwright/test';
import { LATEST_VERSION } from '../src/changelog';

const SCREENS = [
  'Accueil', 'Actualiser les soldes', 'Mes comptes', 'Virements', 'Journal', 'Pilotage', 'Abonnements',
  'Fiches de paie', 'Dons et impôts', 'Rendement', 'Historique', 'Agenda', 'Part parentale', 'Paramètres',
];

const openDemo = async (page: Page) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

/** Ouvre un écran : barre latérale sur ordinateur, menu « Plus » sur mobile. */
const goTo = async (page: Page, label: string, isMobile: boolean) => {
  if (!isMobile) {
    await page.locator('aside').getByRole('button', { name: label, exact: true }).click();
    return;
  }
  const short: Record<string, string> = { 'Actualiser les soldes': 'Actualiser', 'Mes comptes': 'Comptes' };
  const bar = page.getByRole('navigation', { name: 'Navigation principale' });
  const tab = bar.getByRole('button', { name: short[label] ?? label, exact: true });
  if (await tab.count()) { await tab.click(); return; }
  await bar.getByRole('button', { name: 'Plus', exact: true }).click();
  await page.getByRole('dialog', { name: "Plus d'écrans" }).getByRole('button', { name: label, exact: true }).click();
};

test.describe('Pécule en mode démo', () => {
  test('chaque écran s\'affiche sans erreur', async ({ page, isMobile }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openDemo(page);
    for (const label of SCREENS) {
      await goTo(page, label, isMobile);
      await expect(page).toHaveTitle(new RegExp(`${label.replace(/[()]/g, '.')}|Pécule`));
      await expect(page.getByText("Cet écran n'a pas pu s'afficher")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test('ajout rapide d\'un dépôt', async ({ page }) => {
    await openDemo(page);
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await dialog.getByLabel('Compte').selectOption({ label: 'LDDS' });
    await dialog.getByLabel('Montant').fill('123');
    await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').getByText(/LDDS/)).toBeVisible();
  });

  test('un retrait ne peut pas entamer la part des parents', async ({ page }) => {
    await openDemo(page);
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await dialog.getByLabel('Compte').selectOption({ label: 'Livret A' });
    await dialog.getByRole('button', { name: 'Retrait' }).click();
    // Part propre de la démo : 8 200 € sur 15 200 €.
    await dialog.getByLabel('Montant').fill('9000');
    await expect(dialog.getByRole('alert')).toContainText('la part de vos parents ne peut pas être retirée');
    await expect(dialog.getByRole('button', { name: 'Ajouter', exact: true })).toBeDisabled();
  });

  test('clavier : lien d\'évitement et focus sur le titre de l\'écran', async ({ page, isMobile }) => {
    test.skip(isMobile, 'navigation au clavier testée sur ordinateur');
    await openDemo(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#contenu')).toBeFocused();
    await page.locator('aside').getByRole('button', { name: 'Pilotage', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pilotage', level: 2 })).toBeFocused();
  });
});
