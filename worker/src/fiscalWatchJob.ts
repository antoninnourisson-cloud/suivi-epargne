// ================================================
// FILE: worker/src/fiscalWatchJob.ts
// Veille fiscale côté serveur, sans la clé Gemini de l'utilisateur : chaque semaine (cron du
// lundi), le Worker relit les pages officielles de service-public.gouv.fr (fiscalSources.ts)
// et fait relever par Cloudflare Workers AI (offre gratuite : 10 000 neurones par jour) les
// seules valeurs dont chaque page traite. Une page = un appel, pour rester loin de la
// fenêtre de contexte du modèle (24 000 jetons).
//
// Garde-fous :
//  - AUCUNE donnée d'utilisateur n'est envoyée : seulement le texte de pages publiques et des
//    noms de champs ;
//  - chaque valeur doit FIGURER dans le texte de la page (nombre retrouvé tel quel), sinon elle
//    est écartée et signalée : le modèle ne peut pas « inventer » un chiffre ;
//  - budget : l'estimation (pire cas) d'une exécution est plafonnée à FISCAL_WATCH_BUDGET
//    neurones ; les pages au-delà sont sautées et signalées ;
//  - le résultat n'est qu'une PROPOSITION : l'app le compare à ses paramètres et l'utilisateur
//    valide chaque changement (src/lib/fiscalWatch.ts, diffFiscalWatch).
// ================================================
import { fetchFiscalSources, FiscalSource } from './fiscalSources';

/** Modèle : le plus solide des modèles Workers AI qui acceptent le mode JSON (json_schema). */
export const FISCAL_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
/** Tarif du modèle en neurones par million de jetons (page « Pricing » de Workers AI). */
const NEURONS_PER_M_INPUT = 26_668;
const NEURONS_PER_M_OUTPUT = 204_805;
/** Plafond d'une exécution (pire cas estimé) : bien en dessous des 10 000 neurones gratuits par jour. */
export const FISCAL_WATCH_BUDGET = 6_000;
/** Texte gardé par page (les pages utiles font 10 000 à 34 000 caractères). */
const MAX_PAGE_CHARS = 36_000;
const MAX_OUTPUT_TOKENS = 700;
/** Fenêtre de contexte du modèle, marge comprise. */
const CONTEXT_TOKENS = 24_000;

export const FISCAL_WATCH_CRON = '0 5 * * 1';
export const LATEST_KEY = 'fiscal-watch:latest';
export const ATTEMPT_KEY = 'fiscal-watch:attempt';
export const FAILURE_KEY = 'fiscal-watch:last-failure';
/** Exécution à la demande : au plus une toutes les 20 h après un succès, 6 h après un échec. */
const MIN_INTERVAL_AFTER_SUCCESS_MS = 20 * 3600_000;
const ATTEMPT_TTL_S = 6 * 3600;

/** Le binding Workers AI (`[ai] binding = "AI"`), réduit à ce qui sert ici. */
export interface AiRunner { run(model: string, inputs: Record<string, unknown>): Promise<unknown> }

type Unit = 'percent' | 'percentAsFraction' | 'euros' | 'brackets';
interface FieldSpec { key: string; unit: Unit; desc: string }

/**
 * Champs relevés page par page. Les noms sont ceux de FiscalWatchResult (src/lib/fiscalWatch.ts) :
 * le résultat se compare donc directement aux paramètres de l'app.
 */
