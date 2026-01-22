import { GoogleGenerativeAI } from "@google/generative-ai";
import { SavingsAccount, Expense, ChatMessage } from "../types";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
// On utilise le modèle Flash pour la rapidité et la faible consommation de tokens
const MODEL_ID = "gemini-1.5-flash"; 

const genAI = new GoogleGenerativeAI(API_KEY || '');

// Structure exacte des données calculées reçues de App.tsx
export interface ComputedFinancials {
  grossAnnual: number;
  netMonthlyBeforeTax: number;
  superNetMonthly: number;
  totalExpenses: number;
  resteAVivre: number;
  totalParent: number;
  totalMine: number;
  myLiquidities: number;
  runway: string;
}

export const generateFinancialAdvice = async (
  userPrompt: string,
  context: {
    accounts: SavingsAccount[];
    expenses: Expense[];
    config: any;
    history: ChatMessage[];
    computed: ComputedFinancials; // Les données omniscientes
  }
): Promise<string> => {
  
  if (!API_KEY) return "Erreur : Clé API manquante. Vérifiez votre fichier .env.local";

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_ID });

    // Fonction helper pour l'affichage (réplique la logique de l'App pour l'affichage texte)
    const isParentAccount = (name: string) => /parent|papa|maman|usufruit/i.test(name);

    const systemInstruction = `
      RÔLE : Tu es le Directeur Financier (CFO) personnel de l'utilisateur.
      Tu as accès aux données certifiées de l'application (onglet Pilotage).

      === 🚨 DISTINCTION CAPITAUX (TRES IMPORTANT) ===
      - Capital PARENTS (Intouchable/Usufruit) : ${context.computed.totalParent.toLocaleString()} €
      - Capital UTILISATEUR (Disponible) : ${context.computed.totalMine.toLocaleString()} €
      -> RÈGLE D'OR : Ne jamais inclure le capital Parents dans le calcul de survie ou d'achat. Ce n'est pas son argent.

      === 📊 FLUX MENSUELS (PILOTAGE) ===
      - Brut Annuel : ${context.computed.grossAnnual.toLocaleString()} €
      - Net Mensuel (Avant Impôt) : ${Math.round(context.computed.netMonthlyBeforeTax).toLocaleString()} €
      - Super Net (Dans la poche) : ${Math.round(context.computed.superNetMonthly).toLocaleString()} €

      === 💸 BUDGET & CHARGES ===
      - Total Charges Fixes : -${context.computed.totalExpenses.toLocaleString()} €
      - Détail Charges : ${context.expenses.map(e => `${e.name} (${e.amount}€)`).join(', ')}
      -------------------------------------------------------
      = RESTE À VIVRE RÉEL : ${Math.round(context.computed.resteAVivre).toLocaleString()} € / mois
      (C'est la somme disponible pour les Plaisirs et l'Épargne).

      === 🛡️ SÉCURITÉ & RUNWAY ===
      - Liquidités Personnelles : ${context.computed.myLiquidities.toLocaleString()} €
      - RUNWAY (Autonomie sans salaire) : ${context.computed.runway} MOIS
      (Calculé strictement sur : Liquidités Persos / Charges Fixes).

      === 🏦 PLACEMENTS & BLOCAGES ===
      ${context.accounts.map(a => {
        const owner = isParentAccount(a.name) ? "[PARENTS 🚫]" : "[MOI ✅]";
        let status = "Disponible";
        if (a.contractEndDate) {
            const date = new Date(a.contractEndDate);
            // Vérifie si la date est future
            status = date > new Date() ? `🔒 BLOQUÉ jusqu'au ${date.toLocaleDateString()}` : "🔓 DÉBLOQUÉ";
        }
        return `- ${owner} ${a.name} (${a.type}) : ${a.ownedAmount.toLocaleString()}€ | ${status} | Taux: ${a.interestRate}%`;
      }).join('\n')}

      DIRECTIVES :
      1. Tes réponses doivent être basées sur ces chiffres EXACTS.
      2. Si je veux acheter un objet cher, regarde mon "Reste à Vivre" et mon "Runway".
      3. Sois direct, mathématique mais bienveillant.
    `;

    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: systemInstruction }] },
        { role: "model", parts: [{ text: "Bien reçu. J'ai intégré vos données financières exactes et la distinction stricte des capitaux. Je suis prêt." }] },
        ...context.history.slice(-10).map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }]
        }))
      ]
    });

    const result = await chat.sendMessage(userPrompt);
    const response = await result.response;
    return response.text();

  } catch (error: any) {
    console.error("Gemini Error:", error);
    return "Désolé, une erreur technique m'empêche d'analyser vos finances pour le moment.";
  }
};