// Accessibilité WCAG 2 A et AA : passe axe-core complète (règles des niveaux A et AA des
// versions 2.0 et 2.1) sur les écrans les plus lus et sur les feuilles principales (Ajouter un
// mouvement, J'ai reçu ma paie, une boîte de confirmation). Les contrastes de couleur, en clair
// et en sombre, restent vérifiés à part dans contrast.spec.ts.
//
// Violations réelles connues, laissées hors du test le temps d'être corrigées : voir
// A_CORRIGER plus bas (chacune porte son explication). Une nouvelle violation, elle, fait
// échouer le test.
import { test, expect, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LATEST_VERSION } from '../src/changelog';
import { screenReady } from './nav';

// axe-core est déjà installé avec eslint-plugin-jsx-a11y (dépendance de développement).
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

type AxeNode = { html: string; target: unknown[] };
type AxeApi = { run: (ctx: Document, opts: unknown) => Promise<{ violations: { id: string; nodes: AxeNode[] }[] }> };

/** Violations connues et réelles, à corriger dans les composants : « règle » et début du HTML. */
const A_CORRIGER: { regle: string; vue?: string; contient: string; pourquoi: string }[] = [];

/** Violations WCAG, décrites en une ligne : règle, cible CSS, début du HTML. */
const wcagViolations = async (page: Page): Promise<{ regle: string; ligne: string }[]> => {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: AxeApi }).axe;
    const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return res.violations.flatMap(v => v.nodes.map(n => ({
      regle: v.id,
      ligne: `${v.id} : ${n.target.join(' ')} ${n.html.slice(0, 140)}`,
    })));
  });
};

/** Les violations pas encore connues : celles qui doivent faire échouer le test. */
const nouvelles = async (page: Page, vue: string): Promise<string[]> => {
  const toutes = await wcagViolations(page);
  return toutes
    .filter(v => !A_CORRIGER.some(k => k.regle === v.regle && (!k.vue || k.vue === vue) && v.ligne.includes(k.contient)))
    .map(v => `${vue} : ${v.ligne}`);
};

// Mêmes écrans que dans contrast.spec.ts (les échéances récurrentes sont dans Comptes › Mouvements).
const VIEWS = ['dashboard', 'transfers', 'pilot', 'pilot&tab=wishes', 'journal', 'parental', 'accounts', 'yield', 'donations', 'payslips', 'agenda', 'subscriptions', 'history', 'taxes&tab=calendar', 'update'];

// Le script d'axe est injecté dans la page : la politique de sécurité de l'app l'interdirait.
// Mouvement réduit : les boîtes s'affichent sans fondu.
test.use({ bypassCSP: true, reducedMotion: 'reduce' });

test.describe('Accessibilité WCAG A et AA (thème clair)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(([v, t]) => {
      try { localStorage.setItem('last_seen_version', v); localStorage.setItem('theme', t); } catch { /* ignoré */ }
    }, [LATEST_VERSION, 'light']);
  });

  for (const view of VIEWS) {
    test(`écran ${view}`, async ({ page }) => {
      await page.goto(`/?demo=1&view=${view}`);
      await expect(page.locator('main h2').first()).toBeVisible();
      await screenReady(page);
      await page.waitForTimeout(500); // contenus chargés à la demande
      if (view === 'transfers') await page.locator('main').getByRole('button', { name: 'Échéances récurrentes' }).click();
      expect(await nouvelles(page, view)).toEqual([]);
    });
  }

  test('écran de connexion', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Continuer avec Google' })).toBeVisible({ timeout: 20_000 });
    expect(await nouvelles(page, 'connexion')).toEqual([]);
  });

  test('feuille « Ajouter un mouvement »', async ({ page }) => {
    await page.goto('/?demo=1&view=journal');
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
    await expect(page.getByRole('dialog', { name: 'Ajouter un mouvement' })).toBeVisible();
    expect(await nouvelles(page, 'feuille Ajouter un mouvement')).toEqual([]);
  });

  test('feuille « Nouvelle envie »', async ({ page }) => {
    await page.goto('/?demo=1&view=pilot&tab=wishes');
    await screenReady(page);
    await page.getByRole('button', { name: 'Ajouter une envie' }).click();
    await expect(page.getByRole('dialog', { name: 'Nouvelle envie' })).toBeVisible();
    expect(await nouvelles(page, 'feuille Nouvelle envie')).toEqual([]);
  });

  test("feuille « J'ai reçu ma paie »", async ({ page }) => {
    await page.goto('/?demo=1&action=pay');
    await expect(page.getByRole('dialog', { name: "J'ai reçu ma paie" })).toBeVisible({ timeout: 20_000 });
    expect(await nouvelles(page, "feuille J'ai reçu ma paie")).toEqual([]);
  });

  test('boîte de confirmation (annuler une restitution)', async ({ page }) => {
    await page.goto('/?demo=1&view=parental');
    await page.getByRole('button', { name: "J'ai rendu l'argent : enregistrer la restitution" }).click();
    await page.getByRole('button', { name: 'Confirmer la restitution' }).click();
    await page.getByRole('button', { name: 'Annuler la restitution' }).click();
    await expect(page.getByRole('dialog', { name: 'Annuler la restitution ?' })).toBeVisible();
    expect(await nouvelles(page, 'boîte de confirmation')).toEqual([]);
  });

  test('feuille « Plus » (téléphone)', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'La feuille « Plus » n’existe que sur téléphone.');
    await page.goto('/?demo=1&view=dashboard');
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Plus', exact: true }).click();
    await expect(page.getByRole('dialog', { name: "Plus d'écrans" })).toBeVisible();
    expect(await nouvelles(page, 'feuille Plus')).toEqual([]);
  });
});
