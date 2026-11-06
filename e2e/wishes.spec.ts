// Pilotage › Envies en mode démo (?demo=1) : l'onglet, les totaux par catégorie et le total
// général, l'ajout d'une envie, « Je l'achète » qui ouvre « J'ai besoin d'argent » prérempli,
// puis l'envie qui passe dans « Achetées » quand le retrait est enregistré.
// Démo : Valise cabine (Loisirs) est notée sans prix. Maison (Aspirateur robot 349 €, Lampe de bureau 89 €), Livres (Atlas du monde 45 €, prix
// de plus de 3 mois), Gros projets (Vélo électrique 1 490 €) ; Casque audio déjà acheté.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';
import { goTo } from './nav';

const openDemo = async (page: Page) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.locator('main h2').first()).toBeVisible();
};

/** Texte sans espaces (formatEUR met des espaces insécables) : « 1973€ ». */
const flat = async (loc: ReturnType<Page['locator']>) => ((await loc.textContent()) ?? '').replace(/\s/g, '');

test('Envies : totaux, ajout, « Je l’achète » prérempli puis envie achetée', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await openDemo(page);
  await goTo(page, 'Envies', isMobile);

  // Onglet et totaux.
  await expect(page.locator('main').getByRole('tab', { name: 'Envies', exact: true })).toHaveAttribute('aria-selected', 'true');
  const summary = page.getByRole('region', { name: "Vos envies et l'argent disponible" });
  await expect(summary).toBeVisible();
  expect(await flat(summary)).toContain('Vosenvies:1973€');
  await expect(summary).toContainText(/Disponible sans toucher à votre épargne de précaution\s?:/);
  expect(await flat(page.getByRole('region', { name: 'Maison' }))).toContain('438€');
  expect(await flat(page.getByRole('region', { name: 'Livres' }))).toContain('45€');
  expect(await flat(page.getByRole('region', { name: 'Gros projets' }))).toContain('1490€');
  await expect(page.getByText(/^prix du .+ : à revérifier$/)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Achetées (1)' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('list', { name: 'Envies achetées' })).toHaveCount(0);
  // Lien : nouvel onglet, rel sécurisé.
  const link = page.getByRole('link', { name: /Voir sur example\.org/ });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  // Ajout d'une envie.
  await page.getByRole('button', { name: 'Ajouter une envie' }).click();
  const sheet = page.getByRole('dialog', { name: 'Nouvelle envie' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Nom').fill('Enceinte portable');
  await sheet.getByLabel('Prix', { exact: true }).fill('120');
  await sheet.getByLabel('Catégorie').selectOption('Tech');
  await sheet.getByRole('button', { name: "Ajouter l'envie" }).click();
  await expect(sheet).toBeHidden();
  const tech = page.getByRole('region', { name: 'Tech' });
  await expect(tech).toContainText('Enceinte portable');
  expect(await flat(tech)).toContain('120€');
  expect(await flat(summary)).toContain('Vosenvies:2093€');

  // « Je l'achète » : « J'ai besoin d'argent » prérempli avec le prix et le nom.
  await page.getByRole('button', { name: "Je l'achète : Lampe de bureau" }).click();
  const need = page.getByRole('dialog', { name: "J'ai besoin d'argent" });
  await expect(need).toBeVisible();
  await expect(need.getByLabel("Montant dont j'ai besoin")).toHaveValue('89');
  await expect(need).toContainText('Pour votre envie : Lampe de bureau.');
  // Abandon : l'envie reste à acheter.
  await need.getByRole('button', { name: 'Annuler' }).click();
  await expect(need).toBeHidden();
  await expect(page.getByRole('button', { name: "Je l'achète : Lampe de bureau" })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Achetées/ })).toHaveText(/Achetées \(1\)/);

  // Retrait enregistré : l'envie passe dans « Achetées ».
  await page.getByRole('button', { name: "Je l'achète : Lampe de bureau" }).click();
  await need.getByRole('button', { name: 'Voir où le prendre' }).click();
  await expect(need.getByRole('heading', { name: /^Où prendre 89\s€$/ })).toBeVisible();
  await need.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(need).toBeHidden();
  await expect(page.getByRole('button', { name: "Je l'achète : Lampe de bureau" })).toHaveCount(0);
  const toggle = page.getByRole('button', { name: 'Achetées (2)' });
  await toggle.click();
  const bought = page.getByRole('list', { name: 'Envies achetées' });
  await expect(bought).toContainText('Lampe de bureau');
  await expect(bought).toContainText('Casque audio');
  await expect(bought.getByRole('button', { name: 'Remettre en envie : Lampe de bureau' })).toBeVisible();
  expect(await flat(summary)).toContain('Vosenvies:2004€');

  expect(errors).toEqual([]);
});

/** Les tâches de l'Accueil, dépliées si besoin. */
const todoList = async (page: Page) => {
  const list = page.locator('#todo-list');
  await expect(list).toBeVisible();
  const more = list.getByRole('button', { name: /^Voir tout/ });
  if (await more.count()) await more.click();
  return list;
};

test('Envie à la volée : ajout sans prix par le raccourci, tâche de l’Accueil, prix complété, tâche disparue', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1&action=quickadd');
  const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Envie', exact: true }).click();
  await expect(dialog.getByLabel('Nom')).toBeFocused();
  await dialog.getByLabel('Nom').fill('Sac à dos');
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Envie ajoutée' })).toBeVisible();

  // Accueil : la démo avait déjà une envie sans prix (Valise cabine), celle-ci fait deux.
  const todo = (await todoList(page)).getByRole('listitem').filter({ hasText: 'Envies à compléter' });
  await expect(todo).toContainText('2 envies sans prix');
  await todo.getByRole('button', { name: 'Compléter' }).click();
  await expect(page.locator('main').getByRole('tab', { name: 'Envies', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('listitem').filter({ hasText: 'Sac à dos' })).toContainText('Prix à compléter');
  await expect(page.getByRole('button', { name: "Je l'achète : Sac à dos" })).toHaveCount(0);

  for (const name of ['Sac à dos', 'Valise cabine']) {
    await page.getByRole('button', { name: `Modifier ${name}` }).click();
    const sheet = page.getByRole('dialog', { name: "Modifier l'envie" });
    await sheet.getByLabel('Prix', { exact: true }).fill('60');
    await sheet.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(sheet).toBeHidden();
  }
  await expect(page.getByText('Prix à compléter')).toHaveCount(0);

  await goTo(page, 'Accueil', isMobile);
  await expect(page.locator('#todo-list')).toBeVisible();
  await expect(page.locator('#todo-list').getByText('Envies à compléter')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Lien direct ?action=wish : la feuille s’ouvre sur Envie, le clavier va sur le nom', async ({ page }) => {
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1&action=wish');
  const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Envie', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('Nom')).toBeFocused();
  await expect(dialog.getByLabel('Montant')).toHaveCount(0);
});
