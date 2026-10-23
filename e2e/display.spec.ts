// Affichage (mode démo, ?demo=1) : le thème suit l'appareil tant qu'on n'a rien choisi, la
// couleur de la barre d'état suit le thème AFFICHÉ, le titre d'écran reçoit le focus sans
// anneau, et sur téléphone chaque contrôle offre une cible tactile d'au moins 48 px.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const openDemo = async (page: Page, view?: string) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto(`/?demo=1${view ? `&view=${view}` : ''}`);
  await expect(page.locator('main h2').first()).toBeAttached();
};

// La carte « Affichage » des Paramètres : ouverte seulement si elle ne l'est pas déjà (l'état
// ouvert ou replié des cartes est gardé sur l'appareil, donc au rechargement aussi).
const openDisplayCard = async (page: Page) => {
  const toggle = page.getByRole('button', { name: /^Affichage/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  return page.getByRole('group', { name: 'Thème' });
};

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('dark'));
const themeColors = (page: Page) => page.evaluate(() =>
  Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map(m => m.content));

test.describe('Affichage (démo)', () => {
  test('le thème suit l’appareil, sauf choix explicite, et la barre d’état suit le thème affiché', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openDemo(page, 'settings');
    expect(await isDark(page)).toBe(false);
    const light = await themeColors(page);
    expect(light).toHaveLength(1);

    // L'appareil passe en sombre : l'app suit, sans rechargement, et la barre d'état aussi.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => isDark(page)).toBe(true);
    const dark = await themeColors(page);
    expect(dark).toHaveLength(1);
    expect(dark[0]).not.toBe(light[0]);

    // Choix explicite « Clair » : gardé au rechargement, même avec un appareil en sombre.
    const group = await openDisplayCard(page);
    await group.getByRole('button', { name: /Clair/ }).click();
    expect(await isDark(page)).toBe(false);
    await page.reload();
    await expect(page.locator('main h2').first()).toBeAttached();
    expect(await isDark(page)).toBe(false);
    expect(await themeColors(page)).toEqual(light);

    // Retour à « Automatique » : l'appareil reprend la main.
    await (await openDisplayCard(page)).getByRole('button', { name: /Automatique/ }).click();
    await expect.poll(() => isDark(page)).toBe(true);
    expect(await themeColors(page)).toEqual(dark);
  });

  test('le thème sombre est posé avant que l’app ne démarre (pas d’éclair clair)', async ({ page }) => {
    // L'app elle-même n'est pas chargée : seul theme-boot.js a pu poser la classe.
    await page.route(/\/src\/index\.tsx/, route => route.abort());
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/?demo=1');
    expect(await isDark(page)).toBe(true);

    // Choix « Clair » enregistré : il l'emporte sur l'appareil, dès le premier affichage.
    await page.evaluate(() => localStorage.setItem('theme_choice', 'light'));
    await page.reload();
    expect(await isDark(page)).toBe(false);
  });

  test('changer d’écran au clavier met le focus sur le titre, sans anneau', async ({ page }) => {
    await openDemo(page);
    const nav = page.getByRole('navigation', { name: 'Navigation principale' }).filter({ visible: true });
    await nav.getByRole('button', { name: /^Actualiser/ }).focus();
    await page.keyboard.press('Enter');
    const title = page.getByRole('heading', { name: 'Actualiser les soldes', level: 2 });
    await expect(title).toBeFocused();
    expect(await title.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  });

  test('sur téléphone, chaque contrôle de l’Accueil et des Paramètres a un nom et une zone de toucher de 48 px', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'écran tactile seulement');
    for (const view of ['dashboard', 'settings']) {
      await openDemo(page, view === 'dashboard' ? undefined : view);
      // Tout déplier : « Plus de détails » sur l'Accueil, chaque carte des Paramètres.
      const closed = page.locator('main button[aria-expanded="false"]');
      for (let n = await closed.count(); n > 0; n = await closed.count()) await closed.first().click();
      await page.waitForTimeout(500); // contenus chargés à la demande
      const small = await page.evaluate(() => {
        const interactive = 'button, a[href], [role="button"], [role="switch"], [role="tab"], summary, label';
        return Array.from(document.querySelectorAll<HTMLElement>('main :is(button, [role="button"], [role="switch"], [role="tab"], summary)'))
          .filter(el => el.getBoundingClientRect().width > 0 && !el.closest('[hidden]'))
          .flatMap(el => {
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            const labelledBy = (el.getAttribute('aria-labelledby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim();
            const labels = Array.from((el as HTMLButtonElement).labels ?? []).map(l => l.textContent?.trim() ?? '').join(' ').trim();
            const name = el.getAttribute('aria-label') || labelledBy || labels || el.textContent?.trim() || '';
            // Zone de toucher réelle : un point 24 px au-dessus et au-dessous du centre doit
            // toucher ce contrôle (ou un autre contrôle voisin), pas le fond de la page.
            const x = r.left + r.width / 2;
            const reach = (y: number) => { const hit = document.elementFromPoint(x, y); return !!hit && (el.contains(hit) || !!hit.closest(interactive)); };
            const cy = r.top + r.height / 2;
            const ok = reach(cy - 23) && reach(cy + 23);
            return !name || !ok ? [`${Math.round(r.width)}×${Math.round(r.height)} « ${name.slice(0, 40)} »`] : [];
          });
      });
      expect(small, view).toEqual([]);
    }
  });
});
