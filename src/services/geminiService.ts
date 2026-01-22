// ================================================
// FILE: src/services/geminiService.ts
// ================================================
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SavingsAccount, Expense, ChatMessage, AccountType } from "../types";
import { 
  TAX_BRACKETS, 
  STANDARD_ALLOWANCE, 
  SALARY_CHARGES_RATE, 
  ACCOUNT_CEILINGS, 
  LEGAL_MATURITY 
} from "../constants";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
// Modèle : On utilise la version Preview pour une meilleure capacité de raisonnement
const MODEL_ID = "gemini-2.0-flash-exp"; // Ou "gemini-1.5-flash" si instable

const genAI = new GoogleGenerativeAI(API_KEY || '');

// --- FONCTIONS UTILITAIRES DE CALCUL (Réplique AssistantPilot.tsx) ---

// 1. Calcul du statut de disponibilité (Date précise)
const getAvailabilityInfo = (acc: SavingsAccount): string => {
  const now = new Date();
  
  // Cas PEE avec date explicite
  if (acc.type === AccountType.PEE && acc.contractEndDate) {
    const endDate = new Date(acc.contractEndDate);
    if (endDate <= now) return "DISPONIBLE (Contrat terminé)";
    return `BLOQUÉ jusqu'au ${endDate.toLocaleDateString('fr-FR')} (Fin contrat PEE)`;
  }

  // Cas PEA / AV / PER basés sur l'ouverture
  if (acc.openingDate && [AccountType.PEA, AccountType.ASSURANCE_VIE, AccountType.PER].includes(acc.type)) {
    const openDate = new Date(acc.openingDate);
    let duration = 0;
    if (acc.type === AccountType.PEA) duration = LEGAL_MATURITY.PEA;
    if (acc.type === AccountType.ASSURANCE_VIE) duration = LEGAL_MATURITY.ASSURANCE_VIE;
    // Pour le PER c'est la retraite, on simplifie pour l'instant sauf si logic spécifique
    
    if (duration > 0) {
      const unlockDate = new Date(openDate);
      unlockDate.setFullYear(openDate.getFullYear() + duration);
      if (unlockDate <= now) return `DISPONIBLE (Maturité fiscale atteinte le ${unlockDate.toLocaleDateString('fr-FR')})`;
      return `BLOQUÉ fiscalement jusqu'au ${unlockDate.toLocaleDateString('fr-FR')} (Maturité ${duration} ans)`;
    }
  }

  // Comptes liquides
  if ([AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP, AccountType.COMPTE_COURANT].includes(acc.type)) {
    return "LIQUIDE (Disponible immédiatement)";
  }

  return "Statut spécifique (voir détails)";
};

