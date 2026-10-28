// Contrastes AA (WCAG 1.4.3 : 4,5:1 pour le texte, 3:1 en grand ; 1.4.11 : 3:1 pour les
// boutons faits d'une seule icône) : passe axe-core
// « color-contrast » sur les écrans les plus lus et sur une boîte de confirmation, en clair
// et en sombre. Garde-fou contre le retour d'un texte gris trop pâle ou d'un bouton dont le
// fond est forcé.
import { test, expect, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LATEST_VERSION } from '../src/changelog';

// axe-core est déjà installé avec eslint-plugin-jsx-a11y (dépendance de développement).
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

type AxeNode = { html: string; any: { data?: { contrastRatio?: number; fgColor?: string; bgColor?: string } }[] };
type AxeApi = { run: (ctx: Document, opts: unknown) => Promise<{ violations: { nodes: AxeNode[] }[] }> };

/** Éléments sous le seuil, décrits en une ligne (ratio, couleurs, début du HTML). */
const contrastViolations = async (page: Page): Promise<string[]> => {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: AxeApi }).axe;
    const res = await axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    return res.violations.flatMap(v => v.nodes.map(n => {
      const d = n.any[0]?.data;
      return `${d?.contrastRatio} (${d?.fgColor} sur ${d?.bgColor}) ${n.html.slice(0, 120)}`;
    }));
  });
};

/**
 * Boutons faits d'une seule icône (supprimer, modifier, renommer…) : WCAG 1.4.11 demande 3:1
 * entre l'icône et son fond, ce que la règle color-contrast d'axe ne mesure pas. Couleur
 * calculée de l'icône (opacités comprises) contre le fond effectif sous l'icône. Les
 * boutons invisibles (opacité nulle, révélés au survol ou au clavier) sont hors champ.
 */
const iconContrastViolations = (page: Page): Promise<string[]> => page.evaluate(() => {
  type RGBA = { r: number; g: number; b: number; a: number };
  const parse = (c: string): RGBA | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }: RGBA) => {
    const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (fg: RGBA, bg: RGBA): RGBA => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const backgroundUnder = (el: Element): RGBA => {
    const layers: RGBA[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    return layers.reverse().reduce<RGBA>((bg, l) => blend(l, bg), { r: 255, g: 255, b: 255, a: 1 });
  };
  const out: string[] = [];
  for (const b of Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))) {
    if (b.innerText.trim() !== '' || (b as HTMLButtonElement).disabled) continue;
    const svg = b.querySelector('svg');
    if (!svg) continue;
    const box = svg.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || getComputedStyle(b).visibility === 'hidden') continue;
    let opacity = 1;
    for (let e: Element | null = svg; e && e !== document.body; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    if (opacity === 0) continue;
    const fg = parse(getComputedStyle(svg).color);
    if (!fg) continue;
    const bg = backgroundUnder(svg);
    const icon = blend({ ...fg, a: fg.a * opacity }, bg);
    const [hi, lo] = [lum(icon), lum(bg)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < 3) out.push(`${Math.round(ratio * 100) / 100} ${b.getAttribute('aria-label') ?? ''} ${b.outerHTML.slice(0, 120)}`);
  }
  return out;
});

// Écrans les plus lus, et ceux qui ont de petites icônes (Mes comptes, Dons, Fiches de paie ;
// les échéances récurrentes sont dans « Virements »).
const VIEWS = ['dashboard', 'transfers', 'pilot', 'journal', 'parental', 'accounts', 'yield', 'donations', 'payslips', 'agenda', 'subscriptions', 'history'];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Contrastes AA, thème ${theme === 'light' ? 'clair' : 'sombre'}`, () => {
    // Le script d'axe est injecté dans la page : la politique de sécurité de l'app l'interdirait.
    // Mouvement réduit : les boîtes s'affichent sans fondu (sinon couleurs mesurées en plein fondu).
    test.use({ colorScheme: theme, bypassCSP: true, reducedMotion: 'reduce' });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(([v, t]) => {
        try { localStorage.setItem('last_seen_version', v); localStorage.setItem('theme', t); } catch { /* ignoré */ }
      }, [LATEST_VERSION, theme]);
    });

    // Un test par écran : chacun reste court (la passe complète approchait la minute sur mobile).
    for (const view of VIEWS) {
      test(`écran ${view}`, async ({ page }) => {
        await page.goto(`/?demo=1&view=${view}`);
        await expect(page.locator('main h2').first()).toBeVisible();
        await page.waitForTimeout(500); // contenus chargés à la demande
        expect(await contrastViolations(page), view).toEqual([]);
        expect(await iconContrastViolations(page), `icônes, ${view}`).toEqual([]);
      });
    }

    test('feuille « Plus » et boîte de confirmation', async ({ page, isMobile }) => {
      // Boîte de confirmation (texte d'explication) : annuler une restitution enregistrée.
      await page.goto('/?demo=1&view=parental');
      await page.getByRole('button', { name: "J'ai rendu l'argent : enregistrer la restitution" }).click();
      await page.getByRole('button', { name: 'Confirmer la restitution' }).click();
      await page.getByRole('button', { name: 'Annuler la restitution' }).click();
      await expect(page.getByRole('dialog', { name: 'Annuler la restitution ?' })).toBeVisible();
      expect(await contrastViolations(page), 'boîte de confirmation').toEqual([]);
      expect(await iconContrastViolations(page), 'icônes, boîte de confirmation').toEqual([]);
      await page.keyboard.press('Escape');

      if (isMobile) {
        await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Plus', exact: true }).click();
        await expect(page.getByRole('dialog', { name: "Plus d'écrans" })).toBeVisible();
        expect(await contrastViolations(page), 'feuille « Plus »').toEqual([]);
      }
    });

    // Barre du bas d'« Actualiser les soldes » (surface inversée, le piège est en sombre).
    // Elle n'apparaît qu'avec un solde modifié.
    test('barre « Enregistrer » d’Actualiser les soldes', async ({ page }) => {
      await page.goto('/?demo=1&view=update');
      await page.getByRole('button', { name: /^LDDS/ }).click();
      await page.getByLabel('Ma part sur LDDS').fill('3250');
      await expect(page.getByText('1 compte modifié')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toBeVisible();
      expect(await contrastViolations(page), 'barre d’enregistrement').toEqual([]);
      expect(await iconContrastViolations(page), 'icônes, Actualiser').toEqual([]);
    });

    test('écran de connexion', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Continuer avec Google' })).toBeVisible({ timeout: 20_000 });
      expect(await contrastViolations(page), 'connexion').toEqual([]);
      expect(await iconContrastViolations(page), 'icônes, connexion').toEqual([]);
    });
  });
}
