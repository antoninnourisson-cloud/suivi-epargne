// ================================================
// FILE: src/services/geminiService.ts
// Lecture de documents par l'API Gemini (multimodale : accepte directement un PDF ou une
// image encodés en base64) : fiches de paie, avis d'imposition, relevés bancaires ; et
// question libre pour la veille fiscale.
//
// Appelée uniquement à la demande explicite de l'utilisateur (bouton « Extraire »,
// « Importer un avis », « Lire un relevé »), jamais automatiquement : chaque appel consomme
// du quota sur SA clé API, gardée sur l'appareil. Les documents vont directement de
// l'appareil à Google, jamais au serveur de Pécule.
//
// Toute réponse est filtrée avant d'atteindre l'état de l'app : un champ absent, illisible
// ou hors des bornes de vraisemblance devient `undefined` (à saisir à la main), jamais NaN,
// une chaîne vide ou un montant aberrant.
// ================================================
import { PayslipExtractedData } from '../types';
import { round2 } from '../lib/money';
import { storageKey } from '../lib/storageKeys';
import { sanitizeStatement, type StatementData } from '../lib/statementImport';

// Modèle multimodal rapide, adapté à l'extraction structurée d'un document. Isolé en
// constante pour rester simple à faire évoluer : Google déprécie régulièrement les
// anciens modèles (gemini-2.5-flash a par exemple cessé de répondre, l'API renvoyant
// elle-même le nom du modèle de remplacement dans son message d'erreur 404) — si ce
// modèle cesse à son tour de fonctionner, la même erreur indiquera quoi mettre ici.
const GEMINI_MODEL = 'gemini-3.6-flash';

// Modèle choisi dans Paramètres (sur cet appareil) : permet de remplacer un modèle retiré
// par Google sans attendre une mise à jour de l'app.
const MODEL_OVERRIDE_KEY = storageKey('geminiModel');
export const getGeminiModelOverride = (): string => { try { return localStorage.getItem(MODEL_OVERRIDE_KEY) || ''; } catch { return ''; } };
export const setGeminiModelOverride = (m: string) => { try { if (m.trim()) localStorage.setItem(MODEL_OVERRIDE_KEY, m.trim()); else localStorage.removeItem(MODEL_OVERRIDE_KEY); } catch { /* non mémorisé */ } };
export const DEFAULT_GEMINI_MODEL = GEMINI_MODEL;

// Modèles de repli, essayés dans l'ordre si le principal est saturé ou a disparu. La
// saturation (« the model is overloaded », HTTP 503) touche un modèle à la fois : un autre
// Flash répond généralement. Tous acceptent le même schéma de sortie structurée.
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash'];
const modelChain = (): string[] => {
  const o = getGeminiModelOverride();
  return [...new Set([...(o ? [o] : []), GEMINI_MODEL, ...FALLBACK_MODELS])];
};

// Statuts qui justifient de réessayer : surcharge / quota momentané / erreur passagère.
// 400 (requête invalide), 401/403 (clé refusée) ne changeront pas en réessayant.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class GeminiError extends Error {
  // 'OVERLOADED' : tous les modèles étaient saturés malgré les nouvelles tentatives —
  // l'UI invite alors à réessayer plus tard plutôt que d'évoquer un problème de clé.
  constructor(message: string, public code?: 'OVERLOADED' | 'AUTH') { super(message); this.name = 'GeminiError'; }
}

export interface ExtractOptions {
  // Délais entre deux tentatives sur un même modèle (injectables pour les tests).
  retryDelaysMs?: number[];
  // Délai maximal d'UNE requête.
  requestTimeoutMs?: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Un appel à un modèle donné, avec son propre délai maximal. */
const callModel = async (model: string, apiKey: string, body: string, timeoutMs: number): Promise<Response> => {
  // Timeout : sans lui, une requête qui pend laissait l'écran "Analyse en cours..." et le
  // bouton morts jusqu'au rechargement de la page.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(
      // Clé dans l'en-tête, pas dans l'URL : une query string atterrit dans les logs
      // réseau, l'historique devtools et tout intermédiaire qui capture les URLs.
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: controller.signal,
        body,
      }
    );
  } finally {
    clearTimeout(timer);
  }
};

