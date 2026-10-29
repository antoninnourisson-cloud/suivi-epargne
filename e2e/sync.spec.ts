// Déconnexion avec des modifications pas encore sur Drive (mode démo : rien n'est jamais
// envoyé) : deux choix clairs, « Envoyer puis se déconnecter » ou « Se déconnecter sans
// envoyer », et « Annuler ». Un envoi qui échoue laisse connecté, avec un message. Sur mobile,
// la déconnexion est dans Paramètres (plus dans l'en-tête) ; l'état de la synchronisation de
// l'en-tête s'ouvre en feuille de détail.
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
  if (isMobile) {
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Plus' }).click();
    await page.getByRole('dialog', { name: "Plus d'écrans" }).getByRole('button', { name: 'Paramètres' }).click();
    await page.locator('main').getByRole('button', { name: 'Se déconnecter' }).click();
  } else await page.locator('aside').getByRole('button', { name: 'Déconnexion' }).click();
};

test.describe('En-tête : état de la synchronisation (démo)', () => {
  test('touché, il ouvre le détail : dernière écriture, modifications en attente', async ({ page, isMobile }) => {
    await openDemo(page);
    // Plus de déconnexion dans l'en-tête du téléphone.
    if (isMobile) await expect(page.getByRole('banner').getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0);
    await addDeposit(page);
    const zone = isMobile ? page.getByRole('banner') : page.locator('aside');
    await zone.getByRole('button', { name: /^Synchronisation : / }).click();
    const sheet = page.getByRole('dialog', { name: 'Synchronisation avec Drive' });
    await expect(sheet.getByText('Dernière écriture sur votre Drive')).toBeVisible();
    await expect(sheet.getByText('Modifications en attente')).toBeVisible();
    await sheet.getByRole('button', { name: 'Fermer' }).click();
    await expect(sheet).toBeHidden();
  });
});

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
    // Toujours connecté, sur l'écran d'où la déconnexion a été demandée.
    const screenTitle = isMobile ? 'Paramètres' : 'Accueil';
    await expect(page.getByRole('heading', { name: screenTitle, level: 2 })).toBeAttached();

    await dialog.getByRole('button', { name: 'Se déconnecter sans envoyer' }).click();
    await expect(page.getByRole('heading', { name: 'Pécule', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: screenTitle, level: 2 })).toHaveCount(0);
  });
});
