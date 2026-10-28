// Veille fiscale par Gemini : les questions posées et l'appel (réponse lue par parseFiscalWatch,
// dans lib/fiscalWatch.ts). Chargé seulement quand la veille passe par Gemini, avec le client
// Gemini : rien de plus au démarrage.
import { askGeminiWithSearch } from './geminiService';

export const FISCAL_WATCH_PROMPT = `Tu es un assistant de veille fiscale française. Utilise la recherche Google pour trouver les valeurs OFFICIELLES EN VIGUEUR AUJOURD'HUI (privilégie service-public.fr, impots.gouv.fr, economie.gouv.fr, legifrance.gouv.fr, banque-france.fr ; insee.fr pour l'inflation). Réponds UNIQUEMENT par un objet JSON, sans texte autour, de cette forme (omets un champ si tu n'es pas sûr ; chaque valeur a la source https exacte où tu l'as lue) :
{
  "livretARate": {"value": 1.7, "effectiveDate": "AAAA-MM-JJ", "source": "https://..."},
  "lepRate": {"value": 2.5, "effectiveDate": "AAAA-MM-JJ", "source": "..."},
  "livretACeiling": {"value": 22950, "source": "..."},
  "lddsCeiling": {"value": 12000, "source": "..."},
  "lepCeiling": {"value": 10000, "source": "..."},
  "lepIncomeCeilingOnePart": {"value": 23028, "source": "..."},
  "lepPerHalfPart": {"value": 6149, "source": "..."},
  "socialChargesGeneral": {"value": 0.186, "source": "..."},
  "socialChargesLifeInsurance": {"value": 0.172, "source": "..."},
  "allowanceCap": {"value": 14555, "source": "..."},
  "allowanceMin": {"value": 509, "source": "..."},
  "decoteSingle": {"value": 897, "source": "..."},
  "decoteThreshold": {"value": 1982, "source": "..."},
  "donation75Ceiling": {"value": 2000, "source": "..."},
  "transportExemptUntil": {"value": 2026, "source": "..."},
  "taxBrackets": {"year": 2026, "value": [{"limit": 11600, "rate": 0}, {"limit": 29579, "rate": 0.11}, {"limit": 84577, "rate": 0.30}, {"limit": 181917, "rate": 0.41}, {"limit": null, "rate": 0.45}], "source": "..."},
  "inflationAnnual": {"value": 0.9, "year": 2025, "source": "https://www.insee.fr/..."}
}
Les exemples ci-dessus ne sont que des formats : vérifie chaque valeur. Taux des livrets en % annuel ; prélèvements sociaux en fraction (0,186 = 18,6 %) ; "taxBrackets" = le barème le plus récent publié pour l'impôt sur le revenu (une part), "year" = année de publication du barème, "limit" = borne haute de la tranche (null pour la dernière). Les montants de plafond de revenus LEP sont ceux applicables pour une ouverture aujourd'hui. "donation75Ceiling" = plafond des dons ouvrant droit à 75 % pour un don fait aujourd'hui. "transportExemptUntil" = dernière année de revenus pour laquelle la prise en charge facultative de l'abonnement de transport public par l'employeur (au-delà des 50 % obligatoires, jusqu'à 75 % du prix) est exonérée d'impôt. "inflationAnnual" = hausse MOYENNE des prix à la consommation (INSEE) de la dernière année complète publiée, en %, et "year" = cette année-là (pas un glissement sur un mois).`;


/**
 * Question posée à Gemini quand le serveur fournit le texte des pages officielles : Gemini
 * n'invente rien, il relève les valeurs dans ces textes (sans recherche Google, donc dans
 * le quota gratuit).
 */
export const buildSourcesPrompt = (sources: { url: string; topic: string; text: string }[]): string => {
  const format = FISCAL_WATCH_PROMPT.slice(FISCAL_WATCH_PROMPT.indexOf('{'), FISCAL_WATCH_PROMPT.lastIndexOf('}') + 1);
  const docs = sources.map((s, i) => `=== PAGE ${i + 1} — ${s.topic} — ${s.url} ===\n${s.text}`).join('\n\n');
  return `Tu es un assistant de veille fiscale française. Voici le texte de pages officielles (service-public.gouv.fr, insee.fr) lues aujourd'hui. N'utilise QUE ces textes : relève les valeurs EN VIGUEUR AUJOURD'HUI et omets tout champ absent des textes. Pour chaque valeur, "source" est l'adresse de la page où tu l'as lue. Réponds UNIQUEMENT par un objet JSON de cette forme :
${format}
Les exemples ne sont que des formats. Taux des livrets en % annuel ; prélèvements sociaux en fraction (0,186 = 18,6 %) ; "taxBrackets" = le barème le plus récent (une part), "year" = année d'imposition, "limit" = borne haute (null pour la dernière tranche) ; "donation75Ceiling" = plafond des dons ouvrant droit à 75 % pour un don fait aujourd'hui (pas celui d'une période passée) ; "transportExemptUntil" = dernière année de revenus où la prise en charge facultative de l'abonnement de transport (jusqu'à 75 % du prix) est exonérée ; "inflationAnnual" = inflation en moyenne annuelle de la dernière année complète (en %), "year" = cette année-là.

${docs}`;
};

/**
 * Réponse brute de Gemini. Avec au moins trois pages officielles lisibles fournies par le
 * serveur, Gemini relève les valeurs dans leur texte (sans recherche Google) ; sinon, il les
 * cherche lui-même.
 */
export const askFiscalWatch = (apiKey: string, sources: { url: string; topic: string; text: string }[]): Promise<string> =>
  sources.length >= 3
    ? askGeminiWithSearch(apiKey, buildSourcesPrompt(sources), 90_000, false)
    : askGeminiWithSearch(apiKey, FISCAL_WATCH_PROMPT);