/** Texte de la réponse : les parties « réflexion » (modèles qui raisonnent) n'en font pas partie. */
const responseText = (data: unknown): string => {
  const parts = (data as { candidates?: { content?: { parts?: unknown } }[] } | null)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p): p is { text?: unknown; thought?: unknown } => !!p && typeof p === 'object' && !(p as { thought?: unknown }).thought)
    .map(p => (typeof p.text === 'string' ? p.text : ''))
    .join('');
};

/**
 * Envoie la requête, avec la même politique pour tous les usages : saturation fréquente aux
 * heures de pointe, donc reprise du même modèle après chaque délai de `retryDelays`, puis
 * bascule sur les modèles de repli ; un modèle retiré (404) est sauté ; une erreur non
 * passagère (clé refusée, requête invalide) interrompt tout de suite — réessayer n'y
 * changerait rien. Renvoie le texte de la réponse (jamais vide).
 */
const generate = async (apiKey: string, body: string, retryDelays: number[], timeoutMs: number): Promise<string> => {
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY_MISSING', 'AUTH');
  const models = modelChain();
  let lastFailure = '';
  outer: for (const model of models) {
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      if (attempt > 0) await sleep(retryDelays[attempt - 1]);
      let r: Response;
      try {
        r = await callModel(model, apiKey, body, timeoutMs);
      } catch (e: unknown) {
        if ((e as { name?: string } | null)?.name === 'AbortError') { lastFailure = `${model} : délai dépassé`; continue; }
        throw e; // réseau coupé : inutile d'insister
      }
      if (r.ok) {
        const data: unknown = await r.json().catch(() => null);
        const text = responseText(data);
        if (!text.trim()) throw new GeminiError('RÉPONSE_GEMINI_VIDE');
        return text;
      }
      const text = await r.text().catch(() => '');
      lastFailure = `${model} : HTTP ${r.status} — ${text.slice(0, 200)}`;
      // Modèle retiré (404) : inutile de le réessayer, on passe directement au suivant.
      if (r.status === 404) continue outer;
      if (!RETRYABLE_STATUS.has(r.status)) {
        throw new GeminiError(`Gemini API ${r.status} — ${text.slice(0, 300)}`, r.status === 401 || r.status === 403 ? 'AUTH' : undefined);
      }
    }
  }
  throw new GeminiError(`Gemini indisponible après plusieurs tentatives sur ${models.length} modèles (dernier échec : ${lastFailure})`, 'OVERLOADED');
};

/** Réponse JSON (sortie structurée) : un objet, sinon RÉPONSE_GEMINI_ILLISIBLE. */
const parseObject = (text: string): Record<string, unknown> => {
  // Certains modèles entourent encore le JSON d'une clôture Markdown malgré la consigne.
  const bare = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try { parsed = JSON.parse(bare); } catch { throw new GeminiError('RÉPONSE_GEMINI_ILLISIBLE'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new GeminiError('RÉPONSE_GEMINI_ILLISIBLE');
  return parsed as Record<string, unknown>;
};

/** Corps d'une requête « document + consigne → JSON de ce schéma ». */
const documentRequest = (prompt: string, base64Data: string, mimeType: string, schema: object) => JSON.stringify({
  contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
  generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
});

// Filtrage défensif : nombres finis seulement (un montant en texte « 2 050,00 » est refusé,
// pas deviné), chaînes non vides et raccourcies.
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown, max = 120): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const inRange = (v: unknown, min: number, max: number): number | undefined => {
  const n = finite(v);
  return n !== undefined && n >= min && n <= max ? n : undefined;
};

// --- Fiches de paie ---

// Schéma de sortie structurée : Gemini est contraint de répondre avec exactement cette
// forme (aucun champ n'est `required` — une extraction partielle sur une fiche
// difficile à lire reste un résultat valide, à compléter/corriger par l'utilisateur).
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    employer: { type: 'STRING', description: "Nom de l'employeur" },
    period: { type: 'STRING', description: 'Période de paie au format AAAA-MM' },
    grossAmount: { type: 'NUMBER', description: 'Salaire brut du mois, en euros' },
    socialCharges: { type: 'NUMBER', description: 'Total des cotisations et contributions salariales retenues sur le brut ce mois, en euros' },
    netAmount: { type: 'NUMBER', description: "Net à payer AVANT impôt sur le revenu, en euros (ligne généralement intitulée « Net à payer avant impôt sur le revenu »)" },
    netTaxable: { type: 'NUMBER', description: 'Net imposable du mois, en euros (assiette fiscale, différente du net à payer)' },
    navigoRefund: { type: 'NUMBER', description: 'Remboursement transport (Navigo), en euros' },
    mealVouchers: { type: 'NUMBER', description: 'Part SALARIALE des titres-restaurant retenue sur la paie ce mois (montant déduit du salaire), en euros' },
    mutuelleCost: { type: 'NUMBER', description: 'Part salariale de la mutuelle retenue ce mois, en euros' },
    incomeTaxWithheld: { type: 'NUMBER', description: 'Prélèvement à la source (impôt sur le revenu) réellement retenu ce mois, en euros' },
    netPaid: { type: 'NUMBER', description: 'Net payé / net versé : le montant réellement viré sur le compte bancaire ce mois, APRÈS impôt sur le revenu, en euros' },
  },
};

