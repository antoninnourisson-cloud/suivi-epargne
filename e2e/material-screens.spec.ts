// Écrans Journal, Virements, Agenda, Abonnements, Historique, Mes comptes (recherche) et « Et si… » en
// mode démo (?demo=1) : aucun défilement horizontal à 320 px (WCAG 1.4.10, refusion),
// lignes du Journal lisibles sur téléphone, et ajout rapide protégé (un toucher hors de la
// feuille ne perd pas la saisie, « Annuler » après l'ajout).
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page, view?: string) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto(`/?demo=1${view ? `&view=${view}` : ''}`);
};

const SCREENS: [view: string, title: string][] = [
  ['journal', 'Journal'], ['transfers', 'Virements'], ['agenda', 'Agenda'],
  ['subscriptions', 'Abonnements'], ['history', 'Historique'], ['accounts', 'Mes comptes'],
  ['simulator', 'Et si…'], ['yield', 'Rendement'],
];

test.describe('écrans Material 3 (démo)', () => {
  test('aucun défilement horizontal à 320 px de large', async ({ page, isMobile }) => {
    test.skip(isMobile, 'une seule largeur, fixée ici');
    test.setTimeout(120_000); // huit écrans, le serveur de dev compile chacun à la première ouverture
    await page.setViewportSize({ width: 320, height: 700 });
    const overflowOf = () => page.evaluate(() => {
      const main = document.querySelector('main')!;
      const wide = Array.from(main.querySelectorAll<HTMLElement>('*'))
        .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('[class*="overflow-x-auto"], [class*="overflow-hidden"]'))
        .map(el => `${el.tagName}.${String(el.className).slice(0, 60)}`);
      // Un tableau dans son cadre à défilement horizontal : la page ne déborde pas, mais une
      // colonne coupée (« Total banque », « Acquis ») ne se lit qu'en faisant glisser le
      // tableau. Aucun cadre ne doit avoir à défiler à 320 px.
      const scrollers = Array.from(main.querySelectorAll<HTMLElement>('[class*="overflow-x-auto"]'))
        .filter(el => el.scrollWidth > el.clientWidth + 1)
        .map(el => `${el.firstElementChild?.tagName ?? el.tagName} ${el.scrollWidth}>${el.clientWidth} ${(el.textContent ?? '').trim().slice(0, 40)}`);
      return { scroll: main.scrollWidth - main.clientWidth, wide: wide.slice(0, 3), scrollers: scrollers.slice(0, 3) };
    });
    for (const [view, title] of SCREENS) {
      await openDemo(page, view);
      // Première ouverture : le serveur de dev compile l'écran (lent quand deux tests tournent).
      await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible({ timeout: 15_000 });
      if (view === 'accounts') await page.getByLabel('Rechercher un mouvement').fill('a');
      expect.soft(await overflowOf(), view).toEqual({ scroll: 0, wide: [], scrollers: [] });
      // Les onglets d'un écran se mesurent aussi : chacun a son propre contenu.
      const tabs = view === 'transfers' ? ['Virement', 'Récurrents'] : view === 'history' ? ['Charges fixes'] : [];
      for (const tab of tabs) {
        await page.getByRole('tab', { name: tab }).click();
        expect.soft(await overflowOf(), `${view} / ${tab}`).toEqual({ scroll: 0, wide: [], scrollers: [] });
      }
    }
  });

  test('Journal sur téléphone : titre en entier, actions sous le titre', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mise en page du téléphone');
    await openDemo(page, 'journal');
    const row = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: "Pas de l'épargne" }) }).first();
    const title = row.locator('p').first();
    const action = row.getByRole('button', { name: "Pas de l'épargne" });
    const [t, a] = [await title.boundingBox(), await action.boundingBox()];
    // Le titre n'est pas réduit à une lettre : au moins la moitié de la ligne.
    expect(t!.width).toBeGreaterThan(150);
    expect(a!.y).toBeGreaterThanOrEqual(t!.y + t!.height - 1);
    expect(a!.height).toBeGreaterThanOrEqual(48);
  });

  test('ajout rapide : un toucher hors de la feuille garde la saisie, puis « Annuler » après l’ajout', async ({ page }) => {
    await openDemo(page);
    await expect(page.getByRole('heading', { name: 'Accueil', level: 2 })).toBeAttached();
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await dialog.getByLabel('Compte').selectOption({ label: 'LDDS' });
    await dialog.getByLabel('Montant').fill('42');
    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Montant')).toHaveValue(/42/);
    await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(dialog).toBeHidden();
    const toast = page.getByRole('status').filter({ hasText: /\+42\s€ sur LDDS/ });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Annuler' }).click();
    await expect(toast).toBeHidden();
  });

  test('ordinateur : le bouton d’ajout est dans le menu latéral, pas sur les champs', async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu latéral de l’ordinateur');
    await openDemo(page, 'subscriptions');
    await expect(page.getByRole('heading', { name: 'Abonnements', level: 2 })).toBeVisible();
    const add = page.getByRole('button', { name: 'Ajouter un mouvement' });
    await expect(add).toHaveCount(1);
    await expect(page.locator('aside').getByRole('button', { name: 'Ajouter un mouvement' })).toBeVisible();
  });
});