export const PAGE_FIELDS: Record<string, FieldSpec[]> = {
  F2365: [
    { key: 'livretARate', unit: 'percent', desc: "taux d'intérêt annuel du livret A actuellement en vigueur, en %" },
    { key: 'livretACeiling', unit: 'euros', desc: "plafond de dépôt (montant maximum d'épargne) du livret A pour un particulier, en euros" },
  ],
  F2368: [
    { key: 'lddsCeiling', unit: 'euros', desc: 'plafond du LDDS, en euros' },
  ],
  F2367: [
    { key: 'lepRate', unit: 'percent', desc: "taux d'intérêt ACTUEL du LEP, en % (pas un ancien taux)" },
    { key: 'lepCeiling', unit: 'euros', desc: 'plafond des versements sur le LEP, en euros' },
    { key: 'lepIncomeCeilingOnePart', unit: 'euros', desc: 'revenu fiscal de référence à ne pas dépasser pour 1 part, EN MÉTROPOLE, pour une ouverture cette année, en euros' },
    { key: 'lepPerHalfPart', unit: 'euros', desc: 'montant ajouté à ce plafond pour chaque demi-part supplémentaire, EN MÉTROPOLE, en euros' },
  ],
  F1419: [
    { key: 'taxBrackets', unit: 'brackets', desc: "barème progressif le plus récent de l'impôt sur le revenu (une part)" },
  ],
  F34328: [
    { key: 'decoteSingle', unit: 'euros', desc: "montant forfaitaire de la décote pour une personne seule (célibataire) : le X de « X € - 45,25 % du montant de l'impôt », en euros" },
    { key: 'decoteThreshold', unit: 'euros', desc: "montant d'impôt brut à ne pas dépasser pour qu'une personne seule (célibataire) bénéficie de la décote, en euros" },
  ],
  F1989: [
    { key: 'allowanceMin', unit: 'euros', desc: 'montant MINIMUM de la déduction forfaitaire de 10 % pour frais professionnels, par membre du foyer, en euros' },
    { key: 'allowanceCap', unit: 'euros', desc: 'montant MAXIMUM de la déduction forfaitaire de 10 % pour frais professionnels, par membre du foyer, en euros' },
  ],
  F426: [
    { key: 'donation75Ceiling', unit: 'euros', desc: "limite des dons ouvrant droit à la réduction d'impôt de 75 % (organismes d'aide aux personnes en difficulté : repas, soins, logement) pour un don effectué AUJOURD'HUI, en euros" },
  ],
  F2329: [
    { key: 'socialChargesGeneral', unit: 'percentAsFraction', desc: 'taux TOTAL des prélèvements sociaux sur les revenus du patrimoine et de placements, cas général, en %' },
    { key: 'socialChargesLifeInsurance', unit: 'percentAsFraction', desc: "taux TOTAL des prélèvements sociaux sur les produits d'assurance vie, en %" },
  ],
};

export const pageId = (url: string): string => url.split('/').pop() || url;

// ---------- Prompt ----------

export const buildPagePrompt = (source: { url: string; topic: string }, fields: FieldSpec[], today: string): string => {
  const brackets = fields.some(f => f.unit === 'brackets');
  const list = fields.map(f => f.unit === 'brackets'
    ? `- "taxBrackets" : ${f.desc}. Donne "limits" = les bornes HAUTES des tranches dans l'ordre, SANS la dernière tranche (qui n'a pas de borne), en euros ; "rates" = le taux de CHAQUE tranche dans l'ordre, en % (une valeur de plus que "limits") ; "year" = l'année où ce barème s'applique (année des revenus + 1 : « barème de 2026 (applicable aux revenus de 2025) » → 2026).`
    : `- "${f.key}" : ${f.desc}.`).join('\n');
  const example = brackets
    ? `{"values":[{"field":"taxBrackets","limits":[10000,20000,30000,40000],"rates":[0,10,20,30,40],"year":2030,"quote":"…","sourceUrl":"${source.url}"}]}`
    : `{"values":[{"field":"${fields[0].key}","value":1234.5,"quote":"…","sourceUrl":"${source.url}"}]}`;
  return `Tu relèves des valeurs fiscales françaises dans UNE page officielle. Date du jour : ${today}.
Page : ${source.topic} — ${source.url}

Champs à relever (uniquement ceux-ci) :
${list}

Règles :
1. Utilise SEULEMENT le texte de la page fourni par l'utilisateur. N'utilise pas tes connaissances.
2. Prends la valeur EN VIGUEUR AUJOURD'HUI. Ignore les anciens taux, les exemples de calcul, l'outre-mer et les règles valables à d'autres dates.
3. Si un champ n'apparaît pas clairement dans le texte, ne le renvoie pas (liste vide acceptée).
4. Nombres en JSON : point décimal, sans espace, sans symbole. « 12 345 € » → 12345 ; « 2,35 % » → 2.35.
5. "quote" : la ligne EXACTE du texte d'où vient la valeur (200 caractères au plus).
6. "effectiveDate" (facultatif) : date d'effet AAAA-MM-JJ, seulement si le texte l'écrit explicitement pour la valeur actuelle.
Réponds UNIQUEMENT par un objet JSON, sans texte autour, de cette forme (exemple de format, valeurs fictives) :
${example}`;
};

