// Motivation en mode démo (?demo=1) : bons mois, point de paie, jalons et leur réglage.
import { test, expect, type Page } from '@playwright/test';
import { LATEST_VERSION } from '../src/changelog';

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
  const bar = page.getByRole('navigation', { name: 'Navigation principale' });
  const tab = bar.getByRole('button', { name: label, exact: true });
  if (await tab.count()) { await tab.click(); return; }
  await bar.getByRole('button', { name: 'Plus', exact: true }).click();
  await page.getByRole('dialog', { name: "Plus d'écrans" }).getByRole('button', { name: label, exact: true }).click();
};

/** Ouvre une carte des Paramètres (repliées par défaut). */
const openCard = async (page: Page, name: string) => {
  const button = page.locator('main').getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
};

test.describe('Motivation (démo)', () => {
  test('la carte « Bons mois » montre la paie en cours et la série', async ({ page }) => {
    await openDemo(page);
    const card = page.getByRole('region', { name: 'Bons mois', exact: true });
    await expect(card).toBeVisible();
    await expect(card).toContainText('/ 500 € mis de côté depuis la paie du');
    await expect(card).toContainText(/Série : \d+ bons? mois/);
    await expect(card).toContainText(/Joker \d{4}/);
    await expect(card.getByRole('progressbar', { name: /Mis de côté depuis la paie/ })).toBeVisible();
    await expect(card.getByRole('list', { name: 'Dernières paies' }).getByRole('listitem')).not.toHaveCount(0);
    await expect(card).toContainText('Prochain jalon');
  });

  test('le point de paie se valide puis disparaît', async ({ page }) => {
    await openDemo(page);
    const review = page.getByRole('region', { name: /Point de paie :/ });
    await expect(review).toBeVisible();
    await expect(review).toContainText('Versements');
    await review.getByRole('button', { name: 'Valider' }).click();
    await expect(review).toHaveCount(0);
  });

  test('la feuille des jalons s\'ouvre et liste les jalons', async ({ page }) => {
    await openDemo(page);
    await page.getByRole('button', { name: 'Voir vos jalons' }).click();
    const sheet = page.getByRole('dialog', { name: 'Vos jalons' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Premier bon mois')).toBeVisible();
    await expect(sheet.getByRole('listitem')).not.toHaveCount(0);
    await sheet.getByRole('button', { name: 'Fermer' }).first().click();
    await expect(sheet).toBeHidden();
  });

  test('un nouveau jalon est signalé une seule fois', async ({ page }) => {
    await openDemo(page);
    const card = page.getByRole('region', { name: 'Bons mois', exact: true });
    await expect(card.getByText('Nouveau jalon')).toBeVisible();
    await card.getByRole('button', { name: 'Merci' }).click();
    await expect(card.getByText('Nouveau jalon')).toHaveCount(0);
  });

  test('désactiver « Bons mois et jalons » masque la carte', async ({ page, isMobile }) => {
    await openDemo(page);
    await expect(page.getByRole('region', { name: 'Bons mois', exact: true })).toBeVisible();
    await goTo(page, 'Paramètres', isMobile);
    await openCard(page, 'Motivation');
    const toggle = page.getByRole('switch', { name: 'Bons mois et jalons' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByLabel("Seuil d'un bon mois")).toHaveCount(0);
    await goTo(page, 'Accueil', isMobile);
    await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
    await expect(page.getByRole('region', { name: 'Mon épargne nette' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bons mois', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: /Point de paie :/ })).toHaveCount(0);
  });
});
