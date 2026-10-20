// Pilotage : « Capacité d'épargne du mois » et « Somme en plus à placer » sont gardées pour
// la paie en cours (changement d'écran) et l'Accueil affiche le même objectif que le Pilotage.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page) => {
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

const goTo = async (page: Page, label: string, isMobile: boolean) => {
  if (!isMobile) {
    await page.locator('aside').getByRole('button', { name: label, exact: true }).click();
  } else {
    const bar = page.getByRole('navigation', { name: 'Navigation principale' });
    const tab = bar.getByRole('button', { name: label, exact: true });
    if (await tab.count()) await tab.click();
    else {
      await bar.getByRole('button', { name: 'Plus', exact: true }).click();
      await page.getByRole('dialog', { name: "Plus d'écrans" }).getByRole('button', { name: label, exact: true }).click();
    }
  }
  await expect(page).toHaveTitle(new RegExp(`^${label}`));
};

/** « 1 273,34 € » → 1273.34 */
const euros = (text: string) => Number(text.replace(/[^\d,-]/g, '').replace(',', '.'));
/** Montant arrondi à l'euro tel que l'Accueil l'affiche, en expression régulière (« 1 273 € »). */
const roundedEuros = (n: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n)).replace(/\s/g, '\\s') + '\\s€';

const heroAmount = async (page: Page) => {
  const text = (await page.getByRole('region', { name: 'À placer ce mois' }).textContent()) || '';
  const m = text.match(/À placer ce mois\s*(-?[\d\s.,]+)\s*€/);
  if (!m) throw new Error(`montant introuvable : ${text}`);
  return euros(m[1]);
};

const openBudgets = async (page: Page) => {
  const toggle = page.getByRole('button', { name: /^Budgets et montant du mois/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
};

test('la somme en plus et la capacité du mois sont gardées, et l’Accueil suit', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await openDemo(page);
  await goTo(page, 'Pilotage', isMobile);
  const base = await heroAmount(page);

  // Prime de 500 € pour cette paie.
  await openBudgets(page);
  const extra = page.getByLabel('Somme en plus à placer ce mois-ci');
  await extra.fill('500');
  await extra.blur();
  await expect.poll(() => heroAmount(page)).toBeCloseTo(base + 500, 2);
  await expect(page.getByText("Prime, cadeau, remboursement… ajouté au plan de placement. Gardé jusqu'à la prochaine paie.")).toBeVisible();

  // L'Accueil affiche le même objectif.
  await goTo(page, 'Accueil', isMobile);
  await expect(page.getByText(new RegExp(`/\\s*${roundedEuros(base + 500)}`)).first()).toBeVisible();

  // Retour au Pilotage : la prime est toujours là.
  await goTo(page, 'Pilotage', isMobile);
  await expect.poll(() => heroAmount(page)).toBeCloseTo(base + 500, 2);
  await openBudgets(page);
  await expect(page.getByLabel('Somme en plus à placer ce mois-ci')).toHaveValue('500');

  // Capacité du mois saisie à la main : gardée aussi, puis retour au calcul.
  const capacity = page.getByLabel("Capacité d'épargne du mois");
  await capacity.fill('1000');
  await expect.poll(() => heroAmount(page)).toBeCloseTo(1500, 2);
  await goTo(page, 'Accueil', isMobile);
  await expect(page.getByText(new RegExp(`/\\s*${roundedEuros(1500)}`)).first()).toBeVisible();
  await goTo(page, 'Pilotage', isMobile);
  await openBudgets(page);
  await expect(page.getByLabel("Capacité d'épargne du mois")).toHaveValue('1000');
  await page.getByRole('button', { name: 'Revenir au calcul' }).click();
  await expect.poll(() => heroAmount(page)).toBeCloseTo(base + 500, 2);

  // Prime remise à zéro : on retrouve le montant de départ.
  await page.getByLabel('Somme en plus à placer ce mois-ci').fill('0');
  await page.getByLabel('Somme en plus à placer ce mois-ci').blur();
  await expect.poll(() => heroAmount(page)).toBeCloseTo(base, 2);

  expect(errors).toEqual([]);
});