/** Schéma imposé au modèle (mode JSON de Workers AI). */
const pageSchema = (fields: FieldSpec[]): Record<string, unknown> => {
  const brackets = fields.some(f => f.unit === 'brackets');
  const item = brackets
    ? {
      type: 'object',
      properties: {
        field: { type: 'string', enum: ['taxBrackets'] },
        limits: { type: 'array', items: { type: 'number' } },
        rates: { type: 'array', items: { type: 'number' } },
        year: { type: 'integer' },
        quote: { type: 'string' },
        sourceUrl: { type: 'string' },
      },
      required: ['field', 'limits', 'rates', 'year', 'quote'],
    }
    : {
      type: 'object',
      properties: {
        field: { type: 'string', enum: fields.map(f => f.key) },
        value: { type: 'number' },
        effectiveDate: { type: 'string' },
        quote: { type: 'string' },
        sourceUrl: { type: 'string' },
      },
      required: ['field', 'value', 'quote'],
    };
  return { type: 'object', properties: { values: { type: 'array', items: item } }, required: ['values'] };
};

// ---------- Budget ----------

/** Estimation prudente : ~3 caractères par jeton pour du français (la consigne « chars/4 » sous-estime les accents). */
const estimateTokens = (chars: number): number => Math.ceil(chars / 3);
const neuronsFor = (inputTokens: number, outputTokens: number): number =>
  (inputTokens * NEURONS_PER_M_INPUT + outputTokens * NEURONS_PER_M_OUTPUT) / 1_000_000;
/** Pire cas d'un appel : toute l'entrée, et la sortie au maximum autorisé. */
export const estimateCallNeurons = (promptChars: number): number => neuronsFor(estimateTokens(promptChars), MAX_OUTPUT_TOKENS);

// ---------- Lecture de la réponse ----------

/** JSON du modèle : objet déjà décodé, ou texte (avec ou sans ```json, avec du texte autour). `null` si illisible. */
export const parseModelJson = (raw: unknown): unknown => {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  let t = raw.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  try { return JSON.parse(t); } catch { /* on cherche un objet dans le texte */ }
  const start = t.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) {
      try { return JSON.parse(t.slice(start, i + 1).replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
    }
  }
  return null;
};

/**
 * Nombres écrits dans le texte (« 22 950 € » → 22950, « 1,7 % » → 1.7, « 2,50 % » → 2.5) :
 * tous, ceux suivis de « % » et ceux suivis de « € ». Un taux doit être écrit comme un taux,
 * un montant comme un montant : « 1,5 € » ne justifie pas un taux de 1,5 %.
 */
export const numbersInText = (text: string): { all: Set<number>; percent: Set<number>; euros: Set<number> } => {
  const all = new Set<number>(), percent = new Set<number>(), euros = new Set<number>();
  const t = text.replace(/[\u00a0\u202f\u2009]/g, ' ');
  for (const m of t.matchAll(/(\d{1,3}(?: \d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)( ?)(%|€|euros?\b)?/g)) {
    const n = Number(m[1].replace(/ /g, '').replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    const r = Math.round(n * 10_000) / 10_000;
    all.add(r);
    if (m[3] === '%') percent.add(r);
    else if (m[3]) euros.add(r);
  }
  return { all, percent, euros };
};
const has = (nums: Set<number>, v: number) => nums.has(Math.round(v * 10_000) / 10_000);
const unitSet = (n: ReturnType<typeof numbersInText>, unit: Unit) => (unit === 'euros' ? n.euros : n.percent);

export interface WatchedOut { value: unknown; source: string; effectiveDate?: string; quote?: string; quoteFound?: boolean; year?: number }
export type WatchValues = Record<string, WatchedOut>;
export interface Rejected { field: string; reason: string }

const normQuote = (s: string) => s.replace(/[\s  ]+/g, ' ').trim().toLowerCase();

/**
 * Valide les valeurs renvoyées pour UNE page : champ attendu, type, et nombre présent dans le
 * texte de la page. Rend les valeurs acceptées (forme FiscalWatchResult) et les rejets.
 */
export const validatePageValues = (parsed: unknown, source: { url: string; text: string }, fields: FieldSpec[]): { values: WatchValues; rejected: Rejected[] } | null => {
  const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { values?: unknown }).values) ? (parsed as { values: unknown[] }).values : null);
  if (!list) return null;
  const nums = numbersInText(source.text);
  const text = normQuote(source.text);
  const values: WatchValues = {};
  const rejected: Rejected[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const field = String(item.field ?? '');
    const spec = fields.find(f => f.key === field);
    if (!spec) { rejected.push({ field: field || '?', reason: 'champ non demandé pour cette page' }); continue; }
    if (values[field]) { rejected.push({ field, reason: 'valeur en double (la première est gardée)' }); continue; }
    const quote = typeof item.quote === 'string' ? item.quote.slice(0, 200) : undefined;
    const base = { source: source.url, ...(quote ? { quote, quoteFound: text.includes(normQuote(quote)) } : {}) };

    if (spec.unit === 'brackets') {
      const limits = Array.isArray(item.limits) ? item.limits : null;
      const rates = Array.isArray(item.rates) ? item.rates : null;
      const year = typeof item.year === 'number' && Number.isInteger(item.year) ? item.year : undefined;
      if (!limits || !rates || rates.length !== limits.length + 1 || !limits.every(n => typeof n === 'number') || !rates.every(n => typeof n === 'number')) {
        rejected.push({ field, reason: 'barème mal formé' }); continue;
      }
      const missing = [...(limits as number[]).filter(n => !has(nums.euros, n)), ...(rates as number[]).filter(n => !has(nums.percent, n))];
      if (missing.length) { rejected.push({ field, reason: `nombre(s) absent(s) de la page : ${missing.join(', ')}` }); continue; }
      const brackets = (rates as number[]).map((r, i) => ({ limit: i < limits.length ? (limits as number[])[i] : null, rate: r / 100 }));
      values[field] = { value: brackets, ...base, ...(year ? { year } : {}) };
      continue;
    }

    const v = item.value;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) { rejected.push({ field, reason: 'valeur non numérique' }); continue; }
    // Prélèvements sociaux : demandés en % (18.6), rendus en fraction (0.186) comme dans l'app.
    // Une fraction déjà convertie par le modèle est acceptée aussi.
    const asPercent = spec.unit === 'percentAsFraction' && v < 1 ? v * 100 : v;
    if (!has(unitSet(nums, spec.unit), asPercent)) {
      rejected.push({ field, reason: `${asPercent} ${spec.unit === 'euros' ? '€' : '%'} absent de la page` }); continue;
    }
    const value = spec.unit === 'percentAsFraction' ? Math.round(asPercent * 10) / 1000 : asPercent;
    const eff = typeof item.effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.effectiveDate) ? item.effectiveDate : undefined;
    values[field] = { value, ...base, ...(eff ? { effectiveDate: eff } : {}) };
  }
  return { values, rejected };
};

