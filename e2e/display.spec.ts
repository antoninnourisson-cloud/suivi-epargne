// Affichage (mode démo, ?demo=1) : le thème suit l'appareil tant qu'on n'a rien choisi, la
// couleur de la barre d'état suit le thème AFFICHÉ, le titre d'écran reçoit le focus sans
// anneau, et sur téléphone chaque contrôle offre une cible tactile d'au moins 48 px.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';
import { screenReady } from './nav';

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

  for (const height of [800, 720]) {
    test(`sur ordinateur (1280×${height}), seul le contenu défile : le menu latéral reste en place`, { tag: '@ordinateur' }, async ({ page, isMobile }) => {
      test.skip(isMobile, 'menu latéral sur ordinateur seulement');
      await page.setViewportSize({ width: 1280, height });
      await openDemo(page);
      const aside = page.locator('aside');
      // La page elle-même ne déborde pas : le menu tient dans la fenêtre.
      const sizes = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, win: window.innerHeight, aside: document.querySelector('aside')!.getBoundingClientRect().height }));
      expect(sizes.doc).toBeLessThanOrEqual(sizes.win);
      expect(sizes.aside).toBeLessThanOrEqual(sizes.win);
      // Toutes les entrées du menu latéral tiennent sans faire défiler la liste des écrans.
      const sideNav = aside.getByRole('navigation', { name: 'Navigation principale' });
      await expect(sideNav.getByRole('button')).toHaveText(['Accueil', 'Actualiser les soldes', 'Comptes', 'Pilotage', 'Analyses', 'Impôts', 'Paramètres']);
      expect(await sideNav.evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
      for (const name of ['Demander à Pécule', 'Paramètres', 'Déconnexion']) await expect(aside.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
      // Molette sur le contenu : main défile, la page non ; l'action principale et la déconnexion restent visibles.
      await page.locator('main').hover();
      await page.mouse.wheel(0, 1500);
      await expect.poll(() => page.locator('main').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(aside.getByRole('button', { name: 'Ajouter un mouvement' })).toBeInViewport();
      await expect(aside.getByRole('button', { name: 'Déconnexion' })).toBeInViewport();
    });
  }

  test('le mode discret masque les montants partout, est gardé sur l’appareil et se coupe dans Paramètres', async ({ page }) => {
    await openDemo(page);
    const main = page.locator('main');
    // Désactivé par défaut : les montants sont lisibles.
    await expect(main.getByText('Mon épargne nette').first()).toBeVisible();
    expect(await main.innerText()).not.toContain('••••');

    const eye = page.getByRole('button', { name: 'Masquer les montants' }).filter({ visible: true });
    await expect(eye).toHaveAttribute('aria-pressed', 'false');
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expect(eye).toBeFocused();
    // Plus aucun montant en chiffres sur l'Accueil (« 1 250 € », « 12,5 k€ »).
    const amountInDigits = /\d[\d\s  ,]*\s?k?€/;
    await expect.poll(async () => amountInDigits.test(await main.innerText())).toBe(false);
    await expect(main.getByText(/••••/).first()).toBeVisible();

    // Gardé au rechargement, et appliqué aux autres écrans (Pilotage, graduations des graphiques).
    await page.reload();
    await expect(page.locator('main h2').first()).toBeAttached();
    await expect(page.getByRole('button', { name: 'Masquer les montants' }).filter({ visible: true })).toHaveAttribute('aria-pressed', 'true');
    for (const view of ['pilot', 'history']) {
      await page.goto(`/?demo=1&view=${view}`);
      await screenReady(page);
      await page.waitForTimeout(500); // écran et graphiques chargés à la demande
      expect(amountInDigits.test(await main.innerText()), view).toBe(false);
    }

    // Coupé depuis Paramètres › Affichage : les montants reviennent.
    await page.goto('/?demo=1&view=settings');
    await openDisplayCard(page);
    const toggle = page.getByRole('switch', { name: 'Mode discret' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(page.getByRole('switch', { name: 'Mode discret' })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('switch', { name: 'Mode discret' })).toBeFocused();
    await page.goto('/?demo=1');
    await expect.poll(async () => amountInDigits.test(await main.innerText())).toBe(true);
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

  // Texte agrandi dans les réglages d'Android (jusqu'à 200 %, html { font-size: 200% }) : rien ne
  // doit sortir de l'écran de 412 px, ni la barre du bas, ni l'en-tête, ni le choix du mouvement.
  for (const [scale, size] of [['normal', '100%'], ['agrandi à 200 %', '200%']] as const) {
    test(`sur téléphone (412 px), texte ${scale} : barre du bas, en-tête et mouvement rapide tiennent sans défilement horizontal`, async ({ page, isMobile }) => {
      test.skip(!isMobile, 'écran de téléphone seulement');
      await page.setViewportSize({ width: 412, height: 915 });
      await page.addInitScript(f => { try { localStorage.setItem('last_seen_version', f.v); } catch { /* ignoré */ } }, { v: LATEST_VERSION });
      await page.goto('/?demo=1');
      await page.addStyleTag({ content: `html { font-size: ${size} }` });
      await expect(page.locator('main h2').first()).toBeAttached();
      await page.waitForTimeout(1500); // en-tête et bandeaux en place (le libellé de synchronisation arrive après)
      // Éléments dont un bord sort de l'écran (page, barre du bas, bouton du thème).
      const outside = (sel: string) => page.locator(sel).evaluateAll(els => els
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > window.innerWidth + 1); })
        .map(el => `${el.tagName} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}`));
      const pageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

      const nav = page.getByRole('navigation', { name: 'Navigation principale' }).filter({ visible: true });
      await expect(nav).toBeVisible();
      expect(await outside('nav[aria-label="Navigation principale"] button'), 'barre du bas').toEqual([]);
      expect(await outside('header button'), 'en-tête').toEqual([]);
      expect(await pageOverflow(), 'défilement horizontal de la page').toBeLessThanOrEqual(0);
      // Les cinq entrées restent là, avec leur nom.
      await expect(nav.getByRole('button')).toHaveCount(5);

      await page.getByRole('button', { name: 'Ajouter un mouvement' }).filter({ visible: true }).first().click();
      const sheet = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
      await expect(sheet.getByRole('group', { name: 'Type de mouvement' })).toBeVisible();
      const choices = await sheet.getByRole('group', { name: 'Type de mouvement' }).evaluate(el => ({
        outside: Array.from(el.querySelectorAll('button')).filter(b => { const r = b.getBoundingClientRect(); return r.left < -1 || r.right > window.innerWidth + 1; }).length,
        scroll: el.scrollWidth - el.clientWidth,
      }));
      expect(choices, 'choix du mouvement').toEqual({ outside: 0, scroll: 0 });
      expect(await sheet.evaluate(el => el.scrollWidth - el.clientWidth), 'feuille').toBeLessThanOrEqual(0);
    });
  }
});