const PROMPT = `Tu analyses une fiche de paie française. Extrais uniquement les informations
demandées par le schéma, en euros (nombres, pas de texte), pour LE MOIS de cette fiche
précisément (pas de cumul annuel). Distingue bien "Net à payer avant impôt" (netAmount),
"Net imposable" (netTaxable, l'assiette fiscale) et "Net payé"/"Net versé" (netPaid, le
montant réellement viré en banque après impôt sur le revenu) — ce sont trois lignes
différentes sur une fiche de paie française, ne confonds pas l'une avec l'autre. Si une
information n'est pas présente ou illisible, omets ce champ plutôt que de deviner une
valeur.`;

/**
 * Borne de vraisemblance d'un montant MENSUEL de fiche de paie (garde-fou contre une lecture
 * aberrante : cumul annuel, centimes lus comme des euros) : au-delà, le champ est laissé
 * vide et se saisit à la main. Les montants sont tous positifs (retenues comprises).
 */
export const PAYSLIP_MAX_AMOUNT = 500_000;
const payAmount = (v: unknown): number | undefined => {
  const n = inRange(v, 0, PAYSLIP_MAX_AMOUNT);
  return n === undefined ? undefined : round2(n);
};

/** Période « AAAA-MM » plausible (mois 01 à 12, année 2000 à l'an prochain), sinon `undefined`. */
export const validPayPeriod = (v: unknown, now = new Date()): string | undefined => {
  const s = text(v, 7);
  const m = s ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s) : null;
  if (!m) return undefined;
  const year = Number(m[1]);
  return year >= 2000 && year <= now.getFullYear() + 1 ? s : undefined;
};

/** Champs d'une fiche de paie relus par Gemini, filtrés (voir l'en-tête du fichier). */
export const sanitizePayslip = (parsed: Record<string, unknown>, now = new Date()): PayslipExtractedData => ({
  employer: text(parsed.employer),
  period: validPayPeriod(parsed.period, now),
  grossAmount: payAmount(parsed.grossAmount),
  socialCharges: payAmount(parsed.socialCharges),
  netAmount: payAmount(parsed.netAmount),
  netTaxable: payAmount(parsed.netTaxable),
  navigoRefund: payAmount(parsed.navigoRefund),
  mealVouchers: payAmount(parsed.mealVouchers),
  mutuelleCost: payAmount(parsed.mutuelleCost),
  incomeTaxWithheld: payAmount(parsed.incomeTaxWithheld),
  netPaid: payAmount(parsed.netPaid),
});

/**
 * Envoie la fiche de paie (PDF ou image, encodée en base64 par downloadFileAsBase64) à Gemini
 * et renvoie les champs extraits. Lève une GeminiError explicite en cas d'échec (clé
 * invalide, quota dépassé, réponse inexploitable) : jamais de résultat inventé.
 */
