// Clôture de l'année en mode démo (?demo=1), horloge figée en janvier 2027 : une seule tâche
// sur l'Accueil mène à la liste de l'Historique ; on la parcourt (taux servi, déclaration,
// paramètres fiscaux, archive JSON + CSV, « Votre année »), on clôture, et la tâche disparaît. Puis le passage en
// solo : une fois la restitution enregistrée, les textes ne parlent plus des parents, sans
// aucune modification du code (données seulement).
import { test, expect, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';
import { LATEST_VERSION } from '../src/changelog';

// 10 janvier 2027 : saison de la clôture de 2026 (les données de démo sont datées à partir
// de cette date).
const FIXED_NOW = new Date('2027-01-10T10:00:00');

const openDemo = async (page: Page) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

/** Ouvre un écran : barre latérale sur ordinateur, barre du bas ou menu « Plus » sur mobile. */
const goTo = async (page: Page, label: string, isMobile: boolean) => {
  if (!isMobile) {
    await page.locator('aside').getByRole('button', { name: label, exact: true }).click();
  } else {
    const short: Record<string, string> = { 'Mes comptes': 'Comptes' };
    const bar = page.getByRole('navigation', { name: 'Navigation principale' });
    const tab = bar.getByRole('button', { name: short[label] ?? label, exact: true });
    if (await tab.count()) await tab.click();
    else {
      await bar.getByRole('button', { name: 'Plus', exact: true }).click();
      await page.getByRole('dialog', { name: "Plus d'écrans" }).getByRole('button', { name: label, exact: true }).click();
    }
  }
  await expect(page).toHaveTitle(new RegExp(`^${label}`));
};

/** La tâche « Clôture de l'année 2026 » de l'Accueil (liste dépliée au besoin). */
const closingTodo = async (page: Page) => {
  const header = page.getByRole('button', { name: /^À faire/ });
  if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
  const more = page.getByRole('button', { name: /^Voir tout \(/ });
  if (await more.count()) await more.click();
  return page.locator('#todo-list li').filter({ hasText: /^Clôture de l'année 2026/ });
};

const step = (page: Page, id: string) => page.locator(`[data-step="${id}"]`);

test.describe("Clôture de l'année (démo, janvier)", () => {
  test('une tâche sur l\'Accueil, la liste dans l\'ordre, puis la clôture', async ({ page, isMobile }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openDemo(page);

    // --- Accueil : une seule tâche de clôture, rien sur le taux servi à part ---
    const todo = await closingTodo(page);
    await expect(todo).toHaveCount(1);
    await expect(todo).toContainText(/^Clôture de l'année 2026 : 0 étape sur 8 faite\./);
    // Taux servi, paramètres fiscaux et copie de sauvegarde : des étapes, pas des tâches à part.
    await expect(page.locator('#todo-list')).not.toContainText('Taux servi 2026');
    await expect(page.locator('#todo-list')).not.toContainText('vérifiez vos paramètres fiscaux');
    await todo.getByRole('button', { name: 'Ouvrir la clôture' }).click();

    // --- Historique : la clôture en tête, ouverte ---
    await expect(page).toHaveTitle(/^Historique/);
    const card = page.getByRole('region', { name: "Clôture de l'année 2026" });
    await expect(card).toBeVisible();
    const steps = card.getByRole('list', { name: 'Étapes de la clôture 2026' });
    await expect(steps.getByRole('heading', { level: 4 })).toHaveText([
      '1. Vérifier les soldes au 31 décembre', '2. Enregistrer les intérêts 2026', '3. Relevés annuels des placements',
      '4. Restitution du capital de vos parents', '5. Votre année 2026', '6. Préparer la déclaration des revenus 2026',
      '7. Paramètres fiscaux 2027', '8. Garder une archive sur cet appareil', "9. Clôturer l'année 2026",
    ]);
    // Fraîcheur compte par compte : le LEP n'a pas été vérifié depuis le 31 décembre.
    await expect(step(page, 'balances')).toContainText(/LEP\s*· dernier solde constaté le/);
    await expect(step(page, 'balances')).toContainText(/Livret A\s*· vérifié le 31 décembre 2026/);
    await expect(step(page, 'interest')).toContainText(/Dont environ \d+\s€ produits par le capital de vos parents/);
    await expect(step(page, 'restitution')).toContainText(/Prévue le 1er janvier : 9\s500\s€ à rendre/);

    // --- Relevés : valeur déjà reportée au 31/12, taux servi confirmé ---
    await step(page, 'statements').getByRole('button', { name: 'Taux inchangé' }).click();
    await expect(step(page, 'statements')).toContainText(/^Fait : /);

    // --- Déclaration : coche à la main ---
    await step(page, 'tax-return').getByRole('checkbox', { name: "C'est noté" }).check();
    await expect(step(page, 'tax-return')).toContainText(/^Fait : /);

    // --- Paramètres fiscaux de la nouvelle année : confirmés ---
    await step(page, 'fiscal-params').getByRole('button', { name: "C'est à jour" }).click();
    await expect(step(page, 'fiscal-params')).toContainText(/^Fait : /);

    // --- Archive : JSON (réimportable) et CSV pour Excel ---
    const [json] = await Promise.all([page.waitForEvent('download'), step(page, 'archive').getByRole('button', { name: 'Télécharger' }).first().click()]);
    expect(json.suggestedFilename()).toBe('pecule-archive-2026.json');
    const data = JSON.parse(await readFile((await json.path())!, 'utf-8'));
    expect(data.accounts.length).toBe(5);
    expect(data.config.geminiApiKey).toBeUndefined();
    const [csv] = await Promise.all([page.waitForEvent('download'), step(page, 'archive').getByRole('button', { name: 'Télécharger' }).last().click()]);
    expect(csv.suggestedFilename()).toBe('pecule-2026-mouvements-et-soldes.csv');
    const text = await readFile((await csv.path())!, 'utf-8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Mouvements 2026');
    expect(text).toContain('Soldes au 31/12/2026');
    expect(text).toContain('Compte;Type;Établissement;Votre part (€);Part des parents (€);Total (€)');
    await expect(step(page, 'archive')).toContainText(/^Fait : /);

    // --- « Votre année » s'ouvre depuis la clôture ---
    await step(page, 'review').getByRole('button', { name: 'Voir votre année 2026' }).click();
    const sheet = page.getByRole('dialog', { name: 'Votre année 2026' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(card).toContainText('5 étapes sur 8 faites');

    // --- Clôturer : étapes en suspens, donc confirmation ---
    await step(page, 'close').getByRole('button', { name: 'Clôturer 2026' }).click();
    const confirm = page.getByRole('dialog', { name: "Clôturer l'année 2026 ?" });
    await expect(confirm).toContainText(/Il reste 3 étapes : Vérifier les soldes au 31 décembre ; Enregistrer les intérêts 2026 ; Restitution du capital de vos parents/);
    await confirm.getByRole('button', { name: 'Clôturer 2026' }).click();
    await expect(card).toContainText('Année clôturée : plus de rappel de clôture.');
    await expect(step(page, 'close')).toContainText(/Année clôturée le 10 janvier/);

    // --- Accueil : la tâche a disparu ---
    await goTo(page, 'Accueil', isMobile);
    await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
    await expect(page.getByText(/^Clôture de l'année 2026/)).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('après la restitution, les textes passent en solo sans rien changer d\'autre', async ({ page, isMobile }) => {
    await openDemo(page);
    const hero = page.getByRole('region', { name: 'Mon épargne nette' });
    await expect(hero).toContainText('Votre part, hors capital de vos parents');

    await goTo(page, 'Part parentale', isMobile);
    await page.getByRole('button', { name: "J'ai rendu l'argent : enregistrer la restitution" }).click();
    await page.getByLabel('Date du retrait réel').fill('2027-01-01');
    await page.getByRole('button', { name: 'Confirmer la restitution' }).click();
    await expect(page.getByRole('heading', { name: /^Restitution effectuée le 1er janvier 2027/ })).toBeVisible();

    // Accueil : plus de mention des parents.
    await goTo(page, 'Accueil', isMobile);
    await expect(hero).toContainText('Le total de vos comptes');
    await expect(hero).not.toContainText('parents');

    // Mes comptes (ordinateur) : plus de colonne « Parents ».
    if (!isMobile) {
      await goTo(page, 'Mes comptes', isMobile);
      await expect(page.locator('thead th').filter({ hasText: /^Parents$/ })).toHaveCount(0);
    }

    // Clôture : l'étape de la restitution est faite, la suite s'écrit en solo.
    await goTo(page, 'Historique', isMobile);
    await expect(step(page, 'restitution')).toContainText(/^Fait : /);
    await expect(step(page, 'restitution')).toContainText(/9\s500\s€ rendus le 1er janvier\. Vous continuez en solo\./);
  });
});
