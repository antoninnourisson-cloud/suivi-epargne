// Écran « Actualiser les soldes » en mode démo : une ligne par compte, dépliable, et
// l'enregistrement d'un nouveau solde se retrouve dans « Mes comptes ».
import { test, expect, type Page } from './fixtures';
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

  test('en janvier, les intérêts de l’année écoulée sont proposés à part (hors épargne)', async ({ page, isMobile }) => {
    await openUpdate(page, isMobile);
    await page.getByRole('button', { name: /^LEP/ }).click();
    // Démo : LEP de 10 000 € à 2,5 %, sans mouvement ⇒ 250 € d'intérêts 2025, crédités au 31/12.
    await page.getByLabel('Date du relevé de LEP').fill('2026-01-05');
    await page.getByLabel('Ma part sur LEP').fill('7800');
    const interest = page.getByLabel('Dont intérêts sur LEP');
    await expect(interest).toHaveValue('250');
    await expect(page.getByText(/le reste \(50,00\s€\) est un versement/)).toBeVisible();
    await interest.fill('300');
    await expect(page.getByText(/le reste \(0,00\s€\) est un versement/)).toBeVisible();
    await interest.fill('400');
    await page.getByRole('button', { name: 'Tout enregistrer' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'LEP' })).toContainText('Plus que la hausse de votre part');
    await interest.fill('250');
    await page.getByRole('button', { name: 'Tout enregistrer' }).click();
    await expect(page.getByText('1 compte modifié')).toBeHidden();
    await expect(page.getByRole('button', { name: /^LEP/ })).toContainText('10 300,00');
  });

  test('placement : la hausse des versements cumulés est un versement, le reste une valorisation', async ({ page, isMobile }) => {
    await openUpdate(page, isMobile);
    await page.getByRole('button', { name: /^Assurance vie/ }).click();
    // Démo : 4 300 € dont 4 000 € versés.
    await page.getByLabel('Ma part sur Assurance vie').fill('4500');
    const cash = page.getByLabel('Dont argent versé sur Assurance vie');
    await expect(cash).toHaveValue('0');
    await page.getByLabel('Versements cumulés sur Assurance vie').fill('4150');
    await expect(cash).toHaveValue('150');
    await expect(page.getByText(/le reste \(50,00\s€\) est une variation de valeur/i)).toBeVisible();
    await page.getByRole('button', { name: 'Tout enregistrer' }).click();
    await expect(page.getByText('1 compte modifié')).toBeHidden();
    await expect(page.getByRole('button', { name: /^Assurance vie/ })).toContainText('4 500,00');
  });

  test('la saisie survit à un changement d’écran, et « Abandonner » l’efface', async ({ page, isMobile }) => {
    await openUpdate(page, isMobile);
    await page.getByRole('button', { name: /^LDDS/ }).click();
    await page.getByLabel('Ma part sur LDDS').fill('12345');
    await expect(page.getByText('1 compte modifié')).toBeVisible();
    if (isMobile) await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Accueil', exact: true }).click();
    else await page.locator('aside').getByRole('button', { name: 'Accueil', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeVisible();
    if (isMobile) await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Actualiser', exact: true }).click();
    else await page.locator('aside').getByRole('button', { name: 'Actualiser les soldes', exact: true }).click();
    await expect(page.getByLabel('Ma part sur LDDS')).toHaveValue('12345');
    await expect(page.getByText('1 compte modifié (saisie restaurée)')).toBeVisible();
    await page.getByRole('button', { name: 'Abandonner' }).click();
    await expect(page.getByText(/compte modifié/)).toBeHidden();
    await expect(page.getByLabel('Ma part sur LDDS')).toHaveValue('3000');
  });

  test('une saisie illisible est refusée, jamais enregistrée comme 0 €', async ({ page, isMobile }) => {
    await openUpdate(page, isMobile);
    await page.getByRole('button', { name: /^LDDS/ }).click();
    await page.getByLabel('Ma part sur LDDS').fill('1.234,56');
    await expect(page.getByText('Montant non reconnu.')).toBeVisible();
    await page.getByRole('button', { name: 'Tout enregistrer' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'LDDS :' })).toContainText('Montant non reconnu');
    await expect(page.getByRole('button', { name: /^LDDS/ })).toContainText('3 000,00');
  });
});
