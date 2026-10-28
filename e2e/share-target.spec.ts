// « Partager vers Pécule » : fichier reçu par le service worker (simulé ici en le rangeant
// directement dans son cache, comme le fait public/share-sw.js), puis choix dans l'app en
// mode démo : relevé bancaire (lecture fictive) ou fiche de paie (Gemini simulé avec
// page.route). Sur le build (E2E_TARGET=build), le vrai service worker reçoit un POST
// multipart sur `partager`.
import { test, expect, type Page } from './fixtures';
import { E2E_BUILD } from './target';
import { LATEST_VERSION } from '../src/changelog';

type Shared = { name: string; type: string; body: string };

// Même rangement que public/share-sw.js : une page du site est ouverte pour accéder à son cache.
const seedSharedFile = async (page: Page, file: Shared) => {
  await page.goto('/presentation.html');
  await page.evaluate(async f => {
    const cache = await caches.open('pecule-partage');
    await cache.put(new URL('partage/fichier', location.href).href, new Response(f.body, {
      headers: { 'Content-Type': f.type, 'X-Pecule-Nom': encodeURIComponent(f.name), 'X-Pecule-Recu': String(Date.now()) },
    }));
  }, file);
};
const sharedCount = (page: Page) => page.evaluate(async () => (await (await caches.open('pecule-partage')).keys()).length);

test.beforeEach(async ({ page }) => {
  // « Quoi de neuf » déjà vu : la modale ne masque pas l'écran.
  await page.addInitScript(v => { try { localStorage.setItem('last_seen_version', v); } catch { /* ignoré */ } }, LATEST_VERSION);
});

test.describe('Partager vers Pécule (démo)', () => {
  test('relevé bancaire : choix, relecture, import ; fichier effacé et adresse nettoyée', async ({ page }) => {
    await seedSharedFile(page, { name: 'releve.pdf', type: 'application/pdf', body: '%PDF-1.4 relevé fictif' });
    await page.goto('/?demo=1&partage=1');
    const sheet = page.getByRole('dialog', { name: 'Que voulez-vous importer ?' });
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByText('releve.pdf')).toBeVisible();
    await expect(page).not.toHaveURL(/partage=/);
    expect(await sharedCount(page)).toBe(0);

    await sheet.getByRole('button', { name: /Relevé bancaire/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Lire un relevé' });
    await expect(dialog.getByRole('heading', { name: 'Relecture du relevé' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Importer' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: /d'après le relevé/ })).toBeVisible();
  });

  test('fiche de paie : lue par Gemini (simulé), enregistrée sans lien Drive', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('gemini_api_key', 'cle-de-test'); } catch { /* ignoré */ } });
    // Seul l'envoi du document compte (la veille fiscale de la démo interroge aussi Gemini).
    let sentToGemini = 0;
    await page.route('https://generativelanguage.googleapis.com/**', route => {
      if (!route.request().postData()?.includes('JVBERi0x')) return route.abort();
      sentToGemini++;
      return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ employer: 'Entreprise Partage', period: '2026-09', grossAmount: 3000, netPaid: 2345.67 }) }] } }] } });
    });
    await seedSharedFile(page, { name: 'Bulletin partagé.pdf', type: 'application/pdf', body: '%PDF-1.4 fiche fictive' });
    await page.goto('/?demo=1&partage=1');
    const sheet = page.getByRole('dialog', { name: 'Que voulez-vous importer ?' });
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    expect(sentToGemini).toBe(0);
    await sheet.getByRole('button', { name: /Fiche de paie/ }).click();

    await expect(page.getByRole('heading', { name: 'Fiches de paie', level: 2 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Bulletin partagé.pdf' })).toBeVisible();
    await expect(page.getByText(/pas copiée sur votre Drive/)).toBeVisible();
    const driveLinks = await page.getByRole('link', { name: /sur Drive/ }).count();
    await page.getByRole('button', { name: "Analyser avec l'IA" }).click();
    await expect(page.getByLabel('Employeur')).toHaveValue('Entreprise Partage');
    expect(sentToGemini).toBeGreaterThan(0);
    await page.getByRole('button', { name: /Enregistrer la fiche/ }).click();
    await expect(page.getByText('Entreprise Partage', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /sur Drive/ })).toHaveCount(driveLinks);
  });

  test('« Annuler » : rien n’est importé, le fichier est effacé', async ({ page }) => {
    await seedSharedFile(page, { name: 'avis.pdf', type: 'application/pdf', body: '%PDF' });
    await page.goto('/?demo=1&partage=1');
    const sheet = page.getByRole('dialog', { name: 'Que voulez-vous importer ?' });
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await sheet.getByRole('button', { name: 'Annuler' }).click();
    await expect(sheet).toBeHidden();
    expect(await sharedCount(page)).toBe(0);
    await expect(page).not.toHaveURL(/partage=/);
  });
});

test.describe('Partager vers Pécule (service worker du build)', () => {
  test.skip(!E2E_BUILD, 'Le service worker n’existe que dans le build.');
  test.use({ serviceWorkers: 'allow' });

  test('POST multipart sur « partager » : fichier rangé, redirection, puis choix dans l’app', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 20_000 }).toBe('activated');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);

    const post = (name: string, type: string) => page.evaluate(async f => {
      const form = new FormData();
      form.append('fichiers', new File(['%PDF-1.4'], f.name, { type: f.type }));
      const r = await fetch('./partager', { method: 'POST', body: form, redirect: 'manual' });
      const followed = await fetch('./partager', { method: 'POST', body: form });
      return { type: r.type, url: followed.url };
    }, { name, type });

    const refused = await post('notes.txt', 'text/plain');
    expect(refused.type).toBe('opaqueredirect');
    expect(refused.url).toMatch(/\?partage=type$/);
    expect(await sharedCount(page)).toBe(0);

    const ok = await post('Fiche partagée.pdf', 'application/pdf');
    expect(ok.url).toMatch(/\?partage=1$/);
    expect(await sharedCount(page)).toBe(1);

    await page.goto('/?demo=1&partage=1');
    const sheet = page.getByRole('dialog', { name: 'Que voulez-vous importer ?' });
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByText('Fiche partagée.pdf')).toBeVisible();
    expect(await sharedCount(page)).toBe(0);
  });
});