// ---------- Exécution ----------

export type PageStatus = 'ok' | 'fetch_failed' | 'invalid_json' | 'ai_error' | 'skipped_budget' | 'no_fields';
export interface SourceReport {
  url: string; topic: string; status: PageStatus; fields: string[]; rejected: Rejected[];
  neuronsEstimate: number; neuronsUsed?: number; retriedWithoutSchema?: boolean; error?: string;
}
export interface FiscalWatchRun {
  checkedAt: string; model: string; ok: boolean;
  /** Forme FiscalWatchResult (src/lib/fiscalWatch.ts) : à comparer aux paramètres de l'app. */
  values: WatchValues;
  sources: SourceReport[];
  /** Pire cas estimé avant l'exécution, en neurones. */
  neuronsEstimate: number;
  /** D'après les compteurs de jetons renvoyés par Workers AI (quand ils sont fournis). */
  neuronsUsed?: number;
}

interface AiOutput { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } }

const callModel = async (ai: AiRunner, system: string, pageText: string, schema: Record<string, unknown> | null): Promise<AiOutput> => {
  const inputs: Record<string, unknown> = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `=== TEXTE DE LA PAGE ===\n${pageText}\n=== FIN DE LA PAGE ===` },
    ],
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
  };
  if (schema) inputs.response_format = { type: 'json_schema', json_schema: schema };
  return (await ai.run(FISCAL_AI_MODEL, inputs)) as AiOutput;
};

