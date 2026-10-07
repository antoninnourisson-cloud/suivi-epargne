// Répétition générale de la restitution du capital des parents (prévue vers le 1er janvier
// 2027), en mode démo, par la vraie interface : planifier, enregistrer, vérifier les soldes
// écran par écran, le passage en mode solo et le relevé, puis annuler (par le toast, puis
// depuis l'écran) et vérifier que tout est revenu.
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { LATEST_VERSION } from '../src/changelog';

// Données de démo (src/dev/demoData.ts) : les deux comptes qui ont une part parentale.
const WITH_PARENTS = ['Livret A', 'LEP'];
const ALL = ['Livret A', 'LEP', 'LDDS', 'Assurance vie', 'Compte courant'];
const SCREENS = [
  'Accueil', 'Actualiser les soldes', 'Mes comptes', 'Virements', 'Journal', 'Pilotage', 'Abonnements',
  'Fiches de paie', 'Dons et impôts', 'Rendement', 'Historique', 'Agenda', 'Paramètres',
];

const openDemo = async (page: Page) => {
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
};

const goTo = async (page: Page, label: string, isMobile: boolean) => {
  if (!isMobile) {
    await page.locator('aside').getByRole('button', { name: label, exact: true }).click();
  } else {
    const short: Record<string, string> = { 'Actualiser les soldes': 'Actualiser', 'Mes comptes': 'Comptes' };
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

/** « 8 200,00 € » → 8200 */
const euros = (text: string | null) => {
  const n = Number((text || '').replace(/[^\d,-]/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`montant illisible : ${text}`);
  return n;
};

type Figures = Record<string, { owned: number; parental: number }>;

/** Part propre et part des parents de chaque compte, lues dans « Mes comptes ». */
const readAccounts = async (page: Page, isMobile: boolean): Promise<Figures> => {
  await goTo(page, 'Mes comptes', isMobile);
  const out: Figures = {};
  for (const name of ALL) {
    const row = page.locator('tbody > tr').filter({ has: page.getByRole('button', { name: `${name} : voir les mouvements`, exact: true }) });
    await expect(row).toHaveCount(1);
    const owned = euros(await row.locator('td').nth(1).locator('div').first().textContent());
    let parental: number;
    if (isMobile) {
      const tag = row.getByText(/^Parents : /);
      parental = (await tag.count()) ? euros(await tag.textContent()) : 0;
    } else {
      parental = euros(await row.locator('td').nth(2).textContent());
    }
    out[name] = { owned, parental };
  }
  return out;
};

/** Champ « Part des parents » de l'écran Actualiser, pour un compte (déplié). */
const parentalFieldInUpdate = async (page: Page, isMobile: boolean, name: string) => {
  await goTo(page, 'Actualiser les soldes', isMobile);
  const toggle = page.locator('li > h3 > button').filter({ hasText: name }).first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByRole('textbox', { name: `Ma part sur ${name}` })).toBeVisible();
  return page.getByRole('textbox', { name: `Part des parents sur ${name}` });
};

const recordRestitution = async (page: Page, date: string) => {
  await page.getByRole('button', { name: "J'ai rendu l'argent : enregistrer la restitution" }).click();
  await page.getByLabel('Date du retrait réel').fill(date);
  await page.getByRole('button', { name: 'Confirmer la restitution' }).click();
};

test.describe('Répétition générale de la restitution', () => {
  test('planifier, enregistrer, vérifier le mode solo et le relevé, puis annuler', async ({ page, isMobile }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openDemo(page);

    // --- Avant : les soldes de référence ---
    const before = await readAccounts(page, isMobile);
    for (const name of WITH_PARENTS) expect(before[name].parental, name).toBeGreaterThan(0);
    const totalParents = Object.values(before).reduce((s, a) => s + a.parental, 0);
    await expect(await parentalFieldInUpdate(page, isMobile, 'Livret A')).toBeVisible();

    // --- Planifier ---
    await goTo(page, 'Part parentale', isMobile);
    await expect(page.getByRole('heading', { name: 'Restitution du capital' })).toBeVisible();
    const plannedDate = page.getByLabel('Date de retrait prévue');
    await expect(plannedDate).toHaveValue('2027-01-01');               // déjà planifiée dans la démo
    await page.getByRole('button', { name: 'Retirer les rappels' }).click();
    await expect(page.getByText(/^Rappels prévus/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Planifier (rappels)' }).click();
    await expect(page.getByText(/^Rappels prévus : début décembre, puis le 1er janvier 2027/)).toBeVisible();
    await expect(page.getByText(/^Bonne date : toute l'année 2026 d'intérêts est acquise/)).toBeVisible();

    // Le tableau « À rendre » annonce exactement la part des parents de chaque compte.
    const planTable = page.locator('table').filter({ hasText: 'À rendre' });
    for (const name of WITH_PARENTS) {
      const row = planTable.locator('tbody tr').filter({ has: page.getByRole('cell', { name, exact: true }) });
      expect(euros(await row.locator('td').nth(1).textContent()), name).toBe(before[name].parental);
    }
    const totalRow = planTable.locator('tbody tr').filter({ has: page.getByRole('cell', { name: 'Total', exact: true }) });
    expect(euros(await totalRow.locator('td').nth(1).textContent())).toBe(totalParents);

    // Date du retrait effacée : refus explicite (autrefois, la part des parents était mise
    // à zéro SANS mouvement de restitution, donc impossible à rétablir depuis l'écran).
    await recordRestitution(page, '');
    await expect(page.getByRole('alert').filter({ hasText: 'Date de retrait invalide.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Restitution du capital' })).toBeVisible();

    // --- 1er passage : enregistrer puis annuler aussitôt par le toast ---
    await recordRestitution(page, '2027-01-01');
    const toast = page.getByRole('status').filter({ hasText: 'Restitution enregistrée' });
    await expect(toast).toContainText(/Restitution enregistrée : 9\s500\s€/);
    await toast.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('heading', { name: 'Restitution du capital' })).toBeVisible();
    expect(await readAccounts(page, isMobile)).toEqual(before);

    // --- 2e passage : enregistrer pour de bon ---
    await goTo(page, 'Part parentale', isMobile);
    await recordRestitution(page, '2027-01-01');
    await expect(page.getByRole('heading', { name: /^Restitution effectuée le 1er janvier 2027/ })).toBeVisible();
    await expect(page.getByText(/rendus à vos parents\. Votre part n'a pas bougé\./)).toContainText(/^9\s500\s€/);
    await expect(page.getByText(/^Intérêts de leur capital qu'ils vous ont offerts : 2026 : /)).toBeVisible();
    // Plus de part parentale : les cartes « Mon capital / Capital parents » disparaissent.
    await expect(page.getByText('Capital parents')).toHaveCount(0);

    // Relevé CSV
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exporter le relevé (CSV)' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('restitution-parents-2027-01-01.csv');
    const csv = await readFile((await download.path())!, 'utf-8');
    expect(csv).toContain('Relevé de restitution du capital parental,2027-01-01');
    for (const name of WITH_PARENTS) expect(csv).toContain(`"${name}",${before[name].parental.toFixed(2)}`);
    expect(csv).toContain(`Total,${totalParents.toFixed(2)}`);
    expect(csv).toMatch(/\n2026,\d+\.\d\d\n/);

    // Soldes : part des parents à 0 partout, part propre inchangée.
    const after = await readAccounts(page, isMobile);
    for (const name of ALL) {
      expect(after[name].parental, name).toBe(0);
      expect(after[name].owned, name).toBe(before[name].owned);
    }
    // Mode solo : plus de champ « Part des parents » dans Actualiser.
    await expect(await parentalFieldInUpdate(page, isMobile, 'Livret A')).toHaveCount(0);
    // Mode solo : chaque écran fonctionne sans part parentale.
    for (const label of SCREENS) {
      await goTo(page, label, isMobile);
      await expect(page.getByText("Cet écran n'a pas pu s'afficher")).toHaveCount(0);
    }
    // L'écran Part parentale reste accessible (relevé).
    await goTo(page, 'Part parentale', isMobile);
    await expect(page.getByRole('heading', { name: /^Restitution effectuée/ })).toBeVisible();

    // --- Annulation depuis l'écran ---
    await page.getByRole('button', { name: 'Annuler la restitution' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Restitution annulée : la part de vos parents est rétablie' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Restitution du capital' })).toBeVisible();
    await expect(page.getByText(/^Rappels prévus : début décembre, puis le 1er janvier 2027/)).toBeVisible();
    expect(await readAccounts(page, isMobile)).toEqual(before);
    await expect(await parentalFieldInUpdate(page, isMobile, 'Livret A')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
