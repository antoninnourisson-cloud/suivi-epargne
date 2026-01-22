import { GoogleGenerativeAI } from "@google/generative-ai";
import { SavingsAccount, Expense, ChatMessage, AccountType } from "../types";
import { ACCOUNT_CEILINGS } from "../constants";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// "gemini-pro" est le modèle standard v1.0.
// C'est le plus compatible du marché (pas d'erreur 404 ou 429).
const MODEL_ID = "gemini-pro"; 

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
    return "Erreur : Clé API manquante. Vérifiez VITE_GEMINI_API_KEY sur Vercel.";
  }

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_ID });

    // --- 1. PRÉPARATION DES DONNÉES ---
    const totalOwned = context.accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
    const liquidSavings = context.accounts
      .filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
      .reduce((sum, a) => sum + a.ownedAmount, 0);
    const totalExpenses = context.expenses.reduce((sum, e) => sum + e.amount, 0);

    const systemInstruction = `
      CONTEXTE : Tu es un conseiller financier expert pour un client "Prudence Absolue".
      
      CHIFFRES CLÉS :
      - Revenus : ${context.config.grossAnnual} €/an
      - Charges : ${totalExpenses} €/mois
      - Patrimoine Net : ${totalOwned.toLocaleString()} €
      - Dont Liquidités : ${liquidSavings.toLocaleString()} €

      COMPTES :
      ${context.accounts.map(a => `- ${a.name} (${a.type}): ${a.ownedAmount}€`).join('\n')}

      DIRECTIVES :
      1. Sécurité maximale (pas de crypto/actions risquées).
      2. Priorité aux livrets défiscalisés.
      3. Réponses courtes et mathématiques.
    `;

    // --- 2. PRÉPARATION DE L'HISTORIQUE ---
    const historyForGemini = context.history.slice(-8).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // --- 3. DÉMARRAGE DU CHAT ---
    const chat = model.startChat({
      history: [
        // Astuce : On force le contexte dans un premier échange "fictif"
        // car Gemini Pro v1 gère mal le "system instruction" séparé.
        { role: "user", parts: [{ text: systemInstruction + "\n\nEst-ce clair ?" }] },
        { role: "model", parts: [{ text: "C'est très clair. Je suis prêt." }] },
        ...historyForGemini
      ],
    });

    // --- 4. ENVOI ---
    const result = await chat.sendMessage(userPrompt);
    const response = await result.response;
    return response.text();

  } catch (error: any) {
    console.error("Erreur Gemini:", error);
    
    if (error.message?.includes('404') || error.message?.includes('not found')) {
      return "Erreur 404 : Modèle introuvable. Votre clé API semble valide mais restreinte.";
    }
    
    return "Désolé, une erreur technique est survenue.";
  }
};