// Verrou de l'appareil en mode démo (?demo=1) : code PIN défini dans Paramètres, écran de
// verrouillage accessible (touches nommées, refus annoncé, clavier physique), et « Code
// oublié » : une demande, annulée par le bon code, puis 24 heures plus tard un retrait qui
// ferme la session au lieu de déverrouiller. Puis le délai avant verrouillage, le verrou posé
// par-dessus l'app (saisie retrouvée, arrière-plan inerte) et le choix de fichier sans verrou.
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const PIN = '246813';

/** Passage en arrière-plan ou retour, tels que la page les voit (visibilitychange). */
const setVisibility = (page: Page, state: 'hidden' | 'visible') => page.evaluate(s => {
  Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
  Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);

/** Avance les deux horloges lues par le verrou (sans minuterie : le temps passé dehors). */
const elapse = (page: Page, ms: number) => page.evaluate(off => {
  const now = Date.now.bind(Date);
  Date.now = () => now() + off;
  const perf = performance.now.bind(performance);
  performance.now = () => perf() + off;
}, ms);

const typePin = async (page: Page) => {
  for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
};

/** Code défini dans Paramètres, puis délai choisi ; l'app reste ouverte (pas de verrou). */
const setUpPin = async (page: Page, delay: string) => {
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
  await page.goto('/?demo=1&view=settings&section=lock');
  const card = page.locator('main').getByRole('region', { name: "Verrou de l'appareil", exact: true });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('switch', { name: 'Code PIN' }).click();
  await card.getByLabel('Nouveau code PIN').fill(PIN);
  await card.getByRole('button', { name: 'Définir' }).click();
  await expect(card.getByLabel('Nouveau code PIN')).toBeHidden();
  const select = card.getByLabel('Verrouiller');
  await expect(select).toHaveValue(String(5 * 60_000));
  await select.selectOption({ label: delay });
};

test.describe('Verrou de l\'appareil (démo)', () => {
  test('code PIN : verrou accessible, refus annoncé, « Code oublié » ne déverrouille pas', async ({ page }) => {
    // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
    await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);

    // 1. Définir un code dans Paramètres.
    await page.goto('/?demo=1&view=settings&section=lock');
    const card = page.locator('main').getByRole('region', { name: 'Verrou de l\'appareil', exact: true });
    // Écran chargé à la demande : le serveur de dev le compile à la première ouverture.
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole('switch', { name: 'Code PIN' }).click();
    await card.getByLabel('Nouveau code PIN').fill('246813');
    await card.getByRole('button', { name: 'Définir' }).click();
    // Enregistré (dérivation du code terminée) : le champ disparaît, le résumé change.
    await expect(card.getByLabel('Nouveau code PIN')).toBeHidden();
    await expect(page.locator('main').getByRole('button', { name: 'Verrou de l\'appareil', exact: true })).toHaveAccessibleDescription(/Code PIN activé/);

    // 2. À la réouverture, l'app est verrouillée.
    await page.goto('/?demo=1');
    const lockScreen = page.getByRole('main', { name: 'Pécule verrouillé' });
    await expect(lockScreen).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pécule verrouillé' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Effacer le dernier chiffre' })).toBeVisible();
    await expect(page.getByRole('group', { name: /Code PIN/ })).toBeVisible();

    // 3. Mauvais code tapé au clavier physique : refus annoncé.
    await page.keyboard.type('111111');
    await expect(page.getByText('6 chiffres saisis.')).toBeAttached();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Code incorrect');

    // 4. « Code oublié » : une demande seulement, le verrou reste en place.
    await page.getByRole('button', { name: 'Code oublié ou biométrie indisponible ?' }).click();
    await expect(page.getByRole('heading', { name: 'Code oublié ou biométrie indisponible' })).toBeFocused();
    await expect(page.getByText(/Il sera possible dans 24 heures/)).toBeVisible();
    await page.getByRole('button', { name: 'Demander le retrait' }).click();
    await expect(page.getByRole('heading', { name: 'Retrait du verrou demandé' })).toBeFocused();
    await expect(page.getByText(/Le retrait sera possible à partir du/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retirer le verrou' })).toHaveCount(0);

    // 5. Le bon code annule la demande, et le propriétaire en est averti.
    for (const d of '246813') await page.getByRole('button', { name: d, exact: true }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByText(/vient d'être annulée/)).toBeVisible();
    await page.reload();
    await expect(lockScreen).toBeVisible();
    await expect(page.getByText('Retrait du verrou demandé')).toHaveCount(0);

    // 6. Demande faite il y a plus de 24 heures : retrait possible, qui ferme la session au
    //    lieu de déverrouiller. Aucune donnée affichée ensuite.
    await page.evaluate(() => localStorage.setItem('app_lock_reset_requested', new Date(Date.now() - 25 * 3600_000).toISOString()));
    await page.reload();
    await expect(page.getByText(/Vous pouvez maintenant retirer le verrou/)).toBeVisible();
    await page.getByRole('button', { name: 'Retirer le verrou' }).click();
    await expect(page.getByRole('heading', { name: 'Retirer le verrou' })).toBeFocused();
    await expect(page.getByText(/choisir votre compte et redonner votre accord/)).toBeVisible();
    await page.getByRole('button', { name: 'Me déconnecter' }).click();
    await expect(page.getByRole('button', { name: 'Continuer avec Google' })).toBeVisible();
    await expect(page.getByText('Réinitialisation du verrou')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();

    // 7. Code retrouvé : le verrou revient tel quel, et le bon code l'ouvre (la session, elle,
    //    reste fermée : il faut se reconnecter).
    await page.getByRole('button', { name: 'J\'ai retrouvé mon code' }).click();
    await expect(lockScreen).toBeVisible();
    for (const d of '246813') await page.getByRole('button', { name: d, exact: true }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Continuer avec Google' })).toBeVisible();
    await expect(page.getByText('Réinitialisation du verrou')).toHaveCount(0);
  });

  test('délai, verrou par-dessus l’app (saisie gardée, arrière-plan inerte), choix de fichier, ouverture verrouillée', async ({ page }) => {
    await setUpPin(page, 'Après 1 minute');
    const lockScreen = page.getByRole('main', { name: 'Pécule verrouillé' });

    // 1. Aller-retour court : pas de verrou.
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await expect(lockScreen).toHaveCount(0);

    // 2. Saisie commencée dans l'ajout rapide (depuis l'Accueil), puis absence plus longue que le délai.
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Accueil', exact: true }).click();
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await dialog.getByLabel('Montant').fill('42');
    await setVisibility(page, 'hidden');
    await elapse(page, 2 * 60_000);
    await setVisibility(page, 'visible');
    await expect(lockScreen).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pécule verrouillé' })).toBeFocused();

    // L'app est toujours là, derrière, mais inerte et masquée : rien n'est atteignable.
    await expect(page.locator('[inert] [role="dialog"][aria-label="Ajouter un mouvement"]')).toBeAttached();
    await expect(dialog).toHaveCount(0);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-app-lock]'))).toBe(true);
    }
    // Échap sur le verrou ne ferme pas la fenêtre restée derrière.
    await page.keyboard.press('Escape');

    // 3. Déverrouillé : la saisie est retrouvée telle quelle.
    await typePin(page);
    await expect(lockScreen).toHaveCount(0);
    await expect(dialog.getByLabel('Montant')).toHaveValue('42');

    // 4. « Immédiatement » : un choix de fichier lancé par l'app ne verrouille pas.
    await page.goto('/?demo=1&view=settings&section=lock');
    await expect(lockScreen).toBeVisible();
    await typePin(page);
    const card = page.locator('main').getByRole('region', { name: "Verrou de l'appareil", exact: true });
    await card.getByLabel('Verrouiller').selectOption({ label: 'Immédiatement' });
    await page.locator('main').getByRole('button', { name: 'Sauvegardes et données', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('main').getByText('Importer un fichier').click();
    await chooser;
    await setVisibility(page, 'hidden');
    await expect(lockScreen).toHaveCount(0);
    await setVisibility(page, 'visible');
    await expect(lockScreen).toHaveCount(0);
    // Le choix fini, le passage suivant en arrière-plan verrouille aussitôt.
    await setVisibility(page, 'hidden');
    await expect(lockScreen).toBeVisible();

    // 5. Ouverture (rechargement) : verrouillée, sans rien de l'app derrière.
    await page.reload();
    await expect(lockScreen).toBeVisible();
    await expect(page.locator('#contenu')).toHaveCount(0);
  });
});
