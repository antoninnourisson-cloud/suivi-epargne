// « Demander à Pécule » en mode démo (?demo=1) : Gemini simulé avec page.route. Le résumé des
// données part avec la question (sans clé ni identifiant Drive), la conversation suit, et
// elle est effacée à la fermeture. Sans clé (ouvert depuis le panneau « Plus ») : explication
// et lien vers « Clés et services ».
import { test, expect, type Page } from './fixtures';
import { LATEST_VERSION } from '../src/changelog';

const open = async (page: Page, key: string | null) => {
  await page.addInitScript(([v, k]) => {
    try {
      localStorage.setItem('last_seen_version', v as string);
      if (k) localStorage.setItem('gemini_api_key', k);
    } catch { /* ignoré */ }
  }, [LATEST_VERSION, key]);
  await page.goto('/?demo=1&view=dashboard');
};

test.describe('Demander à Pécule (démo)', () => {
  test('suggestion, question de suivi, fenêtre effacée à la fermeture', async ({ page }) => {
    const bodies: string[] = [];
    // Seules les questions comptent (la veille fiscale de la démo interroge aussi Gemini).
    await page.route('https://generativelanguage.googleapis.com/**', route => {
      const body = route.request().postData() ?? '';
      if (!body.includes('"system_instruction"')) return route.abort();
      bodies.push(body);
      const text = bodies.length === 1 ? 'Ce trimestre, vous avez mis de côté 1 234,56 €.' : 'En septembre 2026 : 400,00 €.';
      return route.fulfill({ json: { candidates: [{ content: { parts: [{ text }] } }] } });
    });
    await open(page, 'cle-de-test');
    await page.setViewportSize({ width: 320, height: 720 });

    const entry = page.getByRole('main').getByRole('button', { name: /Demander à Pécule/ });
    await expect(entry).toBeVisible({ timeout: 20_000 });
    await entry.click();
    const sheet = page.getByRole('dialog', { name: 'Demander à Pécule' });
    await expect(sheet.getByText(/ne sont pas un conseil financier/)).toBeVisible();
    // Largeur de 320 px : rien ne déborde.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    // La poignée de la feuille ne touche pas le titre : au moins 6 px d'écart.
    const gap = await sheet.evaluate(el => {
      const bar = el.querySelector('[data-sheet-handle] span')!.getBoundingClientRect();
      const title = el.querySelector('h2')!.getBoundingClientRect();
      return title.top - bar.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(6);

    await sheet.getByRole('button', { name: 'Combien ai-je épargné ce trimestre ?' }).click();
    await expect(sheet.getByText('Ce trimestre, vous avez mis de côté 1 234,56 €.')).toBeVisible();
    const first = JSON.parse(bodies[0]);
    const system: string = first.system_instruction.parts[0].text;
    expect(system).toContain('"comptes"');
    expect(system).toContain('"epargneParMois"');
    expect(bodies[0]).not.toContain('cle-de-test');
    expect(first.tools).toEqual([{ code_execution: {} }]);

    await sheet.getByLabel('Votre question').fill('Et en septembre ?');
    await sheet.getByRole('button', { name: 'Envoyer la question' }).click();
    await expect(sheet.getByText('En septembre 2026 : 400,00 €.')).toBeVisible();
    expect(JSON.parse(bodies[1]).contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);

    await sheet.getByRole('button', { name: 'Fermer' }).click();
    await expect(sheet).toBeHidden();
    await entry.click();
    await expect(sheet.getByRole('button', { name: 'Combien ai-je épargné ce trimestre ?' })).toBeVisible();
    await expect(sheet.getByText('En septembre 2026 : 400,00 €.')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain('400,00');
  });

  test('sans clé Gemini, ouvert depuis le panneau « Plus » : explication et lien vers « Clés et services »', async ({ page }) => {
    let sent = 0;
    await page.route('https://generativelanguage.googleapis.com/**', route => { sent++; return route.abort(); });
    await page.setViewportSize({ width: 375, height: 720 });
    await open(page, null);
    await expect(page.getByRole('main').getByRole('button', { name: /Demander à Pécule/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name: 'Plus' }).click();
    await page.getByRole('dialog', { name: "Plus d'écrans" }).getByRole('button', { name: 'Demander à Pécule' }).click();
    const sheet = page.getByRole('dialog', { name: 'Demander à Pécule' });
    await expect(sheet.getByText(/rubrique « Clés et services »/)).toBeVisible();
    await sheet.getByRole('button', { name: /Ajouter ma clé Gemini/ }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Paramètres', level: 2 })).toBeVisible({ timeout: 20_000 });
    expect(sent).toBe(0);
  });
});
