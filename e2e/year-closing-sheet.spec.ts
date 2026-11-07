// Rituel « Clôture de l'année » en mode démo (?demo=1), format téléphone seulement, horloge au
// 10 janvier 2027 : la tâche de l'Accueil ouvre la feuille ; un intérêt crédité différent du
// calcul affiche l'écart ; « Enregistrer » puis « Annuler » remet l'état d'avant ; l'objectif
// 2027 s'affiche dans la carte de l'objectif du mois.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const NOW = new Date('2027-01-10T10:00:00');

const openDemo = async (page: Page) => {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

const shot = async (page: Page, name: string) => {
  const dir = process.env.PECULE_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
};

/** Ouvre la feuille depuis la tâche « Clôture de l'année 2026 » de l'Accueil. */
const openSheet = async (page: Page) => {
  const header = page.getByRole('button', { name: /^À faire/ });
  if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
  const more = page.getByRole('button', { name: /^Voir tout \(/ });
  if (await more.count()) await more.click();
  const todo = page.locator('#todo-list li').filter({ hasText: /^Clôture de l'année 2026/ });
  await todo.getByRole('button', { name: 'Ouvrir la clôture' }).click();
  const sheet = page.getByRole('dialog', { name: "Clôture de l'année 2026" });
  await expect(sheet).toBeVisible();
  return sheet;
};

const euros = (text: string) => Number(text.replace(/\s/g, '').replace(',', '.'));
const field = (n: number) => n.toFixed(2).replace('.', ',');
/** Remplace le montant d'un champ (le champ passe du format « 2 539 » à la saisie brute au focus : fill() perdrait la sélection). */
const setAmount = async (input: ReturnType<Page['locator']>, text: string) => {
  await input.click();
  await input.press('Control+A');
  await input.pressSequentially(text);
};

test.describe("Clôture de l'année : la feuille (démo, téléphone)", () => {
  test.beforeEach(({ isMobile }) => { test.skip(!isMobile, 'format téléphone seulement'); });

  test('écart des intérêts, un seul « Annuler », objectif 2027 sur l’Accueil', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openDemo(page);
    const goalLine = page.locator('[data-year-goal]');
    await expect(goalLine).toHaveCount(0);

    // 1. La tâche de l'Accueil ouvre la feuille, plein écran.
    let sheet = await openSheet(page);
    const box = await sheet.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(400);
    await expect(page).toHaveTitle(/Accueil/);

    // 2. Intérêt crédité différent du calcul : l'écart s'affiche.
    const interest = sheet.locator('[data-step="interest"]');
    const credited = interest.getByLabel(/^Crédité par la banque, /).first();
    const computed = euros(await credited.inputValue());
    expect(computed).toBeGreaterThan(5);
    await setAmount(credited, field(computed - 2.3));
    await expect(interest).toContainText(/2,30\s€ de moins que prévu\./);
    await expect(interest).not.toContainText('Causes possibles');
    await setAmount(credited, field(computed - 8));
    await expect(interest).toContainText(/8,00\s€ de moins que prévu\. Causes possibles : un retrait en milieu de quinzaine/);
    await interest.scrollIntoViewIfNeeded();
    await shot(page, 'r4-feuille-interets');

    // Restitution : capital des parents compte par compte, intérêts qui vous restent ; objectif.
    const restitution = sheet.locator('[data-step="restitution"]');
    await expect(restitution).toContainText(/Total à rendre : 9\s500\s€/);
    await expect(restitution).toContainText(/Les intérêts 2026 vous restent, y compris les \d+\s€ produits par le capital de vos parents\./);
    await expect(restitution.getByRole('button', { name: 'Préparer la restitution' })).toBeVisible();
    const goal = sheet.getByLabel('Objectif 2027');
    await setAmount(goal, '9000');
    await restitution.scrollIntoViewIfNeeded();
    await shot(page, 'r4-restitution-objectif');

    // 3. « Enregistrer », puis « Annuler » remet l'état d'avant.
    await sheet.getByRole('button', { name: 'Enregistrer mes saisies' }).click();
    // La feuille reste ouverte ; le message dit ce qui a été enregistré.
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(/ntérêts? de \d+ comptes?/);
    await sheet.getByRole('button', { name: 'Fermer' }).click();
    await expect(sheet).toBeHidden();
    await expect(goalLine).toContainText(/Objectif 2027 : .* sur 9\s000\s€/);
    const status = page.getByRole('status').filter({ hasText: /enregistrés?/ });
    await status.getByRole('button', { name: 'Annuler' }).click();
    await expect(goalLine).toHaveCount(0);
    sheet = await openSheet(page);
    const creditedAgain = sheet.locator('[data-step="interest"]').getByLabel(/^Crédité par la banque, /).first();
    await expect.poll(async () => euros(await creditedAgain.inputValue())).toBeCloseTo(computed, 2);
    await expect(sheet.getByLabel('Objectif 2027')).not.toHaveValue(/^9\s?000$/);

    // 4. L'objectif 2027 apparaît à l'Accueil, dans la carte de l'objectif du mois.
    await setAmount(sheet.getByLabel('Objectif 2027'), '9000');
    await sheet.getByRole('button', { name: 'Enregistrer mes saisies' }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Fermer' }).click();
    await expect(sheet).toBeHidden();
    await expect(goalLine).toContainText(/^Objectif 2027 : .* sur 9\s000\s€$/);
    await goalLine.scrollIntoViewIfNeeded();
    await shot(page, 'r4-accueil-objectif');
    expect(errors).toEqual([]);
  });
});
