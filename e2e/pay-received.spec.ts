// Rituel « J'ai reçu ma paie » en mode démo (?demo=1) : ouvert depuis la carte « Ma paie »
// du Pilotage ou par le lien direct (?action=pay, raccourci de l'icône), une paie déclarée,
// une ligne corrigée, enregistrée en une fois puis annulée d'un seul « Annuler » ; une prime
// placée en entier que l'Accueil reprend comme objectif ; une fiche de paie saisie sur place
// qui rejoint l'écran Fiches de paie.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';
import { goTo, screenReady } from './nav';

const openDemo = async (page: Page, query = 'view=pilot') => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto(`/?demo=1&${query}`);
  await expect(page.locator('main h2').first()).toBeVisible();
  await screenReady(page);
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
  await expect(dialog.getByRole('heading', { name: 'Que faire de votre paie' })).toBeFocused();
  await dialog.getByRole('checkbox', { name: /^Livret A/ }).check();
  await dialog.getByRole('textbox', { name: 'Montant fait pour Livret A' }).fill('123');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).toBeHidden();

  // Carte « Ma paie » : la paie reçue, le reste à faire (sans la ligne Plaisir), la ligne faite dans le détail.
  const status = page.getByRole('status').filter({ hasText: 'Virement de paie' });
  await expect(status).toContainText('123');
  await expect(card(page).getByText(/^Paie reçue le/)).toBeVisible();
  await expect(card(page).getByText(/^1\/\d+ faits$/)).toBeVisible();
  const todo = card(page).getByRole('region', { name: 'À faire' });
  await expect(todo.getByRole('checkbox').first()).toBeVisible();
  await expect(todo.getByRole('checkbox', { name: 'Livret A' })).toHaveCount(0);
  await expect(card(page).getByRole('checkbox', { name: /plaisir/i })).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Autre argent reçu' })).toBeVisible();
  await card(page).getByRole('button', { name: /^Voir le détail/ }).click();
  await expect(card(page).getByRole('checkbox', { name: 'Livret A' })).toBeChecked();

  // Un seul « Annuler » défait tout : paie et versement. Avant la paie, rien à cocher.
  await status.getByRole('button', { name: 'Annuler' }).click();
  await expect(card(page).getByRole('button', { name: "J'ai reçu ma paie" })).toBeVisible();
  await expect(card(page).getByRole('checkbox')).toHaveCount(0);
  await expect(card(page).getByText(/^Paie attendue vers le/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('compte courant : solde prérempli, reste du mois dernier à répartir, montants corrigés puis rétablis, solde noté et annulé', async ({ page }) => {
  await openDemo(page);
  await card(page).getByRole('button', { name: "J'ai reçu ma paie" }).click();
  const dialog = await ritual(page);
  const current = dialog.getByRole('region', { name: /^Compte courant/ });
  // Le solde connu de la démo date de 2 jours : estimation, solde + paie.
  await expect(current).toContainText(/Estimation : 3\s900\s€ le .* \(il y a 2 jours\), plus votre paie\./);
  await dialog.getByLabel('Montant reçu').fill('2400');
  await dialog.getByLabel('Solde maintenant, paie comprise').fill('2 430');
  await expect(current.getByRole('status')).toHaveText(/^Il restait 30\s€ du mois dernier\.$/);
  await dialog.getByRole('button', { name: 'Voir la répartition' }).click();
  await expect(dialog.getByText(/^2\s400\s€ de paie \+ 30\s€ déjà sur le compte = 2\s430\s€ à répartir$/)).toBeVisible();
  await expect(dialog.getByRole('img', { name: /^Répartition de 2\s430\s€ : virements fixes/ })).toBeVisible();
  // Le plaisir est la ligne d'équilibre : pas de case, son montant suit les autres.
  const leisure = dialog.getByRole('region', { name: /^Plaisir : reste sur le compte courant/ });
  await expect(leisure.getByRole('checkbox')).toHaveCount(0);
  const before = euros((await leisure.getByRole('heading').textContent())!.replace(/^[^\d]*/, ''));
  const livret = dialog.getByRole('textbox', { name: 'Montant fait pour Livret A' });
  const advised = await livret.inputValue();
  await livret.fill(String(euros(advised) + 10).replace('.', ','));
  await expect.poll(async () => euros((await leisure.getByRole('heading').textContent())!.replace(/^[^\d]*/, ''))).toBeCloseTo(before - 10, 2);
  await dialog.getByRole('button', { name: 'Rétablir les montants conseillés' }).click();
  await expect(livret).toHaveValue(advised);
  await expect(dialog.getByRole('button', { name: 'Rétablir les montants conseillés' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Tout est fait comme conseillé' }).click();
  await expect(dialog).toBeHidden();
  // « Tout est fait » note aussi ce qui reste sur le compte courant ; un seul « Annuler » défait tout.
  const status = page.getByRole('status').filter({ hasText: 'Compte courant :' });
  await expect(status).toBeVisible();
  await status.getByRole('button', { name: 'Annuler' }).click();
  await expect(card(page).getByRole('button', { name: "J'ai reçu ma paie" })).toBeVisible();
  await card(page).getByRole('button', { name: "J'ai reçu ma paie" }).click();
  await expect((await ritual(page)).getByRole('region', { name: /^Compte courant/ })).toContainText(/Estimation : 3\s900\s€/);
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
  await expect(dialog.getByText(/dont prime 500\s€/).first()).toBeVisible();
  // L'épargne conseillée : le sous-total du groupe Épargne (prime et reste du compte courant compris).
  const toSave = euros((await dialog.getByRole('heading', { level: 3, name: /^Épargne\s*\d/ }).textContent())!);
  await dialog.getByRole('button', { name: 'Tout est fait comme conseillé' }).click();
  await expect(dialog).toBeHidden();

  // Carte « Ma paie » : tout est fait ; ce qui est placé (prime comprise, placée en entier) vaut l'épargne du rituel.
  await expect(card(page).getByText('Tout est fait', { exact: true })).toBeVisible();
  const headline = card(page).getByText(/^Tout est fait · .* placés · le compte courant démarre à/);
  await expect.poll(async () => euros((await headline.textContent())!.match(/fait · ([\d\s  ,]+)€ placés/)?.[1] ?? '')).toBeCloseTo(toSave, 2);
  const savingsLegend = card(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Épargne$/ }) });
  await expect(savingsLegend).toContainText(/dont prime 500\s€/);
  await expect(card(page).getByRole('img', { name: /^Répartition de / })).toBeVisible();

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

test("Accueil : la routine et la carte du mois d'épargne ouvrent le rituel, puis suivent la paie déclarée", async ({ page, isMobile }) => {
  await openDemo(page, 'view=dashboard');
  const routine = page.getByRole('region', { name: /^Routine (de |d')\S+ : \d\/3$/ });
  await expect(routine).toBeVisible();
  await expect(routine.getByText('Paie reçue et répartie')).toBeVisible();
  const savings = page.getByRole('region', { name: /^Épargne (de |d')(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)$/ });
  await expect(savings.getByText(/^Paie attendue le .* : reçue \?$/)).toBeVisible();
  await savings.getByRole('button', { name: "J'ai reçu ma paie", exact: true }).click();

  const dialog = await ritual(page);
  await dialog.getByRole('button', { name: 'Voir la répartition' }).click();
  await dialog.getByRole('button', { name: 'Tout est fait comme conseillé' }).click();
  await expect(dialog).toBeHidden();

  // De retour sur l'Accueil : plus d'invitation, l'étape « Paie reçue et répartie » est faite.
  await goTo(page, 'Accueil', isMobile);
  await expect(savings).toBeVisible();
  await expect(savings.getByRole('button', { name: "J'ai reçu ma paie", exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^J'ai reçu ma paie : / })).toHaveCount(0);
  // Bilan validé dans le rituel : la carte de l'Accueil ne revient pas.
  await expect(page.getByRole('region', { name: /^Bilan d/ })).toHaveCount(0);
});
