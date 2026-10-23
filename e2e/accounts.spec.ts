// Comptes en mode démo (?demo=1) : fraîcheur du solde compte par compte (« À faire » nomme
// le compte à revérifier, « Solde vérifié » l'éteint), performance d'un placement, rendement
// après inflation, et création d'un livret bancaire (nouveau type, imposé).
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const open = async (page: Page, view?: string) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto(`/?demo=1${view ? `&view=${view}` : ''}`);
};

const accountRow = (page: Page, name: string) =>
  page.locator('tbody > tr').filter({ has: page.getByRole('button', { name: `${name} : voir les mouvements`, exact: true }) });

test.describe('Comptes (démo)', () => {
  test("« À faire » nomme le compte à revérifier, et « Solde vérifié » l'éteint", async ({ page }) => {
    await open(page);
    const list = page.locator('#todo-list');
    await expect(list).toBeVisible();
    const more = list.getByRole('button', { name: /^Voir tout/ });
    if (await more.count()) await more.click();
    await expect(list.getByRole('listitem').filter({ hasText: 'Solde à vérifier : LEP (vérifié il y a 4 mois).' })).toBeVisible();

    await open(page, 'accounts');
    const lep = accountRow(page, 'LEP');
    await expect(lep).toContainText('Solde vérifié il y a 4 mois');
    await lep.getByRole('button', { name: /Solde vérifié/ }).click();
    await expect(accountRow(page, 'LEP')).toContainText("Solde vérifié aujourd'hui");
    await expect(accountRow(page, 'LEP').getByRole('button', { name: /Solde vérifié/ })).toHaveCount(0);
  });

  test("le placement affiche son gain et son rendement annuel ; Rendement montre l'effet de l'inflation", async ({ page }) => {
    await open(page, 'accounts');
    await expect(accountRow(page, 'Assurance vie')).toContainText(/Gain \+300\s€ · \+[\d,]+\s% par an depuis juin 2024/);

    await open(page, 'yield');
    await expect(page.getByRole('heading', { name: 'Rendement', level: 2 })).toBeVisible();
    const perf = page.getByRole('table', { name: /rendement annuel de chaque placement/ });
    await expect(perf.getByRole('row', { name: /Assurance vie/ })).toContainText(/\/ an/);
    await expect(page.getByRole('table', { name: /après inflation/ })).toContainText(/après inflation [+-][\d,]+\s%/);
    await expect(page.getByText(/selon l'INSEE/)).toBeVisible();
  });

  test("le taux servi d'une assurance vie se change à une date d'effet (historisé)", async ({ page }) => {
    await open(page, 'accounts');
    await page.getByRole('button', { name: 'Modifier Assurance vie' }).first().click();
    const rate = page.getByLabel('Taux servi (fonds euros)');
    await expect(rate).toHaveValue('2,6');
    await rate.fill('2,9');
    await page.getByLabel('Nouveau taux à partir du').fill(`${new Date().getFullYear()}-01-01`);
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByRole('button', { name: 'Modifier Assurance vie' }).first().click();
    await expect(page.getByLabel('Taux servi (fonds euros)')).toHaveValue('2,9');
    await expect(page.getByText('1 changement(s) de taux gardé(s)')).toBeVisible();
  });

  test('un livret bancaire se crée avec sa règle fiscale, et compte comme disponible', async ({ page }) => {
    await open(page, 'accounts');
    await page.getByRole('button', { name: 'Ajouter un compte' }).click();
    await page.getByRole('group', { name: 'Raccourcis de type de compte' }).getByRole('button', { name: 'Livret bancaire' }).click();
    await expect(page.getByText(/Intérêts imposés chaque année : 12,8\s%/)).toBeVisible();
    await page.getByLabel(/^Banque/).fill('Banque Boost');
    await page.getByLabel('Solde total').fill('2000');
    await page.getByLabel('Taux actuel').fill('3,5');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const row = accountRow(page, 'Livret bancaire');
    await expect(row).toContainText('Livret bancaire (imposé)');
    await expect(row).toContainText("Solde vérifié aujourd'hui");
  });
});
