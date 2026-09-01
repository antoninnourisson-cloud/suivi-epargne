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
  constructor(message: string) { super(message); this.name = 'GeminiError'; }
}

/**
 * Envoie le document (PDF ou image, encodé en base64 par downloadFileAsBase64) à Gemini
 * et renvoie les champs extraits. Lève une GeminiError explicite en cas d'échec (clé
 * invalide, quota dépassé, réponse inexploitable) : jamais de résultat inventé.
 */
export const extractPayslipData = async (
  apiKey: string,
  base64Data: string,
  mimeType: string
): Promise<PayslipExtractedData> => {
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY_MISSING');

  // Timeout : sans lui, une requête qui pend laissait l'écran "Analyse en cours..." et le
  // bouton morts jusqu'au rechargement de la page.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  let res: Response;
  try {
    res = await fetch(
      // Clé dans l'en-tête, pas dans l'URL : une query string atterrit dans les logs
      // réseau, l'historique devtools et tout intermédiaire qui capture les URLs.
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: controller.signal,
        body: JSON.stringify({
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
      }),
      }
    );
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new GeminiError('DÉLAI_DÉPASSÉ — l\'analyse a pris trop de temps, réessaie.');
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GeminiError(`Gemini API ${res.status} — ${body.slice(0, 300)}`);
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
