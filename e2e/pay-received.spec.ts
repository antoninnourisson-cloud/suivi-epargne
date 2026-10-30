// Rituel « J'ai reçu ma paie » en mode démo (?demo=1) : ouvert depuis la carte « Ma paie »
// du Pilotage ou par le lien direct (?action=pay, raccourci de l'icône), une paie déclarée,
// une ligne corrigée, enregistrée en une fois puis annulée d'un seul « Annuler » ; une prime
// placée en entier que l'Accueil reprend comme objectif ; une fiche de paie saisie sur place
// qui rejoint l'écran Fiches de paie.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page, query = 'view=pilot') => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto(`/?demo=1&${query}`);
  await expect(page.locator('main h2').first()).toBeVisible();
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
const roundedEuros = (n: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n)).replace(/\s/g, '\\s') + '\\s€';

/** Le rituel ouvert : le bilan du mois précédent (s'il reste à valider) est passé. */
const ritual = async (page: Page) => {
  const dialog = page.getByRole('dialog', { name: "J'ai reçu ma paie" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 2 })).toBeVisible();
  if (await dialog.getByRole('heading', { name: /^Bilan/ }).count()) await dialog.getByRole('button', { name: 'Continuer' }).click();
  await expect(dialog.getByRole('heading', { name: 'Votre paie' })).toBeVisible();
  return dialog;
};

const card = (page: Page) => page.locator('#pay-checklist');

test('déclarer la paie depuis le Pilotage, corriger une ligne, enregistrer puis annuler', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await openDemo(page);
  await expect(card(page).getByRole('heading', { name: 'Ma paie' })).toBeVisible();
  await expect(card(page).getByText(/^Paie attendue vers le/)).toBeVisible();
  await card(page).getByRole('button', { name: "J'ai reçu ma paie" }).click();

  const dialog = await ritual(page);
  await dialog.getByLabel('Montant reçu').fill('2400');
  await dialog.getByRole('button', { name: 'Voir la répartition' }).click();
  await expect(dialog.getByRole('heading', { name: 'Répartition conseillée' })).toBeFocused();
  await dialog.getByRole('checkbox', { name: /^Livret A/ }).check();
  await dialog.getByRole('textbox', { name: 'Montant fait pour Livret A' }).fill('123');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).toBeHidden();

  // Carte « Ma paie » : la paie reçue, la ligne faite, le reste à faire.
  const status = page.getByRole('status').filter({ hasText: 'Virement de paie' });
  await expect(status).toContainText('123');
  await expect(card(page).getByText(/^Paie reçue le/)).toBeVisible();
  await expect(card(page).getByRole('checkbox', { name: 'Livret A' })).toBeChecked();
  await expect(card(page).getByText(/^1\/\d+ faits$/)).toBeVisible();

  // Un seul « Annuler » défait tout : paie et versement.
  await status.getByRole('button', { name: 'Annuler' }).click();
  await expect(card(page).getByRole('button', { name: "J'ai reçu ma paie" })).toBeVisible();
  await expect(card(page).getByRole('checkbox', { name: 'Livret A' })).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('lien direct : prime placée en entier, « Tout est fait », et l’Accueil reprend l’objectif', async ({ page, isMobile }) => {
  await openDemo(page, 'view=pilot&action=pay');
  // Le lien est retiré de l'adresse (un rechargement ne rouvre pas la feuille).
  await expect(page).not.toHaveURL(/action=pay/);
  const dialog = await ritual(page);
  await dialog.getByLabel('Montant reçu').fill('2900');
  await dialog.getByRole('button', { name: 'Dont prime ou exceptionnel' }).click();
  await dialog.getByRole('textbox', { name: 'Dont prime ou exceptionnel' }).fill('500');
  await dialog.getByRole('button', { name: 'Voir la répartition' }).click();
  await expect(dialog.getByText(/Dont prime placée en entier : 500/)).toBeVisible();
  const toSave = euros(await dialog.getByLabel('À placer').inputValue());
  await dialog.getByRole('button', { name: 'Tout est fait comme conseillé' }).click();
  await expect(dialog).toBeHidden();

  await expect(card(page).getByText('Tout est fait')).toBeVisible();
  const hero = card(page).getByRole('region', { name: 'Paie reçue' });
  await expect(hero).toContainText('Dont prime placée en entier');
  await expect.poll(async () => euros((await hero.textContent())!.match(/À placer sur cette paie\s*([\d\s ,]+)€/)?.[1] ?? '')).toBeCloseTo(toSave, 2);

  // L'Accueil affiche le même objectif que la carte.
  await goTo(page, 'Accueil', isMobile);
  await expect(page.getByText(new RegExp(`/\\s*${roundedEuros(toSave)}`)).first()).toBeVisible();
});

test('fiche de paie saisie dans le rituel : son net payé devient le montant, et elle rejoint les fiches', async ({ page, isMobile }) => {
  await openDemo(page);
  await card(page).getByRole('button', { name: "J'ai reçu ma paie" }).click();
  const dialog = await ritual(page);
  const slip = dialog.getByRole('region', { name: /^Fiche de paie/ });
  await slip.getByRole('button', { name: 'Saisir à la main' }).click();
  await dialog.getByLabel('Net payé').fill('2 600,40');
  await dialog.getByLabel('Net payé').blur();
  await dialog.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(dialog.getByLabel('Montant reçu')).toHaveValue('2600,40');
  await expect(slip).toContainText('Net payé');
  await dialog.getByRole('button', { name: 'Voir la répartition' }).click();
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page).getByText(/^Paie reçue le .* : 2\s600,40\s€/)).toBeVisible();

  await goTo(page, 'Fiches de paie', isMobile);
  await expect(page.getByText(/2\s600,40\s€/).first()).toBeVisible();
});
