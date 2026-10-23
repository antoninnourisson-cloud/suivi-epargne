// « Lire un relevé » en mode démo (?demo=1) : lecture fictive (aucune clé, rien envoyé),
// relecture (comptes proposés, doublon décoché, compte sans correspondance écarté), import
// par la commande, puis « Annuler » qui remet les soldes d'avant.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const open = async (page: Page, view: string) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto(`/?demo=1&view=${view}`);
};
const pdf = { name: 'releve.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 relevé fictif') };

test.describe('Lire un relevé (démo)', () => {
  test('relecture, import des soldes et des opérations, puis annulation', async ({ page }) => {
    await open(page, 'update');
    // Premier affichage : le serveur de développement compile l'écran à la demande.
    await expect(page.getByRole('heading', { name: 'Actualiser les soldes', level: 2 })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Lire un relevé' }).click();
    const dialog = page.getByRole('dialog', { name: 'Lire un relevé' });
    await expect(dialog.getByText(/Mode démo/)).toBeVisible();
    await dialog.getByTestId('statement-file').setInputFiles(pdf);
    await expect(dialog.getByRole('heading', { name: 'Relecture du relevé' })).toBeVisible();

    // Comptes proposés : Livret A et compte courant reconnus, livret jeune sans correspondance.
    const selects = dialog.getByLabel('Compte dans Pécule');
    await expect(selects).toHaveCount(3);
    await expect(selects.nth(0)).toHaveValue('demo-la');
    await expect(selects.nth(1)).toHaveValue('demo-cc');
    await expect(selects.nth(2)).toHaveValue('');
    // L'épargne du mois est déjà saisie : décochée ; la prime est nouvelle : cochée.
    await expect(dialog.getByRole('checkbox', { name: /VIR EPARGNE DU MOIS.*Déjà enregistrée/ })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /VIR RECU PRIME/ })).toBeChecked();
    // Compte courant : seul le solde est repris par défaut.
    await expect(dialog.getByRole('checkbox', { name: /PRLV LOYER/ })).not.toBeChecked();
    await expect(dialog.getByText(/Relevé complet/).first()).toBeVisible();

    await dialog.getByRole('button', { name: 'Importer' }).click();
    await expect(dialog).toBeHidden();
    const toast = page.getByRole('status').filter({ hasText: "2 comptes mis à jour d'après le relevé (1 opération ajoutée)" });
    await expect(toast).toBeVisible();
    // Livret A : 15 200 € + 150 € de prime (la part des parents ne bouge pas).
    const livret = page.getByRole('button', { name: /^Livret A/ });
    await expect(livret).toContainText('Solde actuel : 15 350,00');

    await toast.getByRole('button', { name: 'Annuler' }).click();
    await expect(livret).toContainText('Solde actuel : 15 200,00');
  });

  test("depuis la fiche d'un compte", async ({ page }) => {
    await open(page, 'accounts');
    await page.getByRole('button', { name: 'Livret A : voir les mouvements', exact: true }).click({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Lire un relevé de Livret A' }).click();
    const dialog = page.getByRole('dialog', { name: 'Lire un relevé' });
    await expect(dialog.getByRole('button', { name: /Choisir le relevé/ })).toBeFocused();
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    await expect(dialog).toBeHidden();
  });
});
