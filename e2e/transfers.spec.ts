// Virement entre deux comptes en mode démo (?demo=1), dans la feuille du bouton « Mouvement »
// (choix « Virement ») ; « Faire un virement » de Comptes › Mouvements (ancienne adresse
// ?view=transfers) et `?action=transfer` l'ouvrent directement. Refusé au-delà de votre part
// (le capital des parents ne bouge pas), puis enregistré avec « Annuler » dans le message de
// confirmation, comme un dépôt. L'annulation rend les deux soldes d'avant.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';
import { goTo } from './nav';

const accountRow = (page: Page, name: string) =>
  page.locator('tbody > tr').filter({ has: page.getByRole('button', { name: `${name} : voir les mouvements`, exact: true }) });

const openAccounts = async (page: Page, isMobile: boolean) => {
  await goTo(page, 'Mes comptes', isMobile);
  await expect(page.getByRole('heading', { name: 'Mes comptes', level: 3, exact: true })).toBeVisible();
};

test.describe('Virements (démo)', () => {
  test('virement entre deux comptes : votre part seulement, puis « Annuler »', async ({ page, isMobile }) => {
    // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
    await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
    await page.goto('/?demo=1&view=transfers');
    await expect(page).toHaveTitle('Comptes · Mouvements · Pécule');
    await page.locator('main').getByRole('button', { name: 'Faire un virement' }).click();
    const sheet = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await expect(sheet.getByRole('button', { name: 'Virement', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Démo : Livret A à 15 200 €, dont 8 200 € à vous et 7 000 € à vos parents ; LDDS à 3 000 €.
    await sheet.getByLabel('Compte de départ').selectOption({ label: 'Livret A' });
    await sheet.getByLabel("Compte d'arrivée").selectOption({ label: 'LDDS' });
    const amount = sheet.getByLabel('Montant');
    const submit = sheet.getByRole('button', { name: 'Enregistrer le virement' });
    await amount.fill('9000');
    await expect(sheet.getByRole('alert')).toContainText(/Votre part sur ce compte est de 8\s200.*la part de vos parents ne peut pas être retirée/);
    await expect(submit).toBeDisabled();

    await amount.fill('500');
    await submit.click();
    await expect(page.getByText(/^Virement de 500,00\s€ : Livret A → LDDS$/)).toBeVisible();
    await expect(sheet).toHaveCount(0);

    await openAccounts(page, isMobile);
    await expect(accountRow(page, 'LDDS')).toContainText(/3\s500/);
    await expect(accountRow(page, 'Livret A')).toContainText(/14\s700/);

    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(accountRow(page, 'LDDS')).not.toContainText(/3\s500/);
    await expect(accountRow(page, 'LDDS')).toContainText(/3\s000/);
    await expect(accountRow(page, 'Livret A')).toContainText(/15\s200/);
  });

  test('un seul formulaire : le bouton « Mouvement » propose Dépôt, Retrait, Virement et Envie ; Mouvements garde les échéances récurrentes', async ({ page }) => {
    await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
    await page.goto('/?demo=1&view=transfers');
    await expect(page).toHaveTitle('Comptes · Mouvements · Pécule');
    const main = page.locator('main');
    await expect(main.getByRole('button', { name: 'Faire un virement' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Échéances récurrentes' })).toBeVisible();
    await expect(main.getByLabel('Montant du virement')).toHaveCount(0);
    // « Ajouter un mouvement » (bouton flottant ou menu latéral) : dépôt par défaut.
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
    const sheet = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    const kinds = sheet.getByRole('group', { name: 'Type de mouvement' }).getByRole('button');
    await expect(kinds).toHaveText(['Dépôt', 'Retrait', 'Virement', 'Envie']);
    await expect(sheet.getByRole('button', { name: 'Dépôt' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('lien « Faire un virement » (?action=transfer) : la feuille s’ouvre sur Virement', async ({ page }) => {
    await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
    await page.goto('/?demo=1&action=transfer');
    const sheet = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await expect(sheet.getByRole('button', { name: 'Virement', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByLabel("Compte d'arrivée")).toBeVisible();
  });
});
