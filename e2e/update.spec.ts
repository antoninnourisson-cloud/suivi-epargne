// Écran « Actualiser les soldes » en mode démo : une ligne par compte, dépliable, et
// l'enregistrement d'un nouveau solde se retrouve dans « Mes comptes ».
import { test, expect, type Page } from '@playwright/test';
import { LATEST_VERSION } from '../src/changelog';

const openUpdate = async (page: Page, isMobile: boolean) => {
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
  if (isMobile) await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Actualiser', exact: true }).click();
  else await page.locator('aside').getByRole('button', { name: 'Actualiser les soldes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Actualiser les soldes', level: 2 })).toBeVisible();
};

test.describe('Actualiser les soldes (démo)', () => {
  test('une ligne repliée par compte, qui se déplie au clavier', async ({ page, isMobile }) => {
    await openUpdate(page, isMobile);
    const row = page.getByRole('button', { name: /^LDDS/ });
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel('Ma part sur LDDS')).toBeHidden();
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Ma part sur LDDS')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tout enregistrer' })).toBeDisabled();
  });

  test('un nouveau solde est enregistré', async ({ page, isMobile }) => {
    await openUpdate(page, isMobile);
    await page.getByRole('button', { name: /^LDDS/ }).click();
    // Démo : LDDS à 3 000 €, sans part parentale.
    await page.getByLabel('Ma part sur LDDS').fill('3250');
    const row = page.getByRole('button', { name: /^LDDS/ });
    await expect(row).toContainText('en hausse de 250 €');
    await expect(page.getByText('1 compte modifié')).toBeVisible();
    await page.getByRole('button', { name: 'Tout enregistrer' }).click();
    await expect(page.getByText('1 compte modifié')).toBeHidden();
    await expect(row).toContainText('3 250,00');
    await expect(row).not.toContainText('en hausse');
  });

  test('ajustement « − x € » sur la part des parents', async ({ page, isMobile }) => {
    await openUpdate(page, isMobile);
    await page.getByRole('button', { name: /^Livret A/ }).click();
    await page.getByRole('group', { name: 'Façon de saisir le solde de Livret A' }).getByRole('button', { name: 'Ajuster' }).click();
    await page.getByRole('group', { name: "Sens de l'ajustement sur Livret A" }).getByRole('button', { name: /Retirer/ }).click();
    await page.getByRole('group', { name: 'Part concernée sur Livret A' }).getByRole('button', { name: 'Parents' }).click();
    // Démo : 7 000 € de part parentale ; en retirer davantage est refusé.
    const amount = page.getByLabel("Montant de l'ajustement sur Livret A");
    await amount.fill('8000');
    await page.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page.getByRole('alert')).toContainText('la part des parents deviendrait négative');
    await amount.fill('500');
    await amount.press('Enter');
    await expect(page.getByRole('button', { name: /^Livret A/ })).toContainText('en baisse de 500 €');
  });
});
