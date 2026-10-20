// Déconnexion avec des modifications pas encore sur Drive (mode démo : rien n'est jamais
// envoyé) : deux choix clairs, « Envoyer puis se déconnecter » ou « Se déconnecter sans
// envoyer », et « Annuler ». Un envoi qui échoue laisse connecté, avec un message.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page) => {
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

const addDeposit = async (page: Page) => {
  await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
  await dialog.getByLabel('Compte').selectOption({ label: 'LDDS' });
  await dialog.getByLabel('Montant').fill('50');
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(dialog).toBeHidden();
};

const askLogout = async (page: Page, isMobile: boolean) => {
  if (isMobile) await page.getByRole('banner').getByRole('button', { name: 'Se déconnecter' }).click();
  else await page.locator('aside').getByRole('button', { name: 'Déconnexion' }).click();
};

test.describe('Déconnexion avec des modifications non envoyées (démo)', () => {
  test('deux choix clairs ; un envoi raté laisse connecté ; « sans envoyer » déconnecte', async ({ page, isMobile }) => {
    await openDemo(page);
    await addDeposit(page);

    await askLogout(page, isMobile);
    const dialog = page.getByRole('dialog', { name: 'Modifications pas encore sur Drive' });
    await expect(dialog.getByRole('button', { name: 'Envoyer puis se déconnecter' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Se déconnecter sans envoyer' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialog).toBeHidden();

    // En démo, rien ne part sur Drive : l'envoi échoue, on reste connecté.
    await askLogout(page, isMobile);
    await dialog.getByRole('button', { name: 'Envoyer puis se déconnecter' }).click();
    await expect(dialog.getByText(/L'envoi n'a pas abouti/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();

    await dialog.getByRole('button', { name: 'Se déconnecter sans envoyer' }).click();
    await expect(page.getByRole('heading', { name: 'Pécule', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toHaveCount(0);
  });
});
