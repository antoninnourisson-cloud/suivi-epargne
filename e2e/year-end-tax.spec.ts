// « Avant le 31 décembre » en mode démo : au 1er décembre 2026, une tâche de l'Accueil chiffre ce
// que rapportent les dons de l'année (la démo a un don de 120 € et pas de PER) ; au 2 janvier 2027
// elle n'est plus là. L'horloge est figée (page.clock) comme dans les autres parcours datés.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page, now: string) => {
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

/** Liste « À faire » dépliée en entier. */
const openTodos = async (page: Page) => {
  const header = page.getByRole('button', { name: /^À faire/ });
  if (await header.count() === 0) return;
  if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
  const more = page.getByRole('button', { name: /^Voir tout \(/ });
  if (await more.count()) await more.click();
};

test.describe('Avant le 31 décembre (démo)', () => {
  test('au 1er décembre : la tâche chiffre les dons, mène à l\'écran des dons', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openDemo(page, '2026-12-01T10:00:00');
    await openTodos(page);

    const todo = page.locator('#todo-list li').filter({ hasText: /^Avant le 31 décembre/ });
    await expect(todo).toBeVisible();
    // Montants chiffrés (la démo n'a pas de PER : seule la phrase des dons).
    await expect(todo).toContainText(/Vos dons de 2026 vous donnent déjà \d[\d\s]*(,\d+)?\s€ de réduction/);
    await expect(todo).toContainText(/100\s€ de plus en donneraient 66\s€/);
    await expect(todo.getByRole('button', { name: 'Plus tard' })).toBeVisible();

    await todo.getByRole('button', { name: 'Voir mes dons' }).click();
    await expect(page).toHaveTitle(/Dons et déclaration/);

    expect(errors).toEqual([]);
  });

  test('au 2 janvier 2027 : plus de tâche « Avant le 31 décembre »', async ({ page }) => {
    await openDemo(page, '2027-01-02T10:00:00');
    await openTodos(page);
    await expect(page.locator('#todo-list li').filter({ hasText: /^Avant le 31 décembre/ })).toHaveCount(0);
    await expect(page.getByText('Avant le 31 décembre')).toHaveCount(0);
  });

  test('avant le 15 novembre : pas encore de tâche', async ({ page }) => {
    await openDemo(page, '2026-11-14T10:00:00');
    await openTodos(page);
    await expect(page.getByText('Avant le 31 décembre')).toHaveCount(0);
  });
});
