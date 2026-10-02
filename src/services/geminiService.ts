// ================================================
// FILE: src/services/geminiService.ts
// Extraction des informations d'une fiche de paie via l'API Gemini (multimodale :
// accepte directement un PDF ou une image encodés en base64).
//
// Appelée uniquement à la demande explicite de l'utilisateur (bouton "Extraire"),
// jamais automatiquement : chaque appel consomme du quota sur SA clé API.
// ================================================
import { PayslipExtractedData } from '../types';

// Modèle multimodal rapide, adapté à l'extraction structurée d'un document. Isolé en
// constante pour rester simple à faire évoluer : Google déprécie régulièrement les
// anciens modèles (gemini-2.5-flash a par exemple cessé de répondre, l'API renvoyant
// elle-même le nom du modèle de remplacement dans son message d'erreur 404) — si ce
// modèle cesse à son tour de fonctionner, la même erreur indiquera quoi mettre ici.
const GEMINI_MODEL = 'gemini-3.6-flash';

// Modèle choisi dans Paramètres (sur cet appareil) : permet de remplacer un modèle retiré
// par Google sans attendre une mise à jour de l'app.
const MODEL_OVERRIDE_KEY = 'gemini_model';
export const getGeminiModelOverride = (): string => { try { return localStorage.getItem(MODEL_OVERRIDE_KEY) || ''; } catch { return ''; } };
export const setGeminiModelOverride = (m: string) => { try { m.trim() ? localStorage.setItem(MODEL_OVERRIDE_KEY, m.trim()) : localStorage.removeItem(MODEL_OVERRIDE_KEY); } catch { /* non mémorisé */ } };
export const DEFAULT_GEMINI_MODEL = GEMINI_MODEL;
const modelChain = (): string[] => {
  const o = getGeminiModelOverride();
  return [...new Set([...(o ? [o] : []), GEMINI_MODEL, ...FALLBACK_MODELS_LIST])];
};

// Modèles de repli, essayés dans l'ordre si le principal est saturé ou a disparu. La
// saturation (« the model is overloaded », HTTP 503) touche un modèle à la fois : un autre
// Flash répond généralement. Tous acceptent le même schéma de sortie structurée.
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash'];
const FALLBACK_MODELS_LIST = FALLBACK_MODELS;

// Statuts qui justifient de réessayer : surcharge / quota momentané / erreur passagère.
// 400 (requête invalide), 401/403 (clé refusée) ne changeront pas en réessayant.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

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
    mealVouchers: { type: 'NUMBER', description: 'Valeur des tickets restaurant du mois, en euros' },
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

/**
 * Envoie le document (PDF ou image, encodé en base64 par downloadFileAsBase64) à Gemini
 * et renvoie les champs extraits. Lève une GeminiError explicite en cas d'échec (clé
 * invalide, quota dépassé, réponse inexploitable) : jamais de résultat inventé.
 */
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

export const extractPayslipData = async (
  apiKey: string,
  base64Data: string,
  mimeType: string,
  options: ExtractOptions = {}
): Promise<PayslipExtractedData> => {
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY_MISSING', 'AUTH');
  const retryDelays = options.retryDelaysMs ?? [2_000, 6_000];
  const timeoutMs = options.requestTimeoutMs ?? 60_000;

  const body = JSON.stringify({
    contents: [{
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mimeType, data: base64Data } },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  // Saturation fréquente aux heures de pointe : on réessaie le même modèle avec un délai
  // croissant, puis on bascule sur les modèles de repli. Une erreur non passagère (clé
  // refusée, requête invalide) interrompt tout de suite — réessayer n'y changerait rien.
  let res: Response | null = null;
  let lastFailure = '';
  outer: for (const model of modelChain()) {
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      if (attempt > 0) await sleep(retryDelays[attempt - 1]);
      let r: Response;
      try {
        r = await callModel(model, apiKey, body, timeoutMs);
      } catch (e: any) {
        if (e?.name === 'AbortError') { lastFailure = `${model} : délai dépassé`; continue; }
        throw e; // réseau coupé : inutile d'insister
      }
      if (r.ok) { res = r; break outer; }
      const text = await r.text().catch(() => '');
      lastFailure = `${model} : HTTP ${r.status} — ${text.slice(0, 200)}`;
      // Modèle retiré (404) : inutile de le réessayer, on passe directement au suivant.
      if (r.status === 404) continue outer;
      if (!RETRYABLE_STATUS.has(r.status)) {
        throw new GeminiError(`Gemini API ${r.status} — ${text.slice(0, 300)}`, r.status === 401 || r.status === 403 ? 'AUTH' : undefined);
      }
    }
  }
  if (!res) {
    throw new GeminiError(
      `Gemini indisponible après plusieurs tentatives sur ${modelChain().length} modèles (dernier échec : ${lastFailure})`,
      'OVERLOADED'
    );
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiError('RÉPONSE_GEMINI_VIDE');

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiError('RÉPONSE_GEMINI_ILLISIBLE');
  }

  // Filtrage défensif : ne garder que des nombres finis / chaînes non vides, même si le
  // modèle a respecté le schéma — jamais de NaN ou de chaîne vide propagés dans l'état.
  const num = (v: any): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const str = (v: any): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  const result: PayslipExtractedData = {
    employer: str(parsed.employer),
    period: str(parsed.period),
    grossAmount: num(parsed.grossAmount),
    socialCharges: num(parsed.socialCharges),
    netAmount: num(parsed.netAmount),
    netTaxable: num(parsed.netTaxable),
    navigoRefund: num(parsed.navigoRefund),
    mealVouchers: num(parsed.mealVouchers),
    mutuelleCost: num(parsed.mutuelleCost),
    incomeTaxWithheld: num(parsed.incomeTaxWithheld),
    netPaid: num(parsed.netPaid),
  };
  return result;
};

/**
 * Question libre à Gemini avec la recherche Google activée (veille fiscale). Renvoie le
 * texte de la réponse. Même chaîne de modèles et mêmes reprises que l'extraction.
 */
export const askGeminiWithSearch = async (apiKey: string, prompt: string, timeoutMs = 90_000): Promise<string> => {
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY_MISSING', 'AUTH');
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] });
  let lastFailure = '';
  for (const model of modelChain()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(4_000);
      let r: Response;
      try { r = await callModel(model, apiKey, body, timeoutMs); }
      catch (e: unknown) {
        if ((e as { name?: string })?.name === 'AbortError') { lastFailure = `${model} : délai dépassé`; continue; }
        throw e;
      }
      if (r.ok) {
        const data = await r.json();
        const parts: { text?: string }[] = data?.candidates?.[0]?.content?.parts || [];
        const text = parts.map(p => p.text || '').join('');
        if (!text) throw new GeminiError('RÉPONSE_GEMINI_VIDE');
        return text;
      }
      const t = await r.text().catch(() => '');
      lastFailure = `${model} : HTTP ${r.status} — ${t.slice(0, 200)}`;
      if (r.status === 404) break;
      if (!RETRYABLE_STATUS.has(r.status)) throw new GeminiError(`Gemini API ${r.status} — ${t.slice(0, 300)}`, r.status === 401 || r.status === 403 ? 'AUTH' : undefined);
    }
  }
  throw new GeminiError(`Gemini indisponible (dernier échec : ${lastFailure})`, 'OVERLOADED');
};
