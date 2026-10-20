// Aide à la déclaration de revenus en mode démo (?demo=1) : rappel de saison dans « À faire »,
// compte détenu à l'étranger (3916-bis) et ventes de crypto (2086) dans « Dons et impôts ».
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page, now: Date) => {
  await page.clock.setFixedTime(now);
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
  const short: Record<string, string> = { 'Mes comptes': 'Comptes' };
  const bar = page.getByRole('navigation', { name: 'Navigation principale' });
  const tab = bar.getByRole('button', { name: short[label] ?? label, exact: true });
  if (await tab.count()) { await tab.click(); return; }
  await bar.getByRole('button', { name: 'Plus', exact: true }).click();
  await page.getByRole('dialog', { name: "Plus d'écrans" }).getByRole('button', { name: label, exact: true }).click();
};

test.describe('Déclaration de revenus (démo)', () => {
  test('en avril, « À faire » rappelle la déclaration ; « C\'est déclaré » l\'éteint', async ({ page, isMobile }) => {
    await openDemo(page, new Date('2027-04-15T12:00:00'));
    const findAlert = async () => {
      const list = page.locator('#todo-list');
      await expect(list).toBeVisible();
      const more = list.getByRole('button', { name: /^Voir tout/ });
      if (await more.count()) await more.click();
      return list.getByRole('listitem').filter({ hasText: 'Déclaration des revenus 2026' });
    };
    const alert = await findAlert();
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('fin mai ou début juin selon votre département');
    await alert.getByRole('button', { name: 'Voir les cases' }).click();
    // L'aide est en bas de « Dons et impôts » : elle est amenée à l'écran.
    await expect(page.getByRole('region', { name: 'Déclaration de revenus' })).toBeInViewport();

    await goTo(page, 'Accueil', isMobile);
    const again = await findAlert();
    await again.getByRole('button', { name: "C'est déclaré" }).click();
    await expect(page.locator('#todo-list').getByRole('listitem').filter({ hasText: 'Déclaration des revenus 2026' })).toHaveCount(0);
  });

  test('un compte crypto à l\'étranger apparaît dans l\'aide (3916-bis, 2086)', async ({ page, isMobile }) => {
    await openDemo(page, new Date('2026-10-15T12:00:00'));
    await goTo(page, 'Mes comptes', isMobile);
    await page.getByRole('button', { name: 'Ajouter un compte' }).click();
    await page.getByLabel('Type', { exact: true }).selectOption('Crypto');
    await page.getByLabel('Nom du compte').fill('Binance');
    await page.getByLabel(/^Banque/).fill('Binance');
    // Nouveau compte crypto : « Oui » d'office, avec l'explication.
    const abroad = page.getByRole('group', { name: "Compte détenu à l'étranger" });
    await expect(abroad.getByRole('button', { name: 'Oui' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/formulaire 3916-bis/)).toBeVisible();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    // Enregistré : le formulaire se referme.
    await expect(page.getByLabel('Nom du compte')).toHaveCount(0);

    // Néobanque sans réponse : rien n'est enregistré, l'aide demandera de vérifier.
    await page.getByRole('button', { name: 'Ajouter un compte' }).click();
    await page.getByRole('button', { name: 'Compte courant', exact: true }).click();
    await page.getByLabel(/^Banque/).fill('Revolut');
    await expect(page.getByText(/Pas encore précisé/)).toBeVisible();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByLabel('Nom du compte')).toHaveCount(0);

    await goTo(page, 'Dons et impôts', isMobile);
    const helper = page.getByRole('region', { name: 'Déclaration de revenus' });
    await expect(helper).toBeVisible();
    await expect(helper.getByRole('combobox')).toHaveValue('2025');
    const abroadLine = helper.getByRole('listitem').filter({ hasText: '8UU · 3916-bis' });
    await expect(abroadLine).toContainText('Binance');
    await expect(abroadLine).toContainText('750 €');
    await expect(abroadLine.getByRole('link', { name: /impots\.gouv\.fr/ })).toHaveAttribute('href', /^https:\/\/www\.impots\.gouv\.fr\//);
    await expect(helper.getByRole('listitem').filter({ hasText: 'Ventes de cryptomonnaies' })).toContainText('2086');
    await expect(helper.getByRole('listitem').filter({ hasText: 'Revolut' }).filter({ hasText: "établissement à l'étranger ?" })).toContainText('IBAN');
  });
});