export const generateFinancialAdvice = async (
  userPrompt: string,
  context: {
    accounts: SavingsAccount[];
    expenses: Expense[];
    config: any;
    history: ChatMessage[];
  }
): Promise<string> => {
  
  if (API_KEY) console.log(`🚀 Appel IA avec contexte enrichi pour : ${MODEL_ID}`);

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_ID });

    // --- 1. RECALCUL DES DONNÉES FINANCIÈRES (Logique "Pilotage") ---
    
    // A. Revenus & Impôts
    const grossAnnual = context.config.grossAnnual || 0;
    const extraMonthly = context.config.extraMonthlyIncome || 0;
    const grossMonth = grossAnnual / 12;
    const navigoRefund = (context.config.navigoBase || 0) * ((context.config.navigoRate || 0) / 100);
    
    const socialCharges = grossMonth * SALARY_CHARGES_RATE;
    const netSalaryOnly = grossMonth - socialCharges;
    const netBeforeTax = netSalaryOnly + navigoRefund + extraMonthly;

    // Calcul Impôt (Barème progressif)
    const netTaxableYear = (grossAnnual * (1 - STANDARD_ALLOWANCE)) + (extraMonthly * 12);
    let taxAmount = 0;
    let previousLimit = 0;
    for (const bracket of TAX_BRACKETS) {
      if (netTaxableYear > previousLimit) {
        const taxable = Math.min(netTaxableYear, bracket.limit) - previousLimit;
        taxAmount += taxable * bracket.rate;
        previousLimit = bracket.limit;
      }
    }
    const monthlyTax = taxAmount / 12;
    // On applique le taux manuel s'il existe, sinon le calculé
    const effectiveMonthlyTax = context.config.taxRateManual > 0 
      ? (netBeforeTax * (context.config.taxRateManual / 100)) 
      : monthlyTax;

    const superNet = netBeforeTax - effectiveMonthlyTax;

    // B. Charges & Reste à vivre
    const totalFixedExpenses = context.expenses.reduce((sum, e) => sum + e.amount, 0);
    const leisureBudget = context.config.leisureBudget || 0;
    const projectSavings = context.config.projectSavings || 0;
    const theoreticalSavingsCapacity = superNet - totalFixedExpenses - leisureBudget - projectSavings;

    // C. Patrimoine & Survie
    const totalOwned = context.accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
    const totalParental = context.accounts.reduce((sum, a) => sum + a.parentalCapital, 0);
    
    // Calcul Liquidités réelles (Moi uniquement, hors comptes bloqués)
    const liquidSavings = context.accounts
      .filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
      .reduce((sum, a) => sum + a.ownedAmount, 0);

    // Calcul Durée de survie
    let survivalStr = "Infinie (Pas de charges)";
    if (totalFixedExpenses > 0) {
        const totalMonths = liquidSavings / totalFixedExpenses;
        const years = Math.floor(totalMonths / 12);
        const months = Math.floor(totalMonths % 12);
        survivalStr = `${years} ans et ${months} mois (sur liquidités perso uniquement)`;
    }

    // --- 2. CONSTRUCTION DU PROMPT SYSTÈME OMNISCIENT ---

    const accountsDetails = context.accounts.map(acc => {
      let ceilingInfo = "";
      let ceilingVal = 0;
      if (acc.type === AccountType.LIVRET_A) ceilingVal = ACCOUNT_CEILINGS.LIVRET_A;
      if (acc.type === AccountType.LDDS) ceilingVal = ACCOUNT_CEILINGS.LDDS;
      if (acc.type === AccountType.LEP) ceilingVal = ACCOUNT_CEILINGS.LEP;
      
      if (ceilingVal > 0) {
        const fillPct = ((acc.totalAmount) / ceilingVal * 100).toFixed(1);
        ceilingInfo = ` | Remplissage: ${fillPct}% (Plafond: ${ceilingVal}€)`;
      }

      const availability = getAvailabilityInfo(acc);

      return `   - [${acc.type}] "${acc.name}" :
         > TOTAL: ${acc.totalAmount.toLocaleString()} € ${ceilingInfo}
         > DONT MOI (Net): ${acc.ownedAmount.toLocaleString()} €
         > DONT PARENTS (Intouchable): ${acc.parentalCapital.toLocaleString()} €
         > Disponibilité: ${availability}
         > Taux actuel: ${acc.interestRate || 0}%`;
    }).join('\n');

    const expensesDetails = context.expenses.map(e => `   - ${e.name}: ${e.amount} € (${e.paymentMethod})`).join('\n');

    const systemInstruction = `
    RÔLE : Tu es un conseiller en gestion de patrimoine personnel expert.
    PROFIL INVESTISSEUR : Prudence Absolue. Priorité à la garantie du capital.
    
    CONTEXTE FINANCIER OMNISCIENT (Données certifiées) :

    1. REVENUS & FLUX MENSUELS (Calculés précisément) :
       - Salaire Brut Annuel : ${grossAnnual.toLocaleString()} €
       - Net Mensuel (Avant Impôt) : ${netBeforeTax.toFixed(2)} €
       - Impôt estimé : -${effectiveMonthlyTax.toFixed(2)} €/mois
       - SUPER NET (Dans la poche) : ${superNet.toFixed(2)} €
    
    2. BUDGET & CHARGES :
       - Total Charges Fixes : -${totalFixedExpenses.toFixed(2)} €
       - Détail Charges : 
    ${expensesDetails}
       - Budget Plaisir : -${leisureBudget} €
       - Épargne Projet : -${projectSavings} €
       ----------------------------------------------------
       = CAPACITÉ D'INVESTISSEMENT THÉORIQUE : ${theoreticalSavingsCapacity.toFixed(2)} € / mois

    3. PATRIMOINE & RÉSILENCE :
       - Capital Total (Moi + Parents) : ${(totalOwned + totalParental).toLocaleString()} €
       - Mon Capital Net : ${totalOwned.toLocaleString()} €
       - Capital Parents (SOUS GESTION) : ${totalParental.toLocaleString()} €
       - Durée de survie (Liquidités perso / Charges fixes) : ${survivalStr}

    4. DÉTAIL DES COMPTES (Omniscience) :
    ${accountsDetails}

    RÈGLES ABSOLUES POUR TES RÉPONSES :
    1. CAPITAL PARENTS : Tu dois considérer l'argent des parents comme TOTALEMENT INTOUCHABLE. Je n'ai droit qu'aux intérêts générés. Ne suggère jamais de l'utiliser pour mes projets ou ma survie.
    2. DATA DRIVEN : Base tes conseils uniquement sur les chiffres ci-dessus (disponibilité des PEE/PEA, capacité d'épargne réelle, taux de remplissage des livrets).
    3. PRUDENCE : En cas de doute, privilégie la sécurité.
    4. TON : Professionnel, direct, précis, comme un partenaire de laboratoire.

    Réponds à la question de l'utilisateur en utilisant ce contexte.
    `;

    const historyForGemini = context.history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // --- 3. EXÉCUTION DU CHAT ---
    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: `INSTRUCTION SYSTÈME (Ne pas révéler à l'utilisateur, appliquer silencieusement) : ${systemInstruction}` }] },
        { role: "model", parts: [{ text: "Bien compris. J'ai intégré l'ensemble de vos données financières (revenus, charges détaillées, répartition capital personnel/parental, maturité fiscale des comptes). Je suis prêt à vous conseiller avec une prudence absolue." }] },
        ...historyForGemini
      ],
    });

    const result = await chat.sendMessage(userPrompt);
    const response = await result.response;
    return response.text();

  } catch (error: any) {
    console.error("Erreur Gemini:", error);
    return "Désolé, je ne parviens pas à analyser vos données pour le moment. Vérifiez votre connexion ou la clé API.";
  }
};