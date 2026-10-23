// Pilotage : un autre salaire (second employeur) se règle dans le détail du
// salaire, compte dans la paie nette après impôt et reste enregistré après un changement d'écran.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page) => {
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

const goTo = async (page: Page, label: string, isMobile: boolean) => {
  const nav = isMobile ? page.getByRole('navigation', { name: 'Navigation principale' }) : page.locator('aside');
  await nav.getByRole('button', { name: label, exact: true }).click();
  await expect(page).toHaveTitle(new RegExp(`^${label}`));
};

/** « 1 273,34 € » → 1273.34 */
const euros = (text: string | null) => Number((text || '').replace(/[^\d,-]/g, '').replace(',', '.'));

const openSalaryDetail = async (page: Page) => {
  await page.getByRole('button', { name: /^Revenus et salaire/ }).click();
  await page.getByRole('button', { name: 'Voir le détail du salaire' }).click();
  return page.getByRole('region', { name: /^Revenus et salaire/ });
};

test('un autre salaire se règle dans le Pilotage et compte dans la paie nette après impôt', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await openDemo(page);
  await goTo(page, 'Pilotage', isMobile);
  const income = await openSalaryDetail(page);
  const restToLive = async () => euros(await income.getByText('Paie nette après impôt', { exact: true }).locator('xpath=following-sibling::p[1]').textContent());
  const before = await restToLive();
  expect(before).toBeGreaterThan(0);

  await income.getByLabel('Autre salaire (net par mois)').fill('200');
  // Paie nette après impôt en hausse d'un peu moins que 200 € : ce salaire est aussi imposé.
  await expect.poll(restToLive).toBeGreaterThan(before);
  expect(await restToLive()).toBeLessThanOrEqual(before + 200);
  await expect(income.getByText('Autre salaire', { exact: true })).toBeVisible();

  // Enregistré dans les données : toujours là après un aller-retour vers l'Accueil.
  await goTo(page, 'Accueil', isMobile);
  await goTo(page, 'Pilotage', isMobile);
  const again = await openSalaryDetail(page);
  await expect(again.getByLabel('Autre salaire (net par mois)')).toHaveValue('200');
  expect(errors).toEqual([]);
});
