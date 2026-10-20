// Build de production, sans le mode démo : ce que verrait une personne qui ouvre Pécule pour
// la première fois. L'écran de connexion s'affiche (le JavaScript se charge et démarre), sans
// violation de la politique de sécurité (CSP) ni erreur, et le service worker s'installe puis
// sert l'app hors ligne. Contre le serveur de développement, seule la première partie a un sens.
import { test, expect } from './fixtures';
import { E2E_BUILD, WORKER_ORIGIN } from './target';
import { LATEST_VERSION } from '../src/changelog';

test.describe('Build publié', () => {
  // Le service worker est justement ce qu'on vérifie ici.
  test.use({ serviceWorkers: 'allow' });

  test('écran de connexion, aucune violation CSP ni erreur, service worker actif hors ligne', async ({ page, context, baseURL }) => {
    // Deux relevés : en ligne, AUCUN problème n'est toléré ; hors ligne, seuls les échecs
    // réseau dus à la coupure le sont.
    const online: string[] = [];
    const offline: string[] = [];
    let problems = online;
    const site = new URL(baseURL ?? 'http://localhost').origin;
    const ownFile = (url: string) => { try { return new URL(url).origin === site; } catch { return false; } };
    page.on('pageerror', e => problems.push(`erreur : ${e.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error' || /Content Security Policy/i.test(msg.text())) problems.push(`console : ${msg.text()}`);
    });
    // Fichiers du site : aucun ne manque (morceau chargé à la demande, police, icône, manifeste).
    page.on('response', r => { if (ownFile(r.url()) && r.status() >= 400) problems.push(`réponse ${r.status()} : ${r.url()}`); });
    page.on('requestfailed', r => { if (ownFile(r.url())) problems.push(`échec : ${r.url()} (${r.failure()?.errorText ?? '?'})`); });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', e => {
        console.error(`Content Security Policy : ${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    // Jamais le vrai serveur depuis les tests : sans session, l'app ne doit d'ailleurs pas l'appeler.
    const workerCalls: string[] = [];
    await page.route(WORKER_ORIGIN, route => { workerCalls.push(route.request().url()); return route.abort(); });
    // Sans serveur (développement), le bouton attend Google Identity Services : remplacé par
    // un faux SDK, pour ne dépendre d'aucun service extérieur.
    await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
      contentType: 'text/javascript',
      body: 'window.google = { accounts: { oauth2: { initTokenClient: () => ({ callback: "", requestAccessToken() {} }), revoke() {} } } };',
    }));
    await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Continuer avec Google' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`version ${LATEST_VERSION}`)).toBeVisible();
    expect(workerCalls).toEqual([]);

    if (E2E_BUILD) {
      // Le service worker s'installe et prend la main (précache de l'app).
      await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 15_000 }).toBe('activated');
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    }
    // En ligne : rien du tout (ni erreur, ni violation CSP, ni fichier manquant).
    expect(online).toEqual([]);

    if (E2E_BUILD) {
      // Hors ligne : l'app s'ouvre quand même, servie par le service worker.
      problems = offline;
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Continuer avec Google' })).toBeVisible({ timeout: 20_000 });
      await context.setOffline(false);
      // Seuls les échecs réseau dus à la coupure sont tolérés (Google Identity Services en mode
      // sans serveur, requêtes hors précache) : toute autre erreur compte.
      expect(offline.filter(p => !/accounts\.google\.com|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(p))).toEqual([]);
    }
  });
});
