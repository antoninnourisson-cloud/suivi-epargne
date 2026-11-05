import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  askGeminiWithSearch, extractAnnualStatement, extractBankStatement, extractPayslipData, extractTaxNotice, GeminiError, PAYSLIP_MAX_AMOUNT,
  sanitizeAnnualStatement, sanitizePayslip, sanitizeTaxNotice, validPayPeriod, validTaxParts,
} from './geminiService';

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

// Réponse avec une partie « réflexion » (modèles qui raisonnent) avant la réponse.
const okParts = (parts: object[]) => new Response(JSON.stringify({ candidates: [{ content: { parts } }] }), { status: 200 });

describe('extractPayslipData — valeurs relues', () => {
  it('écarte NaN, chaînes vides, montants en texte, négatifs ou aberrants, période impossible', async () => {
    stubFetch([ok({
      employer: '  ', period: '2026-13', grossAmount: '2 050,00', socialCharges: -12, netAmount: 1e9,
      netTaxable: null, navigoRefund: 43.255, mealVouchers: 0, netPaid: 2400.5,
    })]);
    const r = await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT);
    expect(r).toEqual({
      employer: undefined, period: undefined, grossAmount: undefined, socialCharges: undefined, netAmount: undefined,
      netTaxable: undefined, navigoRefund: 43.26, mealVouchers: 0, mutuelleCost: undefined, incomeTaxWithheld: undefined, netPaid: 2400.5,
    });
  });

  it('valide la période et les montants ; ignore la réflexion et une clôture Markdown', async () => {
    stubFetch([okParts([{ text: 'je réfléchis', thought: true }, { text: '```json\n{"period":"2026-09","employer":" ACME ","grossAmount":3000}\n```' }])]);
    const r = await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT);
    expect(r).toMatchObject({ period: '2026-09', employer: 'ACME', grossAmount: 3000 });
  });

  it("borne la période : de 2000 à l'an prochain", () => {
    const now = new Date(2026, 9, 22);
    expect(validPayPeriod('2027-01', now)).toBe('2027-01');
    expect(validPayPeriod('2028-01', now)).toBeUndefined();
    expect(validPayPeriod('1999-12', now)).toBeUndefined();
    expect(validPayPeriod('2026-9', now)).toBeUndefined();
    expect(validPayPeriod(202609, now)).toBeUndefined();
    expect(sanitizePayslip({ grossAmount: PAYSLIP_MAX_AMOUNT + 1, netPaid: Number.NaN }, now)).toMatchObject({ grossAmount: undefined, netPaid: undefined });
  });

  it('réponse vide ou illisible : erreur explicite, jamais de valeur inventée', async () => {
    stubFetch([okParts([{ text: 'réflexion seule', thought: true }])]);
    expect((await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT).catch(e => e)).message).toBe('RÉPONSE_GEMINI_VIDE');
    stubFetch([okParts([{ text: 'pas du JSON' }])]);
    expect((await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT).catch(e => e)).message).toBe('RÉPONSE_GEMINI_ILLISIBLE');
    stubFetch([okParts([{ text: '[1, 2]' }])]);
    expect((await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT).catch(e => e)).message).toBe('RÉPONSE_GEMINI_ILLISIBLE');
    stubFetch([new Response('pas du JSON', { status: 200 })]);
    expect((await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT).catch(e => e)).message).toBe('RÉPONSE_GEMINI_VIDE');
  });

  it('réessaie après un délai dépassé, et laisse passer une coupure réseau', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) throw abort;
      return ok({ grossAmount: 1 });
    }));
    expect((await extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT)).grossAmount).toBe(1);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(extractPayslipData('k', 'b64', 'application/pdf', NO_WAIT)).rejects.toBeInstanceOf(TypeError);
  });
});

