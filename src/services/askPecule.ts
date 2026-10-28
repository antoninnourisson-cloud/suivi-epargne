// ================================================
// FILE: src/services/askPecule.ts
// « Demander à Pécule » : questions en français sur ses propres données, posées à Google
// Gemini avec la clé de l'utilisateur, directement depuis l'appareil. Chaque question part
// avec le résumé des données (lib/askSnapshot) et les échanges précédents de la conversation ;
// Pécule ne garde rien (ni sur Drive, ni sur l'appareil, ni sur son serveur). Lecture seule :
// la réponse est un texte affiché, jamais une modification des données.
// ================================================
import { askGeminiChat, GeminiError, type ChatTurn, type ExtractOptions } from './geminiService';
import { parseISODate } from '../lib/dates';

export type { ChatTurn };

/** Longueur maximale d'une question. */
export const ASK_QUESTION_MAX = 500;
/** Échanges précédents renvoyés avec une question (les plus récents). */
const HISTORY_TURNS = 12;
/** Longueur maximale d'une réponse affichée. */
const ANSWER_MAX = 6_000;

/** Date lisible du résumé : « 28 octobre 2026 ». */
export const askDateLabel = (asOf: string): string =>
  parseISODate(asOf).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Consigne donnée à Gemini, avec le résumé des données en JSON. */
export const buildAskSystemPrompt = (snapshotJson: string, asOf: string): string => `Tu es « Demander à Pécule », l'assistant de l'application d'épargne Pécule. Tu réponds en français, brièvement, aux questions de l'utilisateur sur SES données, résumées dans le JSON ci-dessous (photographie du ${askDateLabel(asOf)}, montants en euros).

Règles :
- Réponds uniquement à partir de ce JSON, et des règles générales de l'épargne française dont tu es certain (plafonds et fonctionnement des livrets réglementés, fiscalité de l'assurance vie et du PEA…).
- Donne les montants en euros (format français, ex. 1 234,56 €) avec la date ou la période concernée.
- Pour un total, pars des champs déjà calculés quand ils existent (« epargne.ceTrimestre », « interets.acquisADate », « totaux », « resteSousPlafond »…) ; pour tout autre calcul, utilise l'exécution de code plutôt que le calcul de tête.
- Si les données ne permettent pas de répondre, dis-le simplement et indique ce qu'il faudrait renseigner dans Pécule. N'invente jamais de chiffre, de compte ni de date.
- « partPropre » est l'argent de l'utilisateur ; « capitalParental » appartient à ses parents (il leur sera rendu), les intérêts de ce capital reviennent à l'utilisateur.
- Tu ne peux rien modifier. Si on te demande d'agir, explique où le faire dans l'app.
- Tu n'es pas un conseiller financier : pas de recommandation d'investissement personnalisée.
- Texte simple : phrases courtes, listes avec des tirets si besoin, sans tableau ni titre.

Données (JSON) :
${snapshotJson}`;

/** Message en clair pour une erreur (mêmes mots que les fiches de paie). */
export const describeAskError = (e: unknown): string => {
  const code = e instanceof GeminiError ? e.code : undefined;
  if (code === 'OVERLOADED') return 'Gemini est très sollicité en ce moment (plusieurs tentatives et modèles essayés automatiquement). Réessayez dans quelques minutes.';
  if (code === 'AUTH') return 'Gemini refuse la clé API : vérifiez-la dans les Paramètres.';
  if (e instanceof GeminiError) return "Gemini n'a pas pu répondre à cette question. Reformulez-la ou réessayez.";
  return 'Pas de réponse : vérifiez votre connexion à Internet, puis réessayez.';
};

/** Texte de la réponse à afficher : sans mise en forme Markdown appuyée, raccourci si besoin. */
export const cleanAnswer = (text: string): string => {
  const plain = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[*•]\s+/gm, '- ').trim();
  return plain.length > ANSWER_MAX ? `${plain.slice(0, ANSWER_MAX).trimEnd()}…` : plain;
};

/**
 * Pose `question` à Gemini, avec le résumé et les échanges précédents (`history`, les plus
 * récents seulement). Renvoie la réponse nettoyée ; lève une GeminiError en cas d'échec.
 */
export const askPecule = async (
  apiKey: string,
  snapshot: { json: string; asOf: string },
  history: ChatTurn[],
  question: string,
  options: ExtractOptions = {},
): Promise<string> => {
  const turns: ChatTurn[] = [...history.slice(-HISTORY_TURNS), { role: 'user', text: question.trim().slice(0, ASK_QUESTION_MAX) }];
  // Une conversation commence toujours par une question.
  while (turns.length > 1 && turns[0].role !== 'user') turns.shift();
  return cleanAnswer(await askGeminiChat(apiKey, buildAskSystemPrompt(snapshot.json, snapshot.asOf), turns, options));
};
