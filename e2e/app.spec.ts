// Parcours principaux en mode démo (?demo=1) : chaque écran s'affiche, l'ajout rapide
// fonctionne, la part des parents ne peut pas être retirée, le clavier suffit.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';
import { goTo } from './nav';

const SCREENS = [
  'Accueil', 'Actualiser les soldes', 'Mes comptes', 'Virements', 'Journal', 'Pilotage', 'Abonnements',
  'Fiches de paie', 'Dons et impôts', 'Calendrier fiscal', 'Rendement', 'Historique', 'Et si…', 'Agenda', 'Part parentale', 'Paramètres',
];

const openDemo = async (page: Page) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

/** Montant « Ma part » d'un compte dans « Mes comptes ». */
const ownShareCell = (page: Page, name: string) =>
  page.locator('tbody > tr').filter({ has: page.getByRole('button', { name: `${name} : voir les mouvements`, exact: true }) })
    .locator('td').nth(1).locator('div').first();

test.describe('Pécule en mode démo', () => {
  test('chaque écran s\'affiche sans erreur', async ({ page, isMobile }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openDemo(page);
    for (const label of SCREENS) {
      // goTo vérifie le titre de l'onglet du navigateur (« Comptes · Mouvements · Pécule »).
      await goTo(page, label, isMobile);
      await expect(page.getByText("Cet écran n'a pas pu s'afficher")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test('ajout rapide d\'un dépôt : solde au centime, ligne au Journal, « Annuler » rend le solde d\'avant', async ({ page, isMobile }) => {
    await openDemo(page);
    // Démo : LDDS à 3 000 €, entièrement à vous.
    await goTo(page, 'Mes comptes', isMobile);
    // Premier affichage de l'écran : le serveur de développement le compile d'abord.
    await expect(page.getByRole('heading', { name: 'Mes comptes', level: 3, exact: true })).toBeVisible({ timeout: 20_000 });
    const ldds = ownShareCell(page, 'LDDS');
    await expect(ldds).toHaveText(/^3\s000\s€$/);

    await goTo(page, 'Journal', isMobile);
    await expect(page.getByRole('heading', { name: 'Journal', level: 3, exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await dialog.getByLabel('Compte').selectOption({ label: 'LDDS' });
    await dialog.getByLabel('Montant').fill('123,45');
    await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(dialog).toBeHidden();
    const toast = page.getByRole('status').filter({ hasText: /^Dépôt : \+123,45\s€ sur LDDS/ });
    await expect(toast).toBeVisible();
    // Une seule ligne, du bon montant, sur le bon compte.
    const line = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Supprimer « Dépôt »' }) });
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('LDDS');
    await expect(line).toContainText(/\+123,45\s€/);

    await goTo(page, 'Mes comptes', isMobile);
    await expect(ldds).toHaveText(/^3\s123,45\s€$/);
    await toast.getByRole('button', { name: 'Annuler' }).click();
    await expect(ldds).toHaveText(/^3\s000\s€$/);
    await goTo(page, 'Journal', isMobile);
    await expect(page.getByRole('heading', { name: 'Journal', level: 3, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Supprimer « Dépôt »' })).toHaveCount(0);
  });

  test('un retrait ne peut pas entamer la part des parents', async ({ page }) => {
    await openDemo(page);
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await dialog.getByLabel('Compte').selectOption({ label: 'Livret A' });
    await dialog.getByRole('button', { name: 'Retrait' }).click();
    // Part propre de la démo : 8 200 € sur 15 200 €.
    await dialog.getByLabel('Montant').fill('9000');
    await expect(dialog.getByRole('alert')).toContainText('la part de vos parents ne peut pas être retirée');
    await expect(dialog.getByRole('button', { name: 'Ajouter', exact: true })).toBeDisabled();
  });

  test('clavier : lien d\'évitement et focus sur le titre de l\'écran', { tag: '@ordinateur' }, async ({ page, isMobile }) => {
    test.skip(isMobile, 'navigation au clavier testée sur ordinateur');
    await openDemo(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#contenu')).toBeFocused();
    await page.locator('aside').getByRole('button', { name: 'Pilotage', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pilotage', level: 2 })).toBeFocused();
    // Onglets de l'écran : flèches au clavier ; le focus reste sur l'onglet, le titre de
    // l'onglet du navigateur suit.
    const tabs = page.getByRole('tablist', { name: 'Pilotage' });
    await tabs.getByRole('tab', { name: 'Ce mois', selected: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Abonnements', selected: true })).toBeFocused();
    await expect(page).toHaveTitle('Pilotage · Abonnements · Pécule');
    await expect(page.getByRole('tabpanel', { name: 'Abonnements' })).toBeVisible();
  });

  test('onglet mémorisé : rouvert par le menu, jamais par un lien (« J’ai reçu ma paie »)', async ({ page, isMobile }) => {
    await openDemo(page);
    await goTo(page, 'Abonnements', isMobile);
    await goTo(page, 'Accueil', isMobile);
    // Le menu rouvre Pilotage sur son dernier onglet.
    if (isMobile) await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Pilotage', exact: true }).click();
    else await page.locator('aside').getByRole('button', { name: 'Pilotage', exact: true }).click();
    await expect(page).toHaveTitle('Pilotage · Abonnements · Pécule');
    // Le raccourci « J'ai reçu ma paie » ouvre toujours Ce mois, et la feuille de paie.
    await page.goto('/?demo=1&action=pay');
    await expect(page.getByRole('dialog', { name: "J'ai reçu ma paie" })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveTitle('Pilotage · Ce mois · Pécule');
  });
});