const usedNeurons = (out: AiOutput): number | undefined => {
  const u = out.usage;
  return u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number' ? neuronsFor(u.prompt_tokens, u.completion_tokens) : undefined;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Une exécution complète : lecture des pages, un appel par page dans la limite du budget,
 * validation et fusion. N'écrit rien : voir runAndStoreFiscalWatch.
 */
export const runFiscalWatch = async (
  ai: AiRunner, opts: { now?: Date; fetcher?: typeof fetch; budget?: number; sources?: FiscalSource[] } = {},
): Promise<FiscalWatchRun> => {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const budget = opts.budget ?? FISCAL_WATCH_BUDGET;
  const sources = opts.sources ?? await fetchFiscalSources(opts.fetcher, MAX_PAGE_CHARS);

  // Plan : prompts et estimation pire cas, dans l'ordre de la liste ; au-delà du budget, la page est sautée.
  let planned = 0;
  const plan = sources.map(s => {
    const fields = PAGE_FIELDS[pageId(s.url)] ?? [];
    const text = s.text.slice(0, MAX_PAGE_CHARS);
    const system = fields.length ? buildPagePrompt(s, fields, today) : '';
    const est = fields.length && s.ok ? estimateCallNeurons(system.length + text.length + 60) : 0;
    const fitsContext = estimateTokens(system.length + text.length + 60) + MAX_OUTPUT_TOKENS <= CONTEXT_TOKENS;
    const inBudget = est > 0 && fitsContext && planned + est <= budget;
    if (inBudget) planned += est;
    return { s, fields, text, system, est, inBudget, fitsContext };
  });

  const values: WatchValues = {};
  const reports: SourceReport[] = [];
  let spent = 0;          // estimation pire cas des appels lancés (retries compris)
  let used = 0;           // d'après les compteurs renvoyés
  let usageKnown = true;

  for (const p of plan) {
    const report: SourceReport = { url: p.s.url, topic: p.s.topic, status: 'ok', fields: [], rejected: [], neuronsEstimate: round1(p.est) };
    reports.push(report);
    if (!p.fields.length) { report.status = 'no_fields'; continue; }
    if (!p.s.ok || !p.text) { report.status = 'fetch_failed'; continue; }
    if (!p.inBudget) { report.status = 'skipped_budget'; report.error = p.fitsContext ? undefined : 'page trop longue pour le modèle'; continue; }

    let out: AiOutput | null = null;
    let parsed: unknown = null;
    for (const schema of [pageSchema(p.fields), null]) {
      if (schema === null) {
        // Deuxième essai sans schéma imposé (« JSON Mode couldn't be met », réponse illisible) :
        // seulement si le budget le permet encore.
        if (spent + p.est > budget) break;
        report.retriedWithoutSchema = true;
      }
      spent += p.est;
      try {
        out = await callModel(ai, p.system, p.text, schema);
        const n = usedNeurons(out);
        if (n === undefined) usageKnown = false; else { used += n; report.neuronsUsed = round1((report.neuronsUsed ?? 0) + n); }
        parsed = parseModelJson(out?.response);
        if (validatePageValues(parsed, p.s, p.fields)) { report.error = undefined; break; }
        report.status = 'invalid_json';
        report.error = 'réponse illisible';
      } catch (e) {
        report.status = 'ai_error';
        report.error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      }
    }
    const checked = validatePageValues(parsed, p.s, p.fields);
    if (!checked) {
      if (report.status === 'ok') report.status = 'invalid_json';
      continue;
    }
    report.status = 'ok';
    report.error = undefined;
    report.rejected = checked.rejected;
    for (const [k, v] of Object.entries(checked.values)) {
      if (values[k]) { report.rejected.push({ field: k, reason: 'déjà relevé sur une autre page' }); continue; }
      values[k] = v;
      report.fields.push(k);
    }
  }

  return {
    checkedAt: now.toISOString(),
    model: FISCAL_AI_MODEL,
    ok: Object.keys(values).length > 0,
    values,
    sources: reports,
    neuronsEstimate: round1(planned),
    ...(usageKnown && spent > 0 ? { neuronsUsed: round1(used) } : {}),
  };
};

/**
 * Exécute la veille et la range en KV. Un résultat vide (pages ou modèle indisponibles)
 * n'écrase pas le dernier bon résultat : il est gardé à part, pour diagnostic.
 */
export const runAndStoreFiscalWatch = async (store: KVNamespace, ai: AiRunner | undefined, opts: { now?: Date; fetcher?: typeof fetch } = {}): Promise<FiscalWatchRun> => {
  if (!ai) throw new Error('AI_BINDING_MISSING');
  await store.put(ATTEMPT_KEY, (opts.now ?? new Date()).toISOString(), { expirationTtl: ATTEMPT_TTL_S });
  const run = await runFiscalWatch(ai, opts);
  if (run.ok) await store.put(LATEST_KEY, JSON.stringify(run));
  else await store.put(FAILURE_KEY, JSON.stringify(run), { expirationTtl: 30 * 86400 });
  return run;
};

/** Une exécution à la demande est-elle permise maintenant ? (protège le quota gratuit) */
export const canRunOnDemand = async (store: KVNamespace, now: Date = new Date()): Promise<boolean> => {
  if (await store.get(ATTEMPT_KEY)) return false;
  const latest = await store.get<FiscalWatchRun>(LATEST_KEY, 'json');
  return !latest || now.getTime() - new Date(latest.checkedAt).getTime() >= MIN_INTERVAL_AFTER_SUCCESS_MS;
};
