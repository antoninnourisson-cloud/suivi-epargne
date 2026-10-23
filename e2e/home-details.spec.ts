// Accueil, section « Plus de détails » (mode démo, ?demo=1) : repliée par défaut, elle s'ouvre
// sur la projection, la répartition par établissement et la courbe d'épargne ; la période se
// choisit, l'export CSV est au format d'Excel en français, et le choix « ouvert » est gardé.
import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

test.describe('Accueil : plus de détails (démo)', () => {
  test('la section s’ouvre, sa période se choisit, et elle reste ouverte au retour', async ({ page }) => {
    await openDemo(page);
    const toggle = page.getByRole('button', { name: /^Plus de détails/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Repliée : rien n'est rendu (ni calculé).
    await expect(page.locator('#home-more')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const more = page.locator('#home-more');
    await expect(more.getByText('Par établissement')).toBeVisible();
    await expect(more.getByText('Évolution de mon épargne nette')).toBeVisible();

    // Période : une date de début saisie est gardée.
    const start = more.getByLabel('Début de la période', { exact: true });
    await start.fill('2026-01-01');
    await expect(start).toHaveValue('2026-01-01');

    // Export de la période choisie (pas une sauvegarde) : un jour par ligne, « ; », BOM UTF-8,
    // montants à virgule, le nom du fichier dit la période.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      more.getByRole('button', { name: 'Exporter la période (CSV)' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^pecule-evolution-2026-01-01-au-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path())!, 'utf-8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toMatch(/^﻿Date;[^\r\n]+;Total, votre part \(€\)\r\n2026-01-01;/);
    expect(csv).toMatch(/\r\n2026-01-02;(?:\d+,\d\d;)+\d+,\d\d\r\n/);

    // Période inversée : pas d'export, et on dit pourquoi.
    await more.getByLabel('Fin de la période', { exact: true }).fill('2025-12-01');
    await expect(more.getByRole('button', { name: 'Exporter la période (CSV)' })).toBeDisabled();
    await expect(more.getByRole('alert')).toContainText('La date de début doit précéder la date de fin');
    // Date effacée : le message dit qu'elle manque (et non que la période est inversée).
    await more.getByLabel('Fin de la période', { exact: true }).fill('');
    await expect(more.getByRole('button', { name: 'Exporter la période (CSV)' })).toBeDisabled();
    await expect(more.getByRole('alert')).toContainText('Choisissez une date de début et une date de fin');
    await more.getByLabel('Fin de la période', { exact: true }).fill('2026-06-30');
    await expect(more.getByRole('alert')).toHaveCount(0);

    // Au retour sur l'Accueil, la section est toujours ouverte, avec la même période.
    await openDemo(page);
    await expect(page.getByRole('button', { name: /^Plus de détails/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#home-more').getByLabel('Début de la période', { exact: true })).toHaveValue('2026-01-01');
  });
});