export const extractPayslipData = async (
  apiKey: string,
  base64Data: string,
  mimeType: string,
  options: ExtractOptions = {}
): Promise<PayslipExtractedData> => {
  const answer = await generate(apiKey, documentRequest(PROMPT, base64Data, mimeType, RESPONSE_SCHEMA),
    options.retryDelaysMs ?? [2_000, 6_000], options.requestTimeoutMs ?? 60_000);
  return sanitizePayslip(parseObject(answer));
};

/**
 * Question libre à Gemini avec la recherche Google activée (veille fiscale). Renvoie le
 * texte de la réponse. Même chaîne de modèles et mêmes reprises que l'extraction.
 */
export const askGeminiWithSearch = async (apiKey: string, prompt: string, timeoutMs = 90_000, useSearch = true, options: Pick<ExtractOptions, 'retryDelaysMs'> = {}): Promise<string> => {
  // La recherche Google n'est pas incluse dans la clé gratuite : sans elle, Gemini lit
  // seulement le texte fourni dans la question.
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], ...(useSearch ? { tools: [{ google_search: {} }] } : {}) });
  return generate(apiKey, body, options.retryDelaysMs ?? [4_000], timeoutMs);
};

// --- Avis d'imposition ---

export interface TaxNoticeData {
  incomeYear?: number;   // année des revenus (avis 2026 = revenus 2025)
  rfr?: number;          // revenu fiscal de référence
  parts?: number;        // nombre de parts
  netTax?: number;       // impôt net
}

const TAX_NOTICE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    incomeYear: { type: 'INTEGER', description: "Année des REVENUS déclarés (ex. un avis 2026 porte sur les revenus 2025)" },
    rfr: { type: 'NUMBER', description: 'Revenu fiscal de référence, en euros' },
    parts: { type: 'NUMBER', description: 'Nombre de parts du foyer fiscal' },
    netTax: { type: 'NUMBER', description: "Impôt sur le revenu net à payer (ou 0), en euros" },
  },
};

const TAX_NOTICE_PROMPT = `Ce document est un avis d'impôt sur le revenu français (ou un avis de situation déclarative). Relève l'année des revenus, le revenu fiscal de référence, le nombre de parts et l'impôt net. N'invente rien : omets un champ illisible ou absent.`;

/** Borne de vraisemblance d'un montant de l'avis (RFR, impôt) : au-delà, lecture aberrante. */
const TAX_MAX_AMOUNT = 100_000_000;

/**
 * Nombre de parts plausible : au moins 1 (une personne seule a une part), par quarts de part
 * (une résidence alternée ouvre droit à un quart de part), 20 au plus.
 * Sources : https://www.service-public.gouv.fr/particuliers/vosdroits/F2702 (personne seule,
 * une part) et https://www.service-public.gouv.fr/particuliers/vosdroits/F2705 (résidence
 * alternée : 0,25 part par enfant pour les deux premiers).
 */
export const validTaxParts = (v: unknown): number | undefined => {
  const n = inRange(v, 1, 20);
  return n !== undefined && Math.abs(n * 4 - Math.round(n * 4)) < 1e-9 ? n : undefined;
};

/** Champs d'un avis d'imposition relus par Gemini, filtrés : ils alimentent l'éligibilité au LEP. */
export const sanitizeTaxNotice = (parsed: Record<string, unknown>, now = new Date()): TaxNoticeData => {
  const year = finite(parsed.incomeYear);
  const rfr = inRange(parsed.rfr, 0, TAX_MAX_AMOUNT);
  const netTax = inRange(parsed.netTax, 0, TAX_MAX_AMOUNT);
  return {
    // Année des revenus : entière, jamais dans le futur (un avis porte sur l'année passée).
    incomeYear: year !== undefined && Number.isInteger(year) && year >= 2000 && year <= now.getFullYear() ? year : undefined,
    rfr: rfr === undefined ? undefined : Math.round(rfr),
    parts: validTaxParts(parsed.parts),
    netTax: netTax === undefined ? undefined : round2(netTax),
  };
};

