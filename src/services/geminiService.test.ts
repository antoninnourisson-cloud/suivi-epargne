import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractPayslipData, GeminiError } from './geminiService';

// Réponse Gemini réussie minimale (sortie structurée JSON dans le premier « part »).
const ok = (fields: object) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] } }],
}), { status: 200 });
const fail = (status: number, message = 'x') => new Response(JSON.stringify({ error: { code: status, message } }), { status });
const NO_WAIT = { retryDelaysMs: [0, 0] };

/** Remplace fetch par une suite de réponses, et note le modèle appelé à chaque fois. */
const stubFetch = (responses: Response[]) => {
  const models: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    models.push(/models\/([^:]+):/.exec(url)![1]);
    const next = responses.shift();
    if (!next) throw new Error('plus de réponse prévue');
    return next;
  }));
  return models;
};

afterEach(() => vi.unstubAllGlobals());

describe('extractPayslipData — reprise sur saturation', () => {
  it('réussit après une surcharge passagère, sur le même modèle', async () => {
    const models = stubFetch([fail(503, 'The model is overloaded'), ok({ grossAmount: 3000 })]);
    const r = await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT);
    expect(r.grossAmount).toBe(3000);
    expect(models).toEqual(['gemini-3.6-flash', 'gemini-3.6-flash']);
  });

  it('bascule sur le modèle de repli quand le principal reste saturé', async () => {
    const models = stubFetch([fail(503), fail(503), fail(503), ok({ netPaid: 2400 })]);
    const r = await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT);
    expect(r.netPaid).toBe(2400);
    // 3 essais sur le principal (1 + 2 reprises), puis le premier repli.
    expect(models).toEqual(['gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.8-flash']);
  });

  it('passe directement au modèle suivant si le modèle a été retiré (404)', async () => {
    const models = stubFetch([fail(404, 'model not found'), ok({ grossAmount: 1 })]);
    await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT);
    expect(models).toEqual(['gemini-3.6-flash', 'gemini-3.8-flash']);
  });

  it("signale OVERLOADED quand tous les modèles restent saturés", async () => {
    stubFetch(Array.from({ length: 9 }, () => fail(503)));
    const err = await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT).catch(e => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect(err.code).toBe('OVERLOADED');
  });

  it('ne réessaie PAS une clé refusée : erreur immédiate, code AUTH', async () => {
    const models = stubFetch([fail(403, 'API key not valid')]);
    const err = await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT).catch(e => e);
    expect(err.code).toBe('AUTH');
    expect(models).toHaveLength(1);
  });

  it('ne réessaie pas une requête invalide (400)', async () => {
    const models = stubFetch([fail(400, 'bad request')]);
    await expect(extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT)).rejects.toBeInstanceOf(GeminiError);
    expect(models).toHaveLength(1);
  });

  it('refuse immédiatement sans clé', async () => {
    const err = await extractPayslipData('', 'b64', 'application/pdf').catch(e => e);
    expect(err.code).toBe('AUTH');
  });
});
