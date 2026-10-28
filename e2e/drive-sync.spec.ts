// Le vrai chemin de synchronisation, sans le mode démo, contre un faux Drive (e2e/fakeDrive.ts) :
// les écrans qui décident du sort des données (Réessayer, conflit, sauvegarde locale, hors
// ligne, session expirée) sont affichés et leurs choix vérifiés côté « Drive ».
// Après un chargement, l'app peut écrire d'elle-même (point mensuel de l'historique) : les
// vérifications portent donc sur ce qui est écrit (montant du LDDS), pas sur le nombre d'écritures.
import { test, expect, type Page } from './fixtures';
import { DEMO_DATA } from '../src/dev/demoData';
import { installFakeDrive, addLddsDeposit, lddsOf, withLdds, FILE_ID } from './fakeDrive';

const home = (page: Page) => page.getByRole('heading', { name: 'Accueil', level: 2 });
// La sauvegarde automatique part ~2 s après une saisie.
const SAVE_WAIT_MS = 3_500;
const lddsWritten = (writes: unknown[]) => writes.map(lddsOf);

test.describe('Synchronisation avec Drive (faux Drive)', () => {
  test('lecture en échec (503) : message, « Réessayer » recharge, jamais un document vide écrit', async ({ page }) => {
    const drive = await installFakeDrive(page);
    drive.failStatus = 503;
    await page.goto('/');
    const alert = page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Réessayer' }) });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_000);
    expect(drive.writes).toEqual([]); // rien tant que le chargement n'a pas réussi

    drive.failStatus = 0;
    await alert.getByRole('button', { name: 'Réessayer' }).click();
    await expect(alert).toBeHidden();
    await expect(home(page)).toBeAttached();
    await page.waitForTimeout(SAVE_WAIT_MS);
    // Ce qui part ensuite, ce sont les données de Drive (point mensuel éventuel), jamais un fichier vidé.
    for (const w of drive.writes) expect((w as { accounts: unknown[] }).accounts).toHaveLength(DEMO_DATA.accounts.length);
    expect(lddsOf(drive.content)).toBe(3000);
  });

  test('une saisie part sur Drive, avec contrôle de révision', async ({ page }) => {
    const drive = await installFakeDrive(page);
    await page.goto('/');
    await expect(home(page)).toBeAttached({ timeout: 20_000 });
    await addLddsDeposit(page, 100);
    await expect.poll(() => lddsOf(drive.content), { timeout: 15_000 }).toBe(3100);
  });

  test('autre appareil entre-temps : rien n’est écrasé ; « Garder la version de cet appareil » réécrit la mienne', async ({ page }) => {
    const drive = await installFakeDrive(page);
    await page.goto('/');
    await expect(home(page)).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(SAVE_WAIT_MS);
    drive.remoteWrite(withLdds(5000)); // l'autre appareil
    await addLddsDeposit(page, 100);

    const dialog = page.getByRole('dialog', { name: 'Vos données ont changé sur un autre appareil' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    expect(lddsOf(drive.content)).toBe(5000);
    expect(lddsWritten(drive.writes)).not.toContain(3100);

    await dialog.getByRole('button', { name: 'Garder la version de cet appareil' }).click();
    await dialog.getByLabel('Confirmer votre choix').getByRole('button', { name: 'Garder la version de cet appareil' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => lddsOf(drive.content), { timeout: 15_000 }).toBe(3100);
  });

  test('autre appareil entre-temps : « Garder la version de Drive » l’affiche, ma saisie n’est jamais écrite', async ({ page }) => {
    const drive = await installFakeDrive(page);
    await page.goto('/');
    await expect(home(page)).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(SAVE_WAIT_MS);
    drive.remoteWrite(withLdds(5000));
    await addLddsDeposit(page, 100);

    const dialog = page.getByRole('dialog', { name: 'Vos données ont changé sur un autre appareil' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Garder la version de Drive' }).click();
    await dialog.getByLabel('Confirmer votre choix').getByRole('button', { name: 'Garder la version de Drive' }).click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(SAVE_WAIT_MS);
    expect(lddsWritten(drive.writes)).not.toContain(3100);
    expect(lddsOf(drive.content)).toBe(5000);

    // La saisie suivante part de la version de Drive (5 000 €), avec contrôle.
    await addLddsDeposit(page, 1);
    await expect.poll(() => lddsOf(drive.content), { timeout: 15_000 }).toBe(5001);
  });

  test.describe('sauvegarde locale jamais envoyée, trouvée au démarrage', () => {
    const pending = JSON.stringify({ savedAt: '2026-10-18T20:00:00.000Z', fileId: FILE_ID, data: withLdds(3999) });

    test('« Restaurer cette sauvegarde » la remet à l’écran puis l’envoie', async ({ page }) => {
      const drive = await installFakeDrive(page, DEMO_DATA, { localStorage: { suivi_epargne_pending: pending } });
      await page.goto('/');
      const restore = page.getByRole('button', { name: 'Restaurer cette sauvegarde' });
      await expect(restore).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(SAVE_WAIT_MS);
      expect(lddsWritten(drive.writes)).not.toContain(3999); // rien sans le choix de l'utilisateur
      await restore.click();
      await expect(restore).toBeHidden();
      await expect.poll(() => lddsOf(drive.content), { timeout: 15_000 }).toBe(3999);
    });

    test('« Ignorer » l’efface sans rien envoyer', async ({ page }) => {
      const drive = await installFakeDrive(page, DEMO_DATA, { localStorage: { suivi_epargne_pending: pending } });
      await page.goto('/');
      const banner = page.getByText(/n'a jamais été synchronisée avec Drive/).locator('xpath=..');
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await banner.getByRole('button', { name: 'Ignorer' }).click();
      await expect(banner).toBeHidden();
      await page.waitForTimeout(SAVE_WAIT_MS);
      expect(lddsWritten(drive.writes)).not.toContain(3999);
      expect(lddsOf(drive.content)).toBe(3000);
      expect(await page.evaluate(() => localStorage.getItem('suivi_epargne_pending'))).toBeNull();
    });
  });

  test('hors ligne : la saisie reste sur l’appareil, puis part au retour du réseau', async ({ page, context }) => {
    const drive = await installFakeDrive(page);
    await page.goto('/');
    await expect(home(page)).toBeAttached({ timeout: 20_000 });
    // Fenêtre de saisie ouverte avant la coupure (sans service worker, son code ne se
    // chargerait plus hors ligne).
    await page.getByRole('button', { name: 'Ajouter un mouvement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ajouter un mouvement' });
    await expect(dialog).toBeVisible();
    await context.setOffline(true);
    await dialog.getByLabel('Compte').selectOption({ label: 'LDDS' });
    await dialog.getByLabel('Montant').fill('100');
    await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(dialog).toBeHidden();
    // Indicateur de synchronisation (barre latérale sur ordinateur, en-tête sur mobile).
    await expect(page.getByText('Hors ligne', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(SAVE_WAIT_MS);
    expect(lddsWritten(drive.writes)).not.toContain(3100);

    await context.setOffline(false);
    await expect.poll(() => lddsOf(drive.content), { timeout: 20_000 }).toBe(3100);
  });

  test('réseau coupé pendant un envoi arrivé sur Drive : pas de faux conflit, la saisie suivante part', async ({ page }) => {
    const drive = await installFakeDrive(page);
    await page.goto('/');
    await expect(home(page)).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(SAVE_WAIT_MS); // point mensuel éventuel, envoyé normalement
    // Le prochain envoi arrive sur Drive, mais sa réponse se perd.
    let lost = false;
    await page.route(/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\//, route => {
      const req = route.request();
      if (lost || req.method() !== 'PATCH' || !req.url().includes(FILE_ID)) return route.fallback();
      lost = true;
      const content: unknown = JSON.parse(req.postData() ?? 'null');
      drive.writes.push(content);
      drive.remoteWrite(content);
      return route.abort('internetdisconnected');
    });
    await addLddsDeposit(page, 100);
    await expect.poll(() => lost, { timeout: 15_000 }).toBe(true);
    expect(lddsOf(drive.content)).toBe(3100);
    await addLddsDeposit(page, 50);
    await expect.poll(() => lddsOf(drive.content), { timeout: 20_000 }).toBe(3150);
    await expect(page.getByRole('dialog', { name: 'Vos données ont changé sur un autre appareil' })).toHaveCount(0);
  });

  test('session expirée : bandeau « Se reconnecter », plus aucune écriture, saisie gardée', async ({ page, isMobile }) => {
    const drive = await installFakeDrive(page);
    await page.goto('/');
    await expect(home(page)).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(SAVE_WAIT_MS);
    drive.sessionRevoked = true;
    await addLddsDeposit(page, 100);
    const alert = page.getByRole('alert').filter({ hasText: 'Votre session Google a expiré' });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert.getByRole('button', { name: 'Se reconnecter' })).toBeVisible();
    // L'indicateur de synchronisation le dit aussi (pas de « Sur Drive à … » en vert).
    const indicator = isMobile ? page.getByRole('banner') : page.locator('aside');
    await expect(indicator.getByText(isMobile ? 'Reconnexion' : 'Reconnexion requise', { exact: true })).toBeVisible();
    await expect(indicator.getByText(/Sur Drive à|Synchronisé/)).toHaveCount(0);
    await page.waitForTimeout(SAVE_WAIT_MS);
    expect(lddsWritten(drive.writes)).not.toContain(3100);
    // La saisie reste sur l'appareil (copie locale), prête à partir après reconnexion.
    expect(await page.evaluate(() => localStorage.getItem('suivi_epargne_backup'))).not.toBeNull();
  });
});
