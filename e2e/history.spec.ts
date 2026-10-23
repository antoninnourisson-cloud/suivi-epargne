// Historique en mode démo (?demo=1) : la démo a douze mois de points mensuels, la courbe du
// patrimoine s'affiche, et « Voir les données » montre le même contenu en tableau.
import { test, expect } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

test.describe('Historique (démo)', () => {
  test('courbe du patrimoine, tableau des données et variations mois par mois', async ({ page }) => {
    await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
    await page.goto('/?demo=1&view=history');
    await expect(page.getByRole('heading', { name: 'Historique', level: 2 })).toBeVisible();

    const card = page.getByRole('region', { name: 'Évolution de votre patrimoine' });
    await expect(card).toBeVisible();
    await expect(page.getByText("L'historique se construit au fil des mois")).toHaveCount(0);
    // Le graphique est dessiné (masqué aux lecteurs d'écran : la synthèse et le tableau le remplacent).
    await expect(card.locator('svg.recharts-surface').first()).toBeVisible();
    await expect(card.getByText(/^Votre part/).first()).toBeVisible();

    await card.getByRole('button', { name: 'Voir les données' }).click();
    const table = card.getByRole('table', { name: 'Votre patrimoine mois par mois' });
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(12);
    await expect(table.getByRole('columnheader', { name: 'Capital de vos parents' })).toBeVisible();
    await card.getByRole('button', { name: 'Masquer les données' }).click();
    await expect(table).toBeHidden();

    const deltas = page.getByRole('table', { name: 'Variation de votre patrimoine mois par mois' });
    await expect(deltas.locator('tbody tr')).toHaveCount(12);
  });
});
