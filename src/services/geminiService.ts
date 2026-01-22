import { GoogleGenerativeAI } from "@google/generative-ai";
import { SavingsAccount, Expense, ChatMessage, AccountType } from "../types";
import { ACCOUNT_CEILINGS } from "../constants";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// ON REPASSE SUR FLASH (Maintenant que tu as une nouvelle clé, ça va marcher)
const MODEL_ID = "gemini-1.5-flash"; 

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
  
  // --- DIAGNOSTIC CLÉ (Regarde ta console navigateur !) ---
  if (API_KEY) {
    console.log(`🔑 Clé utilisée par Vercel : ${API_KEY.substring(0, 8)}...`);
  } else {
    console.error("❌ AUCUNE CLÉ DÉTECTÉE DANS VERCEL");
    return "Erreur : Clé API manquante dans Vercel.";
  }
  // -------------------------------------------------------

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_ID });

    // --- 1. PRÉPARATION ---
    const totalOwned = context.accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
    const liquidSavings = context.accounts
      .filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
      .reduce((sum, a) => sum + a.ownedAmount, 0);
    const totalExpenses = context.expenses.reduce((sum, e) => sum + e.amount, 0);

    const systemInstruction = `
      TU ES UN CONSEILLER FINANCIER "PRUDENCE ABSOLUE".
      
      DONNÉES CLIENT :
      - Revenus : ${context.config.grossAnnual} €/an
      - Charges : ${totalExpenses} €/mois
      - Patrimoine Net : ${totalOwned.toLocaleString()} €
      - Liquidités : ${liquidSavings.toLocaleString()} €
      
      COMPTES :
      ${context.accounts.map(a => `- ${a.name} (${a.type}): ${a.ownedAmount}€`).join('\n')}
      
      RÈGLES :
      1. Sécurité totale.
      2. Remplir LEP > Livret A > LDDS en priorité.
      3. Réponses courtes.
    `;

    // --- 2. HISTORIQUE ---
    const historyForGemini = context.history.slice(-8).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // --- 3. CHAT ---
    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: `INSTRUCTION : ${systemInstruction}` }] },
        { role: "model", parts: [{ text: "Bien reçu." }] },
        ...historyForGemini
      ],
    });

    const result = await chat.sendMessage(userPrompt);
    const response = await result.response;
    return response.text();

  } catch (error: any) {
    console.error("Erreur Gemini:", error);
    
    // Si Flash ne marche pas, on tente de lister les modèles dispos pour t'aider
    if (error.message?.includes('404')) {
      return `Erreur 404 : Le modèle ${MODEL_ID} n'est pas activé sur ce projet Google.`;
    }
    return "Désolé, erreur technique.";
  }
};