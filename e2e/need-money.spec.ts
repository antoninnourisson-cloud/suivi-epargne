// « J'ai besoin d'argent : où le prendre ? » en mode démo (?demo=1), format téléphone seulement :
// ouvert depuis le bouton « Mouvement » (un lien, pas un quatrième choix) ; besoin immédiat
// enregistré en une fois puis annulé d'un seul « Annuler » ; besoin futur qui devient, le jour
// conseillé (le 16), une tâche de l'Accueil, enregistrée d'un geste.
// Démo : Livret A 8 200 € à vous (7 000 € aux parents), LDDS 3 000 €, LEP 7 500 €, compte courant.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';
import { goTo } from './nav';

// Date figée : le meilleur jour d'un livret dépend des quinzaines (1er et 16 du mois).
const NOW = new Date('2026-11-04T12:00:00');

const openDemo = async (page: Page) => {
  await page.clock.setFixedTime(NOW);
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.locator('main h2').first()).toBeVisible();
};

/** Bouton « Mouvement » › lien du retrait guidé. */
const openNeed = async (page: Page) => {
  await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
  const quick = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
  await expect(quick.getByRole('group', { name: 'Type de mouvement' }).getByRole('button')).toHaveText(['Dépôt', 'Retrait', 'Virement', 'Envie']);
  await quick.getByRole('button', { name: "J'ai besoin d'argent : où le prendre ?" }).click();
  await expect(quick).toBeHidden();
  const sheet = page.getByRole('dialog', { name: "J'ai besoin d'argent" });
  await expect(sheet).toBeVisible();
  return sheet;
};

const shot = async (page: Page, name: string) => {
  const dir = process.env.PECULE_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
};

test.describe('J’ai besoin d’argent (démo, téléphone)', () => {
  test.beforeEach(({ isMobile }) => { test.skip(!isMobile, 'format téléphone seulement'); });

  test('besoin immédiat : le livret le moins cher, son coût, enregistré puis annulé d’un seul geste', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openDemo(page);
    let sheet = await openNeed(page);
    await sheet.getByLabel("Montant dont j'ai besoin").fill('800');
    await sheet.getByRole('button', { name: 'Voir où le prendre' }).click();
    await expect(sheet.getByRole('heading', { name: /^Où prendre 800\s€$/ })).toBeVisible();
    const lines = sheet.getByRole('list', { name: 'Retraits proposés' }).getByRole('listitem');
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toContainText(/Prendre 800\s€ sur le Livret A/);
    await expect(lines.first()).toContainText(/Coût : environ \d+\s€ d'intérêts perdus d'ici la fin de l'année\./);
    await expect(sheet.getByText('Chaque montant sera viré sur Compte courant.')).toBeVisible();
    await shot(page, 'r2-proposition');

    // Gros besoin : les placements ensuite, avec l'impôt, et la phrase de précaution.
    await sheet.getByRole('button', { name: 'Retour' }).click();
    await sheet.getByLabel("Montant dont j'ai besoin").fill('20000');
    await sheet.getByRole('button', { name: 'Voir où le prendre' }).click();
    await expect(lines.last()).toContainText(/sur l'Assurance vie/);
    await expect(lines.last()).toContainText(/d'impôt et de prélèvements sociaux/);
    await expect(sheet.getByText(/^Votre épargne de précaution passera à .*, sous son objectif de/)).toBeVisible();
    await shot(page, 'r2-precaution');
    await sheet.getByRole('button', { name: 'Fermer' }).click();

    sheet = await openNeed(page);
    await sheet.getByLabel("Montant dont j'ai besoin").fill('800');
    await sheet.getByRole('button', { name: 'Voir où le prendre' }).click();
    await sheet.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(sheet).toBeHidden();
    const status = page.getByRole('status').filter({ hasText: /Retrait de 800\s€ sur le Livret A, viré sur Compte courant/ });
    await expect(status).toBeVisible();

    // Un seul « Annuler » : le Livret A revient à 15 200 €, le compte courant à son solde.
    await status.getByRole('button', { name: 'Annuler' }).click();
    await goTo(page, 'Mes comptes', true);
    const row = page.locator('tbody > tr').filter({ has: page.getByRole('button', { name: 'Livret A : voir les mouvements', exact: true }) });
    await expect(row).toContainText(/15\s200/);
    expect(errors).toEqual([]);
  });

  test('besoin futur : retrait prévu au meilleur jour, puis tâche de l’Accueil enregistrée', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openDemo(page);
    const sheet = await openNeed(page);
    await sheet.getByLabel("Montant dont j'ai besoin").fill('2400');
    await sheet.getByLabel('Pour le').fill('2026-11-20');
    await sheet.getByRole('button', { name: 'Voir où le prendre' }).click();
    await expect(sheet.getByText(/^Le meilleur jour : le 16 novembre\./)).toBeVisible();
    await sheet.getByRole('button', { name: 'Prévoir le retrait' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: /Retrait prévu le 16 novembre/ })).toBeVisible();
    // Pas encore le jour : pas de tâche.
    await expect(page.getByText(/^Retrait prévu : prendre/)).toHaveCount(0);

    // Le 16 novembre : l'app reprise au premier plan relit la date du jour.
    await page.clock.setFixedTime(new Date('2026-11-16T09:00:00'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const task = page.locator('li').filter({ hasText: /^Retrait prévu : prendre 2\s400\s€ sur le Livret A, pour le 20 novembre\./ });
    await expect(task).toBeVisible();
    await expect(task).toContainText('garde les intérêts de la quinzaine');
    await task.scrollIntoViewIfNeeded();
    await shot(page, 'r2-tache-accueil');
    await task.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status').filter({ hasText: /Retrait de 2\s400\s€ sur le Livret A, viré sur Compte courant/ })).toBeVisible();
    await expect(task).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