/** Lit un avis d'imposition (PDF ou photo). Même chaîne de modèles et reprises que les fiches de paie. */
export const extractTaxNotice = async (apiKey: string, base64Data: string, mimeType: string, options: ExtractOptions = {}): Promise<TaxNoticeData> => {
  const answer = await generate(apiKey, documentRequest(TAX_NOTICE_PROMPT, base64Data, mimeType, TAX_NOTICE_SCHEMA),
    options.retryDelaysMs ?? [3_000, 6_000], options.requestTimeoutMs ?? 60_000);
  return sanitizeTaxNotice(parseObject(answer));
};

// --- Relevés bancaires ---

const STATEMENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    bank: { type: 'STRING', description: 'Nom de la banque' },
    periodStart: { type: 'STRING', description: 'Premier jour de la période du relevé, au format AAAA-MM-JJ' },
    periodEnd: { type: 'STRING', description: 'Dernier jour de la période du relevé, au format AAAA-MM-JJ' },
    accounts: {
      type: 'ARRAY',
      description: 'Un élément par compte présent sur le relevé',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: "Intitulé du compte tel qu'il est écrit (ex. « Livret A », « Compte de dépôt »)" },
          numberEnd: { type: 'STRING', description: 'Les 4 DERNIERS chiffres du numéro de compte seulement (jamais le numéro complet ni l\'IBAN)' },
          openingBalance: { type: 'NUMBER', description: 'Ancien solde (début de période), en euros, négatif si le compte est débiteur' },
          closingBalance: { type: 'NUMBER', description: 'Nouveau solde (fin de période), en euros, négatif si le compte est débiteur' },
          closingDate: { type: 'STRING', description: 'Date du nouveau solde, au format AAAA-MM-JJ' },
          movements: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                date: { type: 'STRING', description: "Date de l'opération (pas la date de valeur), au format AAAA-MM-JJ" },
                label: { type: 'STRING', description: "Libellé de l'opération" },
                amount: { type: 'NUMBER', description: 'Montant en euros, toujours positif' },
                direction: { type: 'STRING', enum: ['CREDIT', 'DEBIT'], description: 'CREDIT : argent reçu (colonne Crédit) ; DEBIT : argent sorti (colonne Débit)' },
              },
              required: ['date', 'amount', 'direction'],
            },
          },
        },
        required: ['movements'],
      },
    },
  },
  required: ['accounts'],
};

const STATEMENT_PROMPT = `Ce document est un relevé de compte bancaire français (PDF ou capture d'écran de l'application de la banque). Il peut contenir plusieurs comptes (compte courant, livrets, épargne) : un élément de "accounts" par compte.
Pour chaque compte, relève : son intitulé ; les 4 derniers chiffres de son numéro seulement (jamais le numéro complet, jamais l'IBAN) ; l'ancien et le nouveau solde ; la date du nouveau solde ; et chaque opération : date complète AAAA-MM-JJ (si seuls le jour et le mois sont écrits, déduis l'année de la période du relevé), libellé, montant positif, CREDIT ou DEBIT selon la colonne.
Utilise la date d'opération, pas la date de valeur. Ignore les lignes de total, de report de solde et de cumul. N'invente rien : omets un champ illisible ou absent. Si le document n'est pas un relevé de compte, renvoie une liste "accounts" vide.`;

/**
 * Lit un relevé de compte (PDF ou capture) : période, soldes et opérations de chaque compte,
 * filtrés (dates valides, montants plausibles, numéros réduits aux 4 derniers chiffres). Rien
 * n'est enregistré ici : l'écran de relecture propose, l'utilisateur valide.
 */
export const extractBankStatement = async (apiKey: string, base64Data: string, mimeType: string, options: ExtractOptions = {}): Promise<StatementData> => {
  const answer = await generate(apiKey, documentRequest(STATEMENT_PROMPT, base64Data, mimeType, STATEMENT_SCHEMA),
    // Relevé de plusieurs pages : réponse plus longue que pour une fiche de paie.
    options.retryDelaysMs ?? [2_000, 6_000], options.requestTimeoutMs ?? 120_000);
  return sanitizeStatement(parseObject(answer));
};