describe('extractTaxNotice', () => {
  it('relève une réponse valide (réflexion ignorée), avec des délais injectables', async () => {
    const models = stubFetch([fail(503), okParts([{ text: '…', thought: true }, { text: JSON.stringify({ incomeYear: 2025, rfr: 24500.6, parts: 1.5, netTax: 1203.456 }) }])]);
    const r = await extractTaxNotice('k', 'b64', 'application/pdf', NO_WAIT);
    expect(r).toEqual({ incomeYear: 2025, rfr: 24501, parts: 1.5, netTax: 1203.46 });
    expect(models).toHaveLength(2);
  });

  it("valeurs hors bornes : champs vides (elles alimentent l'éligibilité au LEP)", async () => {
    stubFetch([ok({ incomeYear: 2101, rfr: -5, parts: 0.5, netTax: '1 200' })]);
    expect(await extractTaxNotice('k', 'b64', 'application/pdf', NO_WAIT)).toEqual({ incomeYear: undefined, rfr: undefined, parts: undefined, netTax: undefined });
    const now = new Date(2026, 9, 22);
    expect(sanitizeTaxNotice({ incomeYear: 2026 }, now).incomeYear).toBe(2026);
    expect(sanitizeTaxNotice({ incomeYear: 2027 }, now).incomeYear).toBeUndefined();
    expect(sanitizeTaxNotice({ incomeYear: 2025.5 }, now).incomeYear).toBeUndefined();
    expect(sanitizeTaxNotice({ incomeYear: 1999 }, now).incomeYear).toBeUndefined();
    expect(sanitizeTaxNotice({ rfr: 0 }, now).rfr).toBe(0);
    expect(sanitizeTaxNotice({ rfr: 2e8 }, now).rfr).toBeUndefined();
  });

  it('parts : de 1 à 20, par quarts de part', () => {
    expect(validTaxParts(1)).toBe(1);
    expect(validTaxParts(2.75)).toBe(2.75);
    expect(validTaxParts(20)).toBe(20);
    expect(validTaxParts(0.5)).toBeUndefined();
    expect(validTaxParts(1.3)).toBeUndefined();
    expect(validTaxParts(21)).toBeUndefined();
    expect(validTaxParts('2')).toBeUndefined();
  });

  it('erreurs : clé absente, clé refusée, réponse illisible', async () => {
    expect((await extractTaxNotice('', 'b64', 'application/pdf').catch(e => e)).code).toBe('AUTH');
    stubFetch([fail(401)]);
    expect((await extractTaxNotice('k', 'b64', 'application/pdf', NO_WAIT).catch(e => e)).code).toBe('AUTH');
    stubFetch([okParts([{ text: '{' }])]);
    expect((await extractTaxNotice('k', 'b64', 'application/pdf', NO_WAIT).catch(e => e)).message).toBe('RÉPONSE_GEMINI_ILLISIBLE');
  });
});

describe('extractBankStatement', () => {
  it('envoie le document avec le schéma du relevé et filtre la réponse', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return ok({ bank: 'Banque', accounts: [{ name: 'Livret A FR7630006000011234567890189', closingBalance: 100, movements: [{ date: '2026-09-02', amount: 10, direction: 'CREDIT', label: 'VIR' }] }] });
    }));
    const r = await extractBankStatement('k', 'b64', 'application/pdf', NO_WAIT);
    expect(r.accounts[0]).toMatchObject({ name: 'Livret A', closingBalance: 100, movements: [{ date: '2026-09-02', amount: 10, type: 'IN', label: 'VIR' }] });
    const body = JSON.parse(bodies[0]);
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: 'application/pdf', data: 'b64' });
    expect(body.generationConfig.responseSchema.required).toEqual(['accounts']);
  });

  it("document qui n'est pas un relevé : aucun compte", async () => {
    stubFetch([ok({ accounts: [] })]);
    expect((await extractBankStatement('k', 'b64', 'image/png', NO_WAIT)).accounts).toEqual([]);
  });
});

