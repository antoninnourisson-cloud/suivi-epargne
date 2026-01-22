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
// Utilisation du modèle experimental pour une meilleure logique
const MODEL_ID = "gemini-2.0-flash-exp"; 

const genAI = new GoogleGenerativeAI(API_KEY || '');

// --- FONCTIONS UTILITAIRES ---

const getAvailabilityInfo = (acc: SavingsAccount): string => {
  const now = new Date();
  
  if (acc.type === AccountType.PEE && acc.contractEndDate) {
    const endDate = new Date(acc.contractEndDate);
    if (endDate <= now) return "DISPONIBLE (Contrat terminé)";
    return `BLOQUÉ jusqu'au ${endDate.toLocaleDateString('fr-FR')} (Fin contrat PEE)`;
  }

  if (acc.openingDate && [AccountType.PEA, AccountType.ASSURANCE_VIE, AccountType.PER].includes(acc.type)) {
    const openDate = new Date(acc.openingDate);
    let duration = 0;
    if (acc.type === AccountType.PEA) duration = LEGAL_MATURITY.PEA;
    if (acc.type === AccountType.ASSURANCE_VIE) duration = LEGAL_MATURITY.ASSURANCE_VIE;
    
    if (duration > 0) {
      const unlockDate = new Date(openDate);
      unlockDate.setFullYear(openDate.getFullYear() + duration);
      if (unlockDate <= now) return `DISPONIBLE (Maturité atteinte le ${unlockDate.toLocaleDateString('fr-FR')})`;
      return `BLOQUÉ fiscalement jusqu'au ${unlockDate.toLocaleDateString('fr-FR')} (Maturité ${duration} ans)`;
    }
  }

  if ([AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP, AccountType.COMPTE_COURANT].includes(acc.type)) {
    return "LIQUIDE (Disponible immédiatement)";
  }

  return "Statut spécifique";
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
  
  if (API_KEY) console.log(`🚀 Appel IA Omnisciente : ${MODEL_ID}`);

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_ID });

    // --- 1. RÉCUPERATION DES PARAMÈTRES ET CALCULS ---
    
    // Paramètres Navigo & Salaire
    const navigoBase = context.config.navigoBase || 90.80;
    const navigoRate = context.config.navigoRate || 67.24; // ex: 67.24%
    const navigoRefund = navigoBase * (navigoRate / 100);
    
    const grossAnnual = context.config.grossAnnual || 0;
    const extraMonthly = context.config.extraMonthlyIncome || 0;
    const grossMonth = grossAnnual / 12;
    
    const socialCharges = grossMonth * SALARY_CHARGES_RATE;
    const netSalaryOnly = grossMonth - socialCharges;
    const netBeforeTax = netSalaryOnly + navigoRefund + extraMonthly;

    // Calcul Impôt
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
    const effectiveMonthlyTax = context.config.taxRateManual > 0 
      ? (netBeforeTax * (context.config.taxRateManual / 100)) 
      : monthlyTax;

    const superNet = netBeforeTax - effectiveMonthlyTax;

    // Budget & Capacité
    const totalFixedExpenses = context.expenses.reduce((sum, e) => sum + e.amount, 0);
    const leisureBudget = context.config.leisureBudget || 0;
    const projectSavings = context.config.projectSavings || 0;
    
    // LA FORMULE CLÉ : Super Net - Charges - Plaisir - Projets
    const theoreticalSavingsCapacity = superNet - totalFixedExpenses - leisureBudget - projectSavings;

    // Patrimoine
    const totalOwned = context.accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
    const totalParental = context.accounts.reduce((sum, a) => sum + a.parentalCapital, 0);
    
    const liquidSavings = context.accounts
      .filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
      .reduce((sum, a) => sum + a.ownedAmount, 0);

    // Survie
    let survivalStr = "Infinie";
    if (totalFixedExpenses > 0) {
        const totalMonths = liquidSavings / totalFixedExpenses;
        const years = Math.floor(totalMonths / 12);
        const months = Math.floor(totalMonths % 12);
        survivalStr = `${years} ans et ${months} mois`;
    }

    // --- 2. FORMATAGE DU CONTEXTE POUR L'IA ---

    const accountsDetails = context.accounts.map(acc => {
      let ceilingVal = 0;
      if (acc.type === AccountType.LIVRET_A) ceilingVal = ACCOUNT_CEILINGS.LIVRET_A;
      if (acc.type === AccountType.LDDS) ceilingVal = ACCOUNT_CEILINGS.LDDS;
      if (acc.type === AccountType.LEP) ceilingVal = ACCOUNT_CEILINGS.LEP;
      
      let ceilingInfo = "";
      if (ceilingVal > 0) {
        const fillPct = ((acc.totalAmount) / ceilingVal * 100).toFixed(1);
        ceilingInfo = `(Rempli à ${fillPct}% sur plafond ${ceilingVal}€)`;
      }

      return `   - [${acc.type}] "${acc.name}" ${ceilingInfo}:
         > TOTAL COMPTE: ${acc.totalAmount.toLocaleString()} €
         > DONT MA PART: ${acc.ownedAmount.toLocaleString()} €
         > DONT PARENTS: ${acc.parentalCapital.toLocaleString()} € (Intouchable)
         > Disponibilité: ${getAvailabilityInfo(acc)}
         > Taux: ${acc.interestRate || 0}%`;
    }).join('\n');

    const expensesDetails = context.expenses.map(e => `   - ${e.name}: ${e.amount} €`).join('\n');

    const systemInstruction = `
    RÔLE : Expert en Gestion de Patrimoine (Profil: Prudence Absolue, Rigueur Scientifique).
    
    TU DISPOSES DES DONNÉES FINANCIÈRES EXACTES CI-DESSOUS. UTILISE-LES POUR EXPLIQUER TES CALCULS.

    1. DÉTAIL DES REVENUS (Mode Calculatrice) :
       - Salaire Brut Mensuel : ${grossMonth.toLocaleString(undefined, {maximumFractionDigits: 0})} €
       - Charges Sociales (-${(SALARY_CHARGES_RATE*100).toFixed(2)}%) : -${socialCharges.toFixed(2)} €
       - Remboursement Navigo : +${navigoRefund.toFixed(2)} €
         (Formule Navigo : Base ${navigoBase}€ x Prise en charge ${navigoRate}%)
       - Revenu Extra : +${extraMonthly} €
       ------------------------------------------------
       = NET AVANT IMPÔT : ${netBeforeTax.toFixed(2)} €
       - Impôt à la source estimé : -${effectiveMonthlyTax.toFixed(2)} €
       = SUPER NET (En poche) : ${superNet.toFixed(2)} €

    2. ANALYSE BUDGÉTAIRE ET CAPACITÉ D'INVESTISSEMENT :
       L'objectif est de définir l'argent réellement disponible pour l'investissement long terme.
       
       Départ : SUPER NET (${superNet.toFixed(2)} €)
       - Charges Fixes Totales : -${totalFixedExpenses.toFixed(2)} €
         (Détail: ${context.expenses.map(e => e.name).join(', ')})
       - Budget Plaisir (Sanctuarisé) : -${leisureBudget} €
       - Épargne Projet Court Terme (Voyage/Achat) : -${projectSavings} €
       ------------------------------------------------
       = CAPACITÉ D'INVESTISSEMENT RÉELLE : ${theoreticalSavingsCapacity.toFixed(2)} € / mois

    3. ÉTAT DU PATRIMOINE :
       - Total sous gestion : ${(totalOwned + totalParental).toLocaleString()} €
       - Dont Capital Parents (STRICTEMENT INTERDIT D'Y TOUCHER) : ${totalParental.toLocaleString()} €
       - Dont Mon Capital : ${totalOwned.toLocaleString()} €
       - Filet de sécurité (Survie) : ${survivalStr} avec les charges actuelles.

    4. COMPTES DÉTAILLÉS :
    ${accountsDetails}

    CONSIGNES DE RÉPONSE :
    1. Si je te demande comment est calculé mon salaire, cite les chiffres exacts du Navigo (${navigoRate}%) et des charges (${(SALARY_CHARGES_RATE*100).toFixed(2)}%).
    2. Si je demande combien je peux investir, rappelle-moi que c'est APRES avoir déduit mes plaisirs (${leisureBudget}€) et mes projets (${projectSavings}€).
    3. Ne confonds jamais l'argent des parents avec le mien.
    `;

    const historyForGemini = context.history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: `INSTRUCTION SYSTÈME CACHÉE : ${systemInstruction}` }] },
        { role: "model", parts: [{ text: "Bien reçu. J'ai intégré vos paramètres salariaux (taux charges, Navigo), vos budgets plaisirs/projets et la distinction stricte des capitaux. Je suis prêt." }] },
        ...historyForGemini
      ],
    });

    const result = await chat.sendMessage(userPrompt);
    const response = await result.response;
    return response.