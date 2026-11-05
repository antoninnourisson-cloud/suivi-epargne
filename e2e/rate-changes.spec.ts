// « Les taux ont changé » en mode démo (?demo=1), format téléphone seulement : une proposition
// de la veille fiscale (simulée dans le stockage de l'appareil) crée la tâche de l'Accueil ; la
// feuille montre le Livret A et le LDDS, puis « Vos autres comptes » ; « Appliquer » change le
// taux des deux livrets, visible sur le compte ; un seul « Annuler » remet l'ancien.
// Démo : Livret A et LDDS à 1,5 % (taux officiel depuis le 1er février 2026), LEP à 2,5 %,
// Assurance vie à 2,6 %.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';
import { goTo } from './nav';

const NOW = new Date('2026-11-04T12:00:00');

/** Démo ouverte ; `watch` : avec le relevé simulé de la veille. */
const openDemo = async (page: Page, watch = true) => {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(([v, at, withWatch]) => {
    try {
      // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
      localStorage.setItem('last_seen_version', v);
      // Résultat de la veille (Gemini), SIMULÉ : taux fictif de 1,25 % au 1er février 2027, pour le test.
      if (withWatch) localStorage.setItem('fiscal_watch', JSON.stringify({
        checkedAt: at, lastSuccessAt: at,
        result: { livretARate: { value: 1.25, effectiveDate: '2027-02-01', source: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2365' } },
      }));
    } catch { /* ignoré */ }
  }, [LATEST_VERSION, NOW.toISOString(), watch] as const);
  await page.goto('/?demo=1');
  await expect(page.locator('main h2').first()).toBeAttached({ timeout: 15_000 });
};

const shot = async (page: Page, name: string) => {
  const dir = process.env.PECULE_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
};

/** Taux affiché dans la fiche du compte (Comptes › Soldes › Modifier). */
const expectAccountRate = async (page: Page, name: string, rate: string) => {
  await goTo(page, 'Mes comptes', true);
  await page.getByRole('button', { name: `Modifier ${name}` }).first().click();
  await expect(page.getByLabel('Taux actuel')).toHaveValue(rate);
  await page.getByRole('button', { name: 'Annuler', exact: true }).first().click();
};

test.describe('Les taux ont changé (démo, téléphone)', () => {
  test.beforeEach(({ isMobile }) => { test.skip(!isMobile, 'format téléphone seulement'); });

  test('la veille crée la tâche ; appliqué au Livret A et au LDDS, puis annulé d’un seul geste', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openDemo(page);
    const task = page.locator('li').filter({ hasText: /^Les taux ont changé : Livret A et LDDS 1,5 % → 1,25 % au 1er février 2027\./ });
    await expect(task).toBeVisible();
    // Le taux ne passe plus par la carte générique de la veille.
    await expect(page.getByRole('heading', { name: 'Veille fiscale' })).toHaveCount(0);
    await task.scrollIntoViewIfNeeded();
    await shot(page, 'r3-tache-accueil');

    await task.getByRole('button', { name: 'Voir et appliquer' }).click();
    const sheet = page.getByRole('dialog', { name: 'Les taux ont changé' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/Actuel : 1,5 % · Livret A, LDDS/)).toBeVisible();
    await expect(sheet.getByLabel('Nouveau taux, Livret A et LDDS')).toHaveValue('1,25');
    await expect(sheet.getByLabel('À partir du, Livret A et LDDS')).toHaveValue('2027-02-01');
    const others = sheet.getByRole('list', { name: 'Vos autres comptes' });
    await expect(others).toContainText(/Assurance vie\s*Actuel : 2,6 %/);
    await sheet.getByRole('heading', { name: 'Vos autres comptes' }).scrollIntoViewIfNeeded();
    await shot(page, 'r3-feuille-autres-comptes');

    await sheet.getByRole('button', { name: 'Appliquer' }).click();
    await expect(sheet).toBeHidden();
    const status = page.getByRole('status').filter({ hasText: 'Taux mis à jour sur 2 comptes' });
    await expect(status).toBeVisible();
    await expect(task).toHaveCount(0);
    await expectAccountRate(page, 'LDDS', '1,25');

    // Un seul « Annuler » : les deux livrets reviennent à 1,5 %, et la tâche revient.
    await status.getByRole('button', { name: 'Annuler' }).click();
    await expectAccountRate(page, 'Livret A', '1,5');
    await goTo(page, 'Accueil', true);
    await expect(task).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('« Un taux a changé ? » depuis Actualiser : les autres comptes seulement', async ({ page }) => {
    await openDemo(page, false);
    await goTo(page, 'Actualiser les soldes', true);
    await page.getByRole('button', { name: 'Un taux a changé ?' }).click();
    const sheet = page.getByRole('dialog', { name: 'Un taux a changé ?' });
    await expect(sheet.getByRole('list', { name: 'Taux réglementés' })).toHaveCount(0);
    await sheet.getByLabel('Nouveau taux, Assurance vie').fill('2,4');
    await sheet.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page.getByRole('status').filter({ hasText: "Taux de l'Assurance vie : 2,4 %" })).toBeVisible();
  });
});
