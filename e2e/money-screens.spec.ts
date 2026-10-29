// Dons et impôts, Part parentale, Fiches de paie et « Où le placer » en mode démo (?demo=1) :
// champs reliés à leur libellé, focus gardé dans la liste après une suppression au clavier
// (WCAG 2.4.3), annulation depuis le message, case de paie cochable sur toute la ligne,
// bouton désactivé qui dit pourquoi, aucun défilement horizontal à 320 px, et passe axe sur
// les règles de nom, de libellé et de listes.
import { test, expect, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LATEST_VERSION } from '../src/changelog';

// axe-core est déjà installé avec eslint-plugin-jsx-a11y (dépendance de développement).
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
type AxeApi = { run: (ctx: Document, opts: unknown) => Promise<{ violations: { id: string; nodes: { html: string }[] }[] }> };

const openDemo = async (page: Page, view: string) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto(`/?demo=1&view=${view}`);
  await expect(page.locator('main h2').first()).toBeVisible();
};

/** Élément qui a le focus : dans l'écran (<main>), jamais sur <body>. */
const focusIsInMain = (page: Page) => page.evaluate(() => {
  const el = document.activeElement;
  return !!el && el !== document.body && !!el.closest('main');
});

test.describe('Dons et impôts (démo)', () => {
  test('ajouter un don, le supprimer au clavier (le focus reste dans la liste), puis annuler', async ({ page }) => {
    await openDemo(page, 'donations');
    await page.getByLabel('Association', { exact: true }).fill('Restos du cœur');
    await page.getByLabel('Montant', { exact: true }).fill('50,5');
    await page.getByRole('button', { name: 'Ajouter le don' }).click();

    const remove = page.getByRole('button', { name: 'Supprimer le don à Restos du cœur' });
    await expect(remove).toBeVisible();
    // Le formulaire est vidé, l'association est une suggestion de la prochaine saisie.
    await expect(page.getByLabel('Association', { exact: true })).toHaveValue('');

    await remove.focus();
    await page.keyboard.press('Enter');
    const toast = page.getByRole('status').filter({ hasText: 'Don à Restos du cœur supprimé' });
    await expect(toast).toBeVisible();
    await expect(remove).toHaveCount(0);
    await expect.poll(() => focusIsInMain(page)).toBe(true);

    await toast.getByRole('button', { name: 'Annuler' }).click();
    await expect(remove).toBeVisible();
  });

  test('erreur de saisie annoncée, champs reliés à leur libellé', async ({ page }) => {
    await openDemo(page, 'donations');
    await page.getByRole('button', { name: 'Ajouter le don' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "Indiquez l'association" })).toBeVisible();
    for (const label of ['Association', 'Montant', 'Date du don', 'Note (facultative)', 'Année']) {
      await expect(page.getByLabel(label, { exact: true }), label).toBeVisible();
    }
  });
});

test.describe('Fiches de paie (démo)', () => {
  test('sans clé Picker : « Importer depuis Drive » est désactivé et la raison est écrite', async ({ page }) => {
    await openDemo(page, 'payslips');
    const importer = page.getByRole('button', { name: 'Importer depuis Drive' });
    await expect(importer).toBeDisabled();
    await expect(importer).toHaveAccessibleDescription(/clé Google Picker/);
    // Désactivé : on ne le confond pas avec un bouton actif (fond et texte atténués, pas de voile).
    await expect(importer).toHaveCSS('opacity', '1');
  });

  test('« Choisir sur l’appareil » : la fiche choisie s’ouvre en import, sans Drive', async ({ page }) => {
    await openDemo(page, 'payslips');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: "Choisir sur l'appareil" }).click();
    await (await chooser).setFiles({ name: 'Paie octobre.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fiche fictive') });
    await expect(page.getByRole('heading', { name: 'Paie octobre.pdf' })).toBeVisible();
    await expect(page.getByText(/pas copiée sur votre Drive/)).toBeVisible();
    await page.getByRole('button', { name: 'Saisir à la main' }).click();
    await expect(page.getByLabel('Net payé')).toBeVisible();
  });

  test('retirer une fiche au clavier : le focus passe à la fiche voisine, « Annuler » la remet', async ({ page }) => {
    await openDemo(page, 'payslips');
    const removes = page.getByRole('button', { name: /^Retirer la fiche de .* de la liste$/ });
    const before = await removes.count();
    expect(before).toBeGreaterThan(2);
    const second = removes.nth(1);
    const label = (await second.getAttribute('aria-label'))!;
    await second.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: label })).toHaveCount(0);
    await expect(removes).toHaveCount(before - 1);
    await expect.poll(() => focusIsInMain(page)).toBe(true);

    await page.getByRole('status').filter({ hasText: 'retirée de la liste' }).getByRole('button', { name: 'Annuler' }).click();
    await expect(removes).toHaveCount(before);
  });
});

test.describe('Où le placer (démo)', () => {
  test('toucher le nom du compte coche la ligne, et la ligne a une cible d’au moins 48 px', async ({ page, isMobile }) => {
    await openDemo(page, 'pilot');
    const livret = page.getByRole('checkbox', { name: 'Livret A' });
    await expect(livret).not.toBeChecked();
    const row = page.locator('label').filter({ has: livret });
    if (isMobile) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    // Clic sur le texte d'état, à côté de la case de 20 px.
    await row.getByText('Cocher enregistre le versement sur le compte').click();
    await expect(livret).toBeChecked();
    await expect(page.getByText(/^\d+\/\d+ faits$/)).toBeVisible();
    await livret.uncheck();
    await expect(livret).not.toBeChecked();
  });
});

test.describe('Accessibilité des écrans d’argent (démo)', () => {
  test('aucun défilement horizontal à 320 px, écrans sans débordement', async ({ page, isMobile }) => {
    test.skip(isMobile, 'une seule largeur, fixée ici');
    await page.setViewportSize({ width: 320, height: 700 });
    for (const [view, title] of [['donations', 'Dons et impôts'], ['parental', 'Part parentale'], ['payslips', 'Fiches de paie']]) {
      await openDemo(page, view);
      await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible();
      const overflow = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        const wide = Array.from(main.querySelectorAll<HTMLElement>('*'))
          .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('[class*="overflow-x-auto"], [class*="overflow-hidden"]'))
          .map(el => `${el.tagName}.${String(el.className).slice(0, 60)}`);
        return { scroll: main.scrollWidth - main.clientWidth, wide: wide.slice(0, 3) };
      });
      expect(overflow, view).toEqual({ scroll: 0, wide: [] });
    }
  });
});

test.describe('Règles axe : noms, libellés, listes', () => {
  // Le script d'axe est injecté dans la page : la politique de sécurité de l'app l'interdirait.
  test.use({ bypassCSP: true });
  for (const view of ['donations', 'parental', 'payslips', 'pilot']) {
    test(`écran ${view}`, async ({ page }) => {
      await openDemo(page, view);
      await page.waitForTimeout(500); // contenus chargés à la demande
      await page.addScriptTag({ content: AXE });
      const found = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: AxeApi }).axe;
        const res = await axe.run(document, { runOnly: { type: 'rule', values: [
          'label', 'button-name', 'link-name', 'select-name', 'input-button-name', 'form-field-multiple-labels',
          'list', 'listitem', 'definition-list', 'dlitem', 'td-headers-attr', 'th-has-data-cells',
          'aria-valid-attr', 'aria-valid-attr-value', 'aria-required-children', 'aria-required-parent', 'duplicate-id-aria',
        ] } });
        return res.violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.html.slice(0, 120)}`));
      });
      expect(found, view).toEqual([]);
    });
  }
});
