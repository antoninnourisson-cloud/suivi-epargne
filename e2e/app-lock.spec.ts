// Verrou de l'appareil en mode démo (?demo=1) : code PIN défini dans Paramètres, écran de
// verrouillage accessible (touches nommées, refus annoncé, clavier physique), et « Code
// oublié » : une demande, annulée par le bon code, puis 24 heures plus tard un retrait qui
// ferme la session au lieu de déverrouiller.
import { test, expect } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

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
});
