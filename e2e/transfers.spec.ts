// Virement entre deux comptes en mode démo (?demo=1) : refusé au-delà de votre part (le
// capital des parents ne bouge pas), puis enregistré avec « Annuler » dans le message de
// confirmation, comme un dépôt. L'annulation rend les deux soldes d'avant.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const accountRow = (page: Page, name: string) =>
  page.locator('tbody > tr').filter({ has: page.getByRole('button', { name: `${name} : voir les mouvements`, exact: true }) });

const openAccounts = async (page: Page, isMobile: boolean) => {
  if (isMobile) await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Comptes', exact: true }).click();
  else await page.locator('aside').getByRole('button', { name: 'Mes comptes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mes comptes', level: 2 })).toBeVisible();
};

test.describe('Virements (démo)', () => {
  test('virement entre deux comptes : votre part seulement, puis « Annuler »', async ({ page, isMobile }) => {
    // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
    await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
    await page.goto('/?demo=1&view=transfers');
    await expect(page.getByRole('heading', { name: 'Virements', level: 2 })).toBeVisible();
    await page.getByRole('tab', { name: 'Virement' }).click();

    // Démo : Livret A à 15 200 €, dont 8 200 € à vous et 7 000 € à vos parents ; LDDS à 3 000 €.
    await page.getByLabel('Compte de départ').selectOption({ label: 'Livret A' });
    await page.getByLabel("Compte d'arrivée").selectOption({ label: 'LDDS' });
    const amount = page.getByLabel('Montant du virement');
    const submit = page.getByRole('button', { name: 'Enregistrer le virement' });
    await amount.fill('9000');
    await submit.click();
    await expect(page.getByRole('alert')).toContainText(/Fonds insuffisants : votre part sur Livret A n'est que de 8\s200/);

    await amount.fill('500');
    await submit.click();
    await expect(page.getByText(/^Virement de 500,00\s€ : Livret A → LDDS$/)).toBeVisible();
    await expect(amount).toHaveValue('');

    await openAccounts(page, isMobile);
    await expect(accountRow(page, 'LDDS')).toContainText(/3\s500/);
    await expect(accountRow(page, 'Livret A')).toContainText(/14\s700/);

    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(accountRow(page, 'LDDS')).not.toContainText(/3\s500/);
    await expect(accountRow(page, 'LDDS')).toContainText(/3\s000/);
    await expect(accountRow(page, 'Livret A')).toContainText(/15\s200/);
  });
});