describe('askGeminiWithSearch', () => {
  it('renvoie le texte, avec ou sans recherche, et reprend après une saturation', async () => {
    const bodies: string[] = [];
    const replies = [fail(503), okParts([{ text: 'Réponse' }]), okParts([{ text: 'Sans recherche' }])];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { bodies.push(String(init.body)); return replies.shift()!; }));
    expect(await askGeminiWithSearch('k', 'question', 1000, true, { retryDelaysMs: [0] })).toBe('Réponse');
    expect(JSON.parse(bodies[0]).tools).toEqual([{ google_search: {} }]);
    expect(await askGeminiWithSearch('k', 'question', 1000, false, { retryDelaysMs: [0] })).toBe('Sans recherche');
    expect(JSON.parse(bodies[2]).tools).toBeUndefined();
  });
});

describe('extractTaxNotice : solde de l\'avis', () => {
  const now = new Date(2026, 8, 20);
  it('reste à payer et remboursement, avec date facultative', () => {
    expect(sanitizeTaxNotice({ balanceKind: 'A_PAYER', balanceAmount: 320.456, balanceDate: '2026-12-15' }, now).balance).toEqual({ kind: 'due', amount: 320.46, date: '2026-12-15' });
    expect(sanitizeTaxNotice({ balanceKind: 'REMBOURSEMENT', balanceAmount: 150 }, now).balance).toEqual({ kind: 'refund', amount: 150 });
  });
  it('nature inconnue, montant nul ou négatif, date impossible : solde ou date écartés', () => {
    expect(sanitizeTaxNotice({ balanceKind: 'NUL', balanceAmount: 10 }, now).balance).toBeUndefined();
    expect(sanitizeTaxNotice({ balanceKind: 'A_PAYER', balanceAmount: 0 }, now).balance).toBeUndefined();
    expect(sanitizeTaxNotice({ balanceKind: 'A_PAYER', balanceAmount: -5 }, now).balance).toBeUndefined();
    expect(sanitizeTaxNotice({ balanceKind: 'A_PAYER', balanceAmount: '320' }, now).balance).toBeUndefined();
    expect(sanitizeTaxNotice({ balanceKind: 'A_PAYER', balanceAmount: 5, balanceDate: '2026-02-31' }, now).balance).toEqual({ kind: 'due', amount: 5 });
    expect(sanitizeTaxNotice({ balanceKind: 'A_PAYER', balanceAmount: 5, balanceDate: '1999-01-01' }, now).balance).toEqual({ kind: 'due', amount: 5 });
  });
});

describe('extractAnnualStatement', () => {
  it('succès : valeurs arrondies', async () => {
    stubFetch([ok({ year: 2026, valueAtYearEnd: 5230.456, deposits: 1200, rate: 2.6, interest: 130.5 })]);
    expect(await extractAnnualStatement('k', 'b64', 'application/pdf', NO_WAIT)).toEqual({ year: 2026, valueAtYearEnd: 5230.46, deposits: 1200, rate: 2.6, interest: 130.5 });
  });
  it('réponse incohérente : textes, négatifs et aberrations écartés', () => {
    const r = sanitizeAnnualStatement({ year: 2101, valueAtYearEnd: '5 000', deposits: -3, rate: 450, interest: 1e12 }, new Date(2027, 0, 10));
    expect(r).toEqual({ year: undefined, valueAtYearEnd: undefined, deposits: undefined, rate: undefined, interest: undefined });
  });
  it('échec réseau, clé absente et réponse illisible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(extractAnnualStatement('k', 'b64', 'application/pdf', NO_WAIT)).rejects.toBeInstanceOf(TypeError);
    expect((await extractAnnualStatement('', 'b64', 'application/pdf').catch(e => e)).code).toBe('AUTH');
    stubFetch([okParts([{ text: '{' }])]);
    expect((await extractAnnualStatement('k', 'b64', 'application/pdf', NO_WAIT).catch(e => e)).message).toBe('RÉPONSE_GEMINI_ILLISIBLE');
  });
});
