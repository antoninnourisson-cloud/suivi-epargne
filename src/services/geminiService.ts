import { GoogleGenerativeAI } from "@google/generative-ai";
import { SavingsAccount, Expense, ChatMessage, AccountType } from "../types";
import { ACCOUNT_CEILINGS, LEGAL_MATURITY } from "../constants";

// Récupération de la clé API depuis les variables d'environnement
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Initialisation du SDK (Création unique si la clé est stable, sinon à recréer dans la fonction)
const genAI = new GoogleGenerativeAI(API_KEY || '');

/**
 * Génère un conseil financier personnalisé via Gemini 1.5 Flash
 * Utilise le contexte complet (Comptes, Charges, Historique de chat)
 */
export const generateFinancialAdvice = async (
  userPrompt: string,
  context: {
    accounts: SavingsAccount[];
    expenses: Expense[];
    config: any; // Contient grossAnnual, taxRateManual, etc.
    history: ChatMessage[];
  }
): Promise<string> => {
  if (!API_KEY) {
    return "Erreur configuration : Clé API Gemini manquante (VITE_GEMINI_API_KEY). Vérifiez votre fichier .env.local";
  }

  // Utilisation du modèle Flash pour la rapidité et le coût
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  // --- 1. PRÉPARATION DES DONNÉES FINANCIÈRES (Le "System Context") ---
  
  // Calculs agrégés pour aider l'IA
  const totalOwned = context.accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
  const totalParents = context.accounts.reduce((sum, a) => sum + a.parentalCapital, 0);
  
  const liquidSavings = context.accounts
    .filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
    .reduce((sum, a) => sum + a.ownedAmount, 0);

  const totalExpenses = context.expenses.reduce((sum, e) => sum + e.amount, 0);

  // Construction du prompt système
  const systemInstruction = `
    TU ES UN CONSEILLER EN GESTION DE PATRIMOINE PERSONNEL, EXPERT ET PRUDENT.
    Ton client cherche à optimiser son épargne avec un profil "Prudence Absolue" (aversion au risque).

    --- DONNÉES DU CLIENT ---
    REVENUS & CHARGES :
    - Brut Annuel : ${context.config.grossAnnual} €
    - Charges Fixes déclarées : ${totalExpenses} €/mois
    - Reste à vivre estimé (avant loisirs) : Voir calculs précédents.

    PATRIMOINE ACTUEL :
    - Total Net (Part Client) : ${totalOwned.toLocaleString()} €
    - Dont Liquidités Disponibles : ${liquidSavings.toLocaleString()} €
    - Capital détenu par les parents (non utilisable) : ${totalParents.toLocaleString()} €

    DÉTAIL DES COMPTES :
    ${context.accounts.map(a => 
      `- ${a.name} (${a.type}) : Solde ${a.ownedAmount}€ / Taux ${a.interestRate || '?'}% / Plafond ${a.ceiling || 'N/A'}€`
    ).join('\n')}

    CONSTANTES LÉGALES :
    - Plafond Livret A : ${ACCOUNT_CEILINGS.LIVRET_A}€
    - Plafond LEP : ${ACCOUNT_CEILINGS.LEP}€ (Priorité absolue si éligible)
    - Plafond LDDS : ${ACCOUNT_CEILINGS.LDDS}€

    --- TES DIRECTIVES ---
    1. PRIORITÉ 1 : La sécurité. Ne propose jamais de Crypto ou d'Actions volatiles sans mise en garde massive.
    2. PRIORITÉ 2 : Remplir les livrets défiscalisés (LEP > Livret A > LDDS) avant tout le reste.
    3. Si le client demande s'il peut acheter quelque chose, vérifie son "Reste à vivre" et son épargne de précaution (il faut garder 3 à 6 mois de charges de côté).
    4. Sois concis, pédagogique et bienveillant. Utilise le gras pour les chiffres importants.
    5. Tu réponds en tant qu'Assistant, tu connais déjà tous les chiffres ci-dessus, le client n'a pas besoin de te les rappeler.
  `;

  // --- 2. PRÉPARATION DE L'HISTORIQUE ---
  // On convertit le format interne ChatMessage vers le format Gemini
  // On garde les 15 derniers messages pour le contexte conversationnel sans exploser le quota
  const historyForGemini = context.history.slice(-15).map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }]
  }));

  // --- 3. DÉMARRAGE DU CHAT ---
  const chat = model.startChat({
    history: [
      // On injecte le contexte système comme un premier échange "fictif" ou instruction système
      // Note : Gemini supporte systemInstruction à l'init du modèle, mais l'injecter ici fonctionne bien pour renforcer le contexte.
      { 
        role: "user", 
        parts: [{ text: `INSTRUCTION SYSTÈME (INVISIBLE POUR L'UTILISATEUR) : ${systemInstruction}` }] 
      },
      { 
        role: "model", 
        parts: [{ text: "Bien reçu. Je suis prêt à agir en tant que conseiller patrimonial prudent avec ces données." }] 
      },
      ...historyForGemini
    ],
  });

  // --- 4. ENVOI DU MESSAGE ---
  try {
    const result = await chat.sendMessage(userPrompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Erreur API Gemini:", error);
    return "Désolé, je rencontre une difficulté technique pour analyser vos données pour le moment. Vérifiez votre connexion internet.";
  }
};