import { GoogleGenerativeAI } from "@google/generative-ai";
import { SavingsAccount, Expense, ChatMessage, AccountType } from "../types";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// --- CONFIGURATION DU MODÈLE ---
// Tu veux tester la version "Gemini 3 Flash Preview".
// Note : Si ce nom exact renvoie une erreur 404, c'est que l'ID technique est légèrement différent.
// Autres possibilités courantes : "gemini-2.0-flash-exp", "gemini-experimental"
const MODEL_ID = "gemini-3-flash-preview"; 

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
  
  // Petit check console pour être sûr que la nouvelle clé est bien prise
  if (API_KEY) console.log(`🚀 Tentative avec modèle : ${MODEL_ID}`);

  try {
    // On force l'utilisation de la version 'v1beta' qui est souvent requise pour les modèles Preview
    const model = genAI.getGenerativeModel({ model: MODEL_ID }, { apiVersion: 'v1beta' });

    // --- 1. PRÉPARATION DES DONNÉES ---
    const totalOwned = context.accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
    const liquidSavings = context.accounts
      .filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
      .reduce((sum, a) => sum + a.ownedAmount, 0);
    const totalExpenses = context.expenses.reduce((sum, e) => sum + e.amount, 0);

    const systemInstruction = `
      TU ES UN CONSEILLER FINANCIER D'ÉLITE (Profil : Prudence Absolue).
      
      DONNÉES CLIENT :
      - Revenus : ${context.config.grossAnnual} €/an
      - Charges : ${totalExpenses} €/mois
      - Patrimoine Net : ${totalOwned.toLocaleString()} €
      - Liquidités : ${liquidSavings.toLocaleString()} €
      
      COMPTES :
      ${context.accounts.map(a => `- ${a.name} (${a.type}): ${a.ownedAmount}€`).join('\n')}
      
      DIRECTIVES :
      1. Sécurité totale du capital.
      2. Optimisation fiscale via livrets réglementés (LEP/A/LDDS).
      3. Analyse fine et proactive.
    `;

    const historyForGemini = context.history.slice(-10).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // --- 2. CHAT ---
    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: `INSTRUCTION SYSTÈME : ${systemInstruction}` }] },
        { role: "model", parts: [{ text: "Bien reçu. Je suis prêt à optimiser votre situation." }] },
        ...historyForGemini
      ],
    });

    const result = await chat.sendMessage(userPrompt);
    const response = await result.response;
    return response.text();

  } catch (error: any) {
    console.error("Erreur Gemini:", error);
    
    // Aide au diagnostic si le nom du modèle est faux
    if (error.message?.includes('404') || error.message?.includes('not found')) {
      return `⚠️ Erreur Modèle (404) : Le nom "${MODEL_ID}" n'est pas reconnu.
      
      👉 SOLUTION : 
      1. Va sur Google AI Studio.
      2. Sélectionne le modèle "Gemini 3 Flash" dans la liste à droite.
      3. Clique sur le bouton "< > Get Code".
      4. Copie le nom exact qui est entre guillemets (ex: "models/gemini-...") et mets-le dans le code.`;
    }

    return "Désolé, une erreur technique est survenue.";
  }
};