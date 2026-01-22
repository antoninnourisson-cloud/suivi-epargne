import { GoogleGenerativeAI } from "@google/generative-ai";
import { SavingsAccount, Expense, ChatMessage, AccountType } from "../types";
import { ACCOUNT_CEILINGS } from "../constants";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(API_KEY || '');

export const generateFinancialAdvice = async (
  userPrompt: string,
  context: {
    accounts: SavingsAccount[];
    expenses: Expense[];
    config: any;
    history: ChatMessage[];
  }
): Promise<string> => {
  if (!API_KEY) {
    return "Erreur configuration : Clé API Gemini manquante (VITE_GEMINI_API_KEY). Vérifiez votre fichier .env.local";
  }

  // MODIFICATION ICI : Utilisation de la version "001" qui est la plus stable
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

  // --- 1. PRÉPARATION DES DONNÉES FINANCIÈRES ---
  const totalOwned = context.accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
  const totalParents = context.accounts.reduce((sum, a) => sum + a.parentalCapital, 0);
  
  const liquidSavings = context.accounts
    .filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
    .reduce((sum, a) => sum + a.ownedAmount, 0);

  const totalExpenses = context.expenses.reduce((sum, e) => sum + e.amount, 0);

  const systemInstruction = `
    TU ES UN CONSEILLER EN GESTION DE PATRIMOINE PERSONNEL, EXPERT ET PRUDENT.
    Ton client cherche à optimiser son épargne avec un profil "Prudence Absolue" (aversion au risque).

    --- DONNÉES DU CLIENT ---
    REVENUS & CHARGES :
    - Brut Annuel : ${context.config.grossAnnual} €
    - Charges Fixes déclarées : ${totalExpenses} €/mois

    PATRIMOINE ACTUEL :
    - Total Net (Part Client) : ${totalOwned.toLocaleString()} €
    - Dont Liquidités Disponibles : ${liquidSavings.toLocaleString()} €
    - Capital détenu par les parents : ${totalParents.toLocaleString()} €

    DÉTAIL DES COMPTES :
    ${context.accounts.map(a => 
      `- ${a.name} (${a.type}) : Solde ${a.ownedAmount}€ / Taux ${a.interestRate || '?'}%`
    ).join('\n')}

    CONSTANTES LÉGALES :
    - Plafond Livret A : ${ACCOUNT_CEILINGS.LIVRET_A}€
    - Plafond LEP : ${ACCOUNT_CEILINGS.LEP}€ (Priorité absolue si éligible)
    - Plafond LDDS : ${ACCOUNT_CEILINGS.LDDS}€

    --- TES DIRECTIVES ---
    1. PRIORITÉ 1 : La sécurité. Ne propose jamais de Crypto ou d'Actions volatiles sans mise en garde.
    2. PRIORITÉ 2 : Remplir les livrets défiscalisés (LEP > Livret A > LDDS).
    3. Sois concis, pédagogique et utilise le gras pour les chiffres importants.
  `;

  // --- 2. PRÉPARATION DE L'HISTORIQUE ---
  const historyForGemini = context.history.slice(-10).map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }]
  }));

  const chat = model.startChat({
    history: [
      { 
        role: "user", 
        parts: [{ text: `INSTRUCTION SYSTÈME CACHÉE : ${systemInstruction}` }] 
      },
      { 
        role: "model", 
        parts: [{ text: "Bien reçu. Je suis prêt à vous conseiller." }] 
      },
      ...historyForGemini
    ],
  });

  try {
    const result = await chat.sendMessage(userPrompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Erreur API Gemini:", error);
    return "Désolé, une erreur technique est survenue. Vérifiez votre connexion ou réessayez plus tard.";
  }
};