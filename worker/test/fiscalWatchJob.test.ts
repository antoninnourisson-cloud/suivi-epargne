// Veille fiscale du serveur (Workers AI) : lecture des réponses, ancrage dans le texte des
// pages, budget, stockage, routes et cron. Workers AI est simulé par des réponses enregistrées
// « comme celles du modèle » (objet décodé, texte entouré de ```json, texte bavard, erreurs).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker, { Env } from '../src/index';
import { createSession } from '../src/sessions';
import { MemoryKV } from './kvFake';
import { FISCAL_SOURCE_URLS, FiscalSource } from '../src/fiscalSources';
import {
  AiRunner, runFiscalWatch, runAndStoreFiscalWatch, parseModelJson, numbersInText, validatePageValues, PAGE_FIELDS, pageId,
  FISCAL_AI_MODEL, FISCAL_WATCH_BUDGET, FISCAL_WATCH_CRON, LATEST_KEY, FAILURE_KEY, ATTEMPT_KEY, estimateCallNeurons, buildPagePrompt,
} from '../src/fiscalWatchJob';
import { diffFiscalWatch, FiscalWatchResult } from '../../src/lib/fiscalWatch';
import { DEFAULT_FISCAL_CONFIG } from '../../src/constants';
import { AccountType } from '../../src/types';

// Extraits des pages réelles (service-public.gouv.fr, octobre 2026), avec leurs pièges :
// anciens taux, exemples de calcul, règles d'autres dates, outre-mer.
const PAGES: Record<string, string> = {
  F2365: "Quel est le plafond de dépôt sur un livret A ?\n Le montant maximum d'épargne inscrit sur le livret A est de 22 950 € .\n le plafond est porté à 100 000 € .\n Le montant minimum qu'il est possible de retirer du livret A est de 1,5 € .\n Quel est le taux de rémunération du livret A ?\n Le taux d'intérêt annuel du livret A est de 1,7 % .",
  F2368: "Quel est le plafond du LDDS ?\n Le plafond du LDDS est de 12 000 € .\n Le taux d'intérêt annuel est de 1,7 %",
  F2367: "Tableau - LEP éligibilité 2026 - Métropole\n Plafond de RFR\n 1\n 23 028 €\n 1,25\n 26 103 €\n Pour chaque demi-part supplémentaire\n 6 149 €\n Pour quart de part\n 3 075 €\n Le plafond des versements sur le LEP est fixé à 10 000 € .\n Taux actuel\n Le taux d'intérêt du LEP est de 2,50 % .\n Anciens taux\n Du 1 er août 2025 au 31 janvier 2026\n 2,7 %",
  F1419: "Par exemple, le barème de 2026 (applicable aux revenus de 2025) est fixé par la loi de finances pour 2026.\n Tableau - Barème progressif applicable aux revenus de 2025\n Jusqu'à 11 600 €\n 0 %\n De 11 601 € à 29 579 €\n 11 %\n De 29 580 € à 84 577 €\n 30 %\n De 84 578 € à 181 917 €\n 41 %\n Plus de 181 917 €\n 45 %\n De 29 580 € à 30 000 € : ( 30 000 € - 29 579 € ) x 30 % = 421 € × 30 % = 126,30 € .",
  F34328: "Vous êtes célibataire\n Vous bénéficiez d'une décote si le montant brut de votre impôt sur le revenu ne dépasse pas 1 982 € .\nVous êtes en couple soumis à imposition commune\n Vous bénéficiez d'une décote si le montant brut de votre impôt sur le revenu ne dépasse pas 3 277 € .\n La décote est égale à la différence entre 897 € et 45,25 % du montant de votre impôt.",
  F1989: "La déduction forfaitaire est au moins de 509 € pour chaque membre du foyer fiscal.\n Son maximum est de 14 555 € pour chaque membre du foyer.",
  F426: "Dons effectués avant le 14 octobre 2025\nDons jusqu'à 1 000 €\n Pour les dons effectués jusqu'à 1 000 € , la réduction d'impôt est de 75 % du montant donné.\nDons effectués à partir du 14 octobre 2025\nDons jusqu'à 2 000 €\n Pour les dons effectués jusqu'à 2 000 € , la réduction d'impôt est de 75 % du montant donné.",
  F2329: "Cas général\n Contribution sociale généralisée (CSG)\n 10,6 %\n Contribution au remboursement de la dette sociale (CRDS)\n 0,5 %\n Prélèvement de solidarité\n 7,5 %\n TOTAL\n 18,6 %\nAssurance vie\n CSG\n 9,2 %\n CRDS\n 0,5 %\n Prélèvement de solidarité\n 7,5 %\n TOTAL\n 17,2 %",
};

// Réponses « enregistrées » : formes variées, comme celles qu'un modèle renvoie réellement.
const q = (s: string) => s;
const ANSWERS: Record<string, unknown> = {
  F2365: { values: [
    { field: 'livretARate', value: 1.7, quote: q("Le taux d'intérêt annuel du livret A est de 1,7 % ."), sourceUrl: 'x' },
    { field: 'livretACeiling', value: 22950, quote: q("Le montant maximum d'épargne inscrit sur le livret A est de 22 950 € .") },
  ] },
  F2368: '```json\n{"values":[{"field":"lddsCeiling","value":12000,"quote":"Le plafond du LDDS est de 12 000 € ."}]}\n```',
  F2367: 'Voici les valeurs relevées :\n{"values":[{"field":"lepRate","value":2.5,"quote":"Le taux d\'intérêt du LEP est de 2,50 % ."},{"field":"lepCeiling","value":10000,"quote":"x"},{"field":"lepIncomeCeilingOnePart","value":23028,"quote":"23 028 €"},{"field":"lepPerHalfPart","value":6149,"quote":"6 149 €"},]}',
  F1419: { values: [{ field: 'taxBrackets', limits: [11600, 29579, 84577, 181917], rates: [0, 11, 30, 41, 45], year: 2026, quote: 'Barème progressif applicable aux revenus de 2025' }] },
  F34328: { values: [{ field: 'decoteSingle', value: 897, quote: 'x' }, { field: 'decoteThreshold', value: 1982, quote: 'x' }] },
  F1989: { values: [{ field: 'allowanceMin', value: 509, quote: 'x' }, { field: 'allowanceCap', value: 14555, quote: 'x' }] },
  F426: { values: [{ field: 'donation75Ceiling', value: 2000, quote: 'x' }] },
  F2329: { values: [{ field: 'socialChargesGeneral', value: 18.6, quote: 'x' }, { field: 'socialChargesLifeInsurance', value: 0.172, quote: 'x' }] },
};

const sources = (over: Partial<Record<string, string>> = {}): FiscalSource[] =>
  FISCAL_SOURCE_URLS.map(s => ({ ...s, text: over[pageId(s.url)] ?? PAGES[pageId(s.url)], ok: true }));

const pageOf = (inputs: Record<string, unknown>) => {
  const sys = (inputs.messages as { content: string }[])[0].content;
  return /vosdroits\/(F\d+)/.exec(sys)![1];
};

/** Workers AI simulé : `answer(page, withSchema)` rend la réponse, ou lève une erreur. */
const fakeAi = (answer: (page: string, withSchema: boolean) => unknown = p => ANSWERS[p]) => {
  const calls: { model: string; inputs: Record<string, unknown> }[] = [];
  const ai: AiRunner = {
    run: vi.fn(async (model: string, inputs: Record<string, unknown>) => {
      calls.push({ model, inputs });
      return { response: answer(pageOf(inputs), !!inputs.response_format), usage: { prompt_tokens: 1000, completion_tokens: 100 } };
    }),
  };
  return { ai, calls };
};

const NOW = new Date('2026-10-12T05:00:00Z');

describe('lecture de la réponse du modèle', () => {
  it('accepte un objet, un bloc ```json, du texte autour et une virgule finale', () => {
    expect(parseModelJson({ values: [] })).toEqual({ values: [] });
    expect(parseModelJson('```json\n{"values":[1]}\n```')).toEqual({ values: [1] });
    expect(parseModelJson('Voici : {"values":[{"a":"}"}],} merci')).toEqual({ values: [{ a: '}' }] });
    expect(parseModelJson('pas de JSON ici')).toBeNull();
    expect(parseModelJson('{"values": [')).toBeNull();
    expect(parseModelJson(undefined)).toBeNull();
  });
  it('retrouve les nombres écrits à la française', () => {
    const n = numbersInText('22 950 € ; 1,7 % ; 2,50 % ; 181 917 € ; 2026 ; 1,5 € ; 100 000 euros');
    for (const v of [22950, 1.7, 2.5, 181917, 2026]) expect(n.all.has(v)).toBe(true);
    expect([...n.percent].sort()).toEqual([1.7, 2.5]);
    expect([...n.euros].sort((a, b) => a - b)).toEqual([1.5, 22950, 100000, 181917]);
    expect(n.all.has(950)).toBe(false);
  });
});

describe('validation page par page', () => {
  const src = { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2365', text: PAGES.F2365 };
  it('écarte une valeur absente de la page (invention) et un champ non demandé', () => {
    const r = validatePageValues({ values: [
      { field: 'livretARate', value: 1.5, quote: 'x' },
      { field: 'lepRate', value: 2.5, quote: 'x' },
      { field: 'livretACeiling', value: 22950, quote: "Le montant maximum d'épargne inscrit sur le livret A est de 22 950 € ." },
    ] }, src, PAGE_FIELDS.F2365)!;
    expect(Object.keys(r.values)).toEqual(['livretACeiling']);
    expect(r.values.livretACeiling).toMatchObject({ value: 22950, source: src.url, quoteFound: true });
    expect(r.rejected.map(x => x.field)).toEqual(['livretARate', 'lepRate']);
  });
  it('rejette un barème incohérent ou dont un nombre manque', () => {
    const s = { url: 'u', text: PAGES.F1419 };
    expect(validatePageValues({ values: [{ field: 'taxBrackets', limits: [11600, 29579], rates: [0, 11], year: 2026 }] }, s, PAGE_FIELDS.F1419)!.rejected[0].reason).toMatch(/mal formé/);
    expect(validatePageValues({ values: [{ field: 'taxBrackets', limits: [11700, 29579, 84577, 181917], rates: [0, 11, 30, 41, 45] }] }, s, PAGE_FIELDS.F1419)!.rejected[0].reason).toMatch(/11700/);
  });
  it('rend null quand la forme est inutilisable', () => {
    expect(validatePageValues({ foo: 1 }, src, PAGE_FIELDS.F2365)).toBeNull();
    expect(validatePageValues(null, src, PAGE_FIELDS.F2365)).toBeNull();
  });
});

describe('exécution de la veille', () => {
  it('relève toutes les valeurs actuelles, et elles correspondent exactement aux paramètres de l\'app', async () => {
    const { ai, calls } = fakeAi();
    const run = await runFiscalWatch(ai, { now: NOW, sources: sources() });
    expect(run.ok).toBe(true);
    expect(run.model).toBe(FISCAL_AI_MODEL);
    expect(run.sources.every(s => s.status === 'ok')).toBe(true);
    expect(run.values).toMatchObject({
      livretARate: { value: 1.7 }, livretACeiling: { value: 22950 }, lddsCeiling: { value: 12000 },
      lepRate: { value: 2.5 }, lepCeiling: { value: 10000 }, lepIncomeCeilingOnePart: { value: 23028 }, lepPerHalfPart: { value: 6149 },
      decoteSingle: { value: 897 }, decoteThreshold: { value: 1982 }, allowanceMin: { value: 509 }, allowanceCap: { value: 14555 },
      donation75Ceiling: { value: 2000 }, socialChargesGeneral: { value: 0.186 }, socialChargesLifeInsurance: { value: 0.172 },
      taxBrackets: { year: 2026, value: [{ limit: 11600, rate: 0 }, { limit: 29579, rate: 0.11 }, { limit: 84577, rate: 0.3 }, { limit: 181917, rate: 0.41 }, { limit: null, rate: 0.45 }] },
    });
    expect(Object.keys(run.values)).toHaveLength(15);

    // Un appel par page, déterministe, en mode JSON, sans aucune donnée d'utilisateur.
    expect(calls).toHaveLength(FISCAL_SOURCE_URLS.length);
    for (const c of calls) {
      expect(c.model).toBe(FISCAL_AI_MODEL);
      expect(c.inputs.temperature).toBe(0);
      expect((c.inputs.response_format as { type: string }).type).toBe('json_schema');
      const msgs = c.inputs.messages as { role: string; content: string }[];
      expect(msgs.map(m => m.role)).toEqual(['system', 'user']);
      expect(msgs[1].content).toContain(PAGES[pageOf(c.inputs)]);
    }
    expect(run.neuronsUsed).toBeCloseTo(FISCAL_SOURCE_URLS.length * (1000 * 26_668 + 100 * 204_805) / 1e6, 0);

    // Évaluation hors ligne : ce que le serveur rend, passé tel quel à la comparaison de l'app,
    // ne produit AUCUNE proposition quand l'app est à jour.
    const accounts = [
      { id: 'a', type: AccountType.LIVRET_A, interestRate: 1.7, movements: [] },
      { id: 'l', type: AccountType.LEP, interestRate: 2.5, movements: [] },
    ] as never[];
    expect(diffFiscalWatch(run.values as FiscalWatchResult, DEFAULT_FISCAL_CONFIG, accounts)).toEqual([]);
  });

  it('propose bien un changement réel (nouveau plafond publié)', async () => {
    const text = PAGES.F2365.replace('22 950', '23 500');
    const { ai } = fakeAi(p => (p === 'F2365' ? { values: [{ field: 'livretACeiling', value: 23500, quote: 'x' }] } : ANSWERS[p]));
    const run = await runFiscalWatch(ai, { now: NOW, sources: sources({ F2365: text }) });
    const ps = diffFiscalWatch(run.values as FiscalWatchResult, DEFAULT_FISCAL_CONFIG, []);
    expect(ps.map(p => p.key)).toContain('ceiling.livretA');
    expect(ps.find(p => p.key === 'ceiling.livretA')!.source).toContain('F2365');
  });

  it("réessaie sans schéma si le mode JSON échoue, et signale une page illisible sans bloquer les autres", async () => {
    const { ai, calls } = fakeAi((p, withSchema) => {
      if (p === 'F2368') { if (withSchema) throw new Error("JSON Mode couldn't be met"); return ANSWERS.F2368; }
      if (p === 'F426') return 'Je ne peux pas répondre.';
      return ANSWERS[p];
    });
    const run = await runFiscalWatch(ai, { now: NOW, sources: sources() });
    const by = Object.fromEntries(run.sources.map(s => [pageId(s.url), s]));
    expect(by.F2368).toMatchObject({ status: 'ok', retriedWithoutSchema: true, fields: ['lddsCeiling'] });
    expect(by.F426).toMatchObject({ status: 'invalid_json', retriedWithoutSchema: true, fields: [] });
    expect(run.values.donation75Ceiling).toBeUndefined();
    expect(run.values.lddsCeiling).toBeDefined();
    expect(calls).toHaveLength(FISCAL_SOURCE_URLS.length + 2);
  });

  it('signale une page injoignable et une erreur du modèle', async () => {
    const { ai } = fakeAi(p => { if (p === 'F1989') throw new Error('upstream 500'); return ANSWERS[p]; });
    const src = sources().map(s => (pageId(s.url) === 'F426' ? { ...s, ok: false, text: '' } : s));
    const run = await runFiscalWatch(ai, { now: NOW, sources: src });
    const by = Object.fromEntries(run.sources.map(s => [pageId(s.url), s]));
    expect(by.F426.status).toBe('fetch_failed');
    expect(by.F1989).toMatchObject({ status: 'ai_error', error: 'upstream 500' });
    expect(run.ok).toBe(true);
  });

  it('respecte le budget : estimation sous le plafond, pages en trop sautées', async () => {
    const big = 'texte '.repeat(5000); // ~30 000 caractères par page
    const src = sources(Object.fromEntries(Object.keys(PAGES).map(k => [k, `${PAGES[k]}\n${big}`])));
    const { ai, calls } = fakeAi();
    const full = await runFiscalWatch(ai, { now: NOW, sources: src });
    expect(full.neuronsEstimate).toBeLessThanOrEqual(FISCAL_WATCH_BUDGET);
    expect(full.sources.every(s => s.status === 'ok')).toBe(true);

    calls.length = 0;
    const perPage = estimateCallNeurons(buildPagePrompt(src[0], PAGE_FIELDS.F2365, '2026-10-12').length + src[0].text.length + 60);
    const tight = await runFiscalWatch(ai, { now: NOW, sources: src, budget: perPage * 2.5 });
    expect(tight.sources.filter(s => s.status === 'ok')).toHaveLength(2);
    expect(tight.sources.filter(s => s.status === 'skipped_budget')).toHaveLength(FISCAL_SOURCE_URLS.length - 2);
    expect(calls).toHaveLength(2);
    expect(tight.neuronsEstimate).toBeLessThanOrEqual(perPage * 2.5);
  });

  it('pas de réessai quand le budget est épuisé', async () => {
    const { ai, calls } = fakeAi(() => 'illisible');
    const src = sources().slice(0, 1);
    const one = estimateCallNeurons(buildPagePrompt(src[0], PAGE_FIELDS.F2365, '2026-10-12').length + src[0].text.length + 60);
    const run = await runFiscalWatch(ai, { now: NOW, sources: src, budget: one * 1.5 });
    expect(calls).toHaveLength(1);
    expect(run.sources[0].status).toBe('invalid_json');
    expect(run.ok).toBe(false);
  });
});

describe('stockage', () => {
  it('garde le dernier bon résultat ; un échec est rangé à part', async () => {
    const kv = new MemoryKV();
    const pages = FISCAL_SOURCE_URLS.map(s => `<main>${PAGES[pageId(s.url)]}</main>`);
    const fetcher = (async (u: string) => new Response(pages[FISCAL_SOURCE_URLS.findIndex(s => s.url === u)])) as unknown as typeof fetch;
    const ok = await runAndStoreFiscalWatch(kv.asKV(), fakeAi().ai, { now: NOW, fetcher });
    expect(ok.ok).toBe(true);
    expect((await kv.get(LATEST_KEY, 'json')).checkedAt).toBe(NOW.toISOString());
    expect(await kv.get(ATTEMPT_KEY)).toBeTruthy();

    const bad = await runAndStoreFiscalWatch(kv.asKV(), fakeAi(() => 'rien').ai, { now: new Date('2026-10-19T05:00:00Z'), fetcher });
    expect(bad.ok).toBe(false);
    expect((await kv.get(LATEST_KEY, 'json')).checkedAt).toBe(NOW.toISOString());
    expect((await kv.get(FAILURE_KEY, 'json')).ok).toBe(false);
  });
  it('refuse de tourner sans binding AI', async () => {
    await expect(runAndStoreFiscalWatch(new MemoryKV().asKV(), undefined)).rejects.toThrow('AI_BINDING_MISSING');
  });
});

describe('routes /fiscal-watch et cron', () => {
  const ORIGIN = 'https://pecule-app.com';
  let kv: MemoryKV;
  let env: Env;
  let token: string;
  const pages = FISCAL_SOURCE_URLS.map(s => `<main>${PAGES[pageId(s.url)]}</main>`);

  beforeEach(async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response(pages[FISCAL_SOURCE_URLS.findIndex(s => s.url === u)] ?? '', { status: 200 })));
    kv = new MemoryKV();
    env = {
      STORE: kv.asKV(), GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', ENCRYPTION_KEY: 'k',
      VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q', VAPID_SUBJECT: 'https://pecule-app.com/', APP_URL: 'https://pecule-app.com/',
      AI: fakeAi().ai,
    } as Env;
    token = (await createSession(kv.asKV(), 'g-1', 'me@example.com')).token;
  });

  const call = (path: string, method = 'GET', withToken = true) => worker.fetch(new Request(`https://api.example.workers.dev${path}`, {
    method, headers: { Origin: ORIGIN, ...(withToken ? { Authorization: `Bearer ${token}` } : {}) },
  }), env);

  it('exige une session', async () => {
    expect((await call('/fiscal-watch', 'GET', false)).status).toBe(401);
    expect((await call('/fiscal-watch/run', 'POST', false)).status).toBe(401);
    expect(env.AI!.run).not.toHaveBeenCalled();
  });

  it('404 tant que la veille n\'a pas tourné, puis rend le dernier résultat', async () => {
    const before = await call('/fiscal-watch');
    expect(before.status).toBe(404);
    expect(await before.json()).toMatchObject({ error: 'NOT_YET_RUN' });

    const run = await call('/fiscal-watch/run', 'POST');
    expect(run.status).toBe(200);
    const body = await run.json() as { values: Record<string, unknown>; model: string };
    expect(Object.keys(body.values)).toHaveLength(15);

    const after = await call('/fiscal-watch');
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({ model: FISCAL_AI_MODEL, ok: true });
  });

  it('limite les exécutions à la demande (quota gratuit)', async () => {
    expect((await call('/fiscal-watch/run', 'POST')).status).toBe(200);
    const again = await call('/fiscal-watch/run', 'POST');
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ error: 'TOO_SOON', latest: { ok: true } });
    expect(env.AI!.run).toHaveBeenCalledTimes(FISCAL_SOURCE_URLS.length);
  });

  it('503 sans binding AI', async () => {
    env = { ...env, AI: undefined };
    expect((await call('/fiscal-watch/run', 'POST')).status).toBe(503);
  });

  it('le cron du lundi lance la veille, le cron quotidien les rappels', async () => {
    let p: Promise<unknown> = Promise.resolve();
    const ctx = { waitUntil: (x: Promise<unknown>) => { p = x; } } as ExecutionContext;
    await worker.scheduled({ cron: FISCAL_WATCH_CRON } as ScheduledEvent, env, ctx);
    await p;
    expect(await kv.get(LATEST_KEY)).toBeTruthy();
    expect(await kv.get('health:cron')).toBeNull();

    (env.AI!.run as ReturnType<typeof vi.fn>).mockClear();
    await worker.scheduled({ cron: '0 7 * * *' } as ScheduledEvent, env, ctx);
    await p;
    expect(await kv.get('health:cron', 'json')).toMatchObject({ ok: true });
    expect(env.AI!.run).not.toHaveBeenCalled();
  });
});

describe('configuration', () => {
  it('wrangler.toml déclare le binding AI et les deux crons (rappels quotidiens intacts)', async () => {
    const { readFileSync } = await import('node:fs');
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(toml).toMatch(/\[ai\]\s*\nbinding = "AI"/);
    const crons = /crons = (\[.*\])/.exec(toml)![1];
    expect(JSON.parse(crons)).toEqual(['0 7 * * *', FISCAL_WATCH_CRON]);
  });
});
