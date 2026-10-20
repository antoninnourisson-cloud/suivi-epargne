// Simulateur « Et si… » en mode démo (?demo=1) : un achat de 3 000 € change le résultat
// et le tableau de données montre l'écart avec le plan actuel.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

/** Ouvre un écran : barre latérale sur ordinateur, menu « Plus » sur mobile. */
const goTo = async (page: Page, label: string, isMobile: boolean) => {
  if (!isMobile) {
    await page.locator('aside').getByRole('button', { name: label, exact: true }).click();
    return;
  }
  const bar = page.getByRole('navigation', { name: 'Navigation principale' });
  await bar.getByRole('button', { name: 'Plus', exact: true }).click();
  await page.getByRole('dialog', { name: "Plus d'écrans" }).getByRole('button', { name: label, exact: true }).click();
};

test.describe('Simulateur « Et si… » (démo)', () => {
  test('un achat de 3 000 € fait baisser le résultat et apparaît dans les données', async ({ page, isMobile }) => {
    await openDemo(page);
    await goTo(page, 'Et si…', isMobile);
    await expect(page.getByRole('heading', { name: 'Et si…', level: 2 })).toBeVisible();

    const result = page.getByText(/^Dans 24 mois$/).locator('..');
    await expect(result).toBeVisible();
    const before = await result.innerText();

    await page.getByRole('button', { name: 'Achat', exact: true }).click();
    const amount = page.getByLabel("Montant de l'achat");
    await amount.fill('3000');
    await amount.blur();

    await expect(result).not.toHaveText(before);
    await expect(page.getByText('Écart avec votre plan actuel')).toContainText('−3');
    await expect(page.getByText(/Achat de 3\s000\s€ dans 6 mois : pris sur/)).toBeVisible();

    await page.getByRole('button', { name: 'Voir les données' }).click();
    const table = page.getByRole('table', { name: /Votre épargne sur 24 mois/ });
    await expect(table.getByRole('columnheader', { name: 'Écart' })).toBeVisible();
    // Avant l'achat, pas d'écart ; à partir du 6e mois, au moins 3 000 € de moins.
    const rows = table.locator('tbody tr');
    await expect(rows.first().locator('td').nth(2)).toHaveText(/^0\s€$/);
    await expect(rows.last().locator('td').nth(2)).toHaveText(/^−3\s0\d\d\s€$/);
  });

  test('la fourchette se calcule hors de l\'écran (Web Worker) et suit l\'horizon choisi', async ({ page, isMobile }) => {
    // Un Worker bloqué par la CSP ou introuvable se verrait ici (l'écran retomberait sur le calcul sur place).
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const workers: string[] = [];
    page.on('worker', w => workers.push(w.url()));

    await openDemo(page);
    await goTo(page, 'Et si…', isMobile);
    const note = page.getByText(/Fourchette tirée de vos propres mois passés/);
    await expect(note).toBeVisible();
    // Ce que la fourchette représente : le rythme d'épargne, pas les marchés.
    await expect(note).toContainText('pas les variations des marchés');
    await expect(page.getByText(/s'ajoutent au solde chaque 31 décembre/)).toBeVisible();
    // Hors janvier, l'horizon finit en cours d'année : les intérêts des livrets déjà gagnés,
    // pas encore versés, sont signalés à part.
    if (new Date().getMonth() !== 0) await expect(page.getByText(/d'intérêts déjà gagnés sur ces livrets attendront/)).toBeVisible();
    expect(workers.some(u => /simulator\.worker/.test(u))).toBe(true);

    await page.getByRole('group', { name: 'Horizon' }).getByRole('button', { name: '60 mois' }).click();
    await expect(page.getByText('Calcul de la fourchette…')).toBeHidden();
    await page.getByRole('button', { name: 'Voir les données' }).click();
    const table = page.getByRole('table', { name: /Votre épargne sur 60 mois/ });
    await expect(table.getByRole('columnheader', { name: 'Fourchette basse' })).toBeVisible();
    await expect(table.locator('tbody tr').last().locator('td').nth(2)).toHaveText(/\d\s€$/);
    expect(errors.filter(e => /Content Security Policy|worker/i.test(e))).toEqual([]);
  });
});
