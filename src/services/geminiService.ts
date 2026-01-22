// ================================================
// FILE: src/services/geminiService.ts
// ================================================
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SavingsAccount, Expense, ChatMessage, AccountType, FiscalConfig } from "../types";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL_ID = "gemini-2.0-flash-exp"; 

const genAI = new GoogleGenerativeAI(API_KEY || '');

// On change la signature pour accepter la config fiscale
const getAvailabilityInfo = (acc: SavingsAccount, fiscalConfig: FiscalConfig): string => {
  const now = new Date();
  
  if (acc.type === AccountType.PEE && acc.contractEndDate) {
    const endDate = new Date(acc.contractEndDate);
    if (endDate <= now) return "DISPONIBLE (Contrat terminé)";
    return `BLOQUÉ jusqu'au ${endDate.toLocaleDateString('fr-FR')} (Fin contrat PEE)`;
  }

  if (acc.openingDate && [AccountType.PEA, AccountType.ASSURANCE_VIE, AccountType.PER].includes(acc.type)) {
    const openDate = new Date(acc.openingDate);
    let duration = 0;
    // UTILISATION DE LA CONFIG DYNAMIQUE
    if (acc.type === AccountType.PEA) duration = fiscalConfig.legalMaturity.pea;
    if (acc.type === AccountType.ASSURANCE_VIE) duration = fiscalConfig.legalMaturity.assuranceVie;
    
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
    fiscalConfig: FiscalConfig; // <--- AJOUT IMPORTANT
  }
): Promise<string> => {
  
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_ID });
    const { fiscalConfig } = context; // Extraction

    // --- 1. RÉCUPERATION DES PARAMÈTRES ET CALCULS ---
    
    // Paramètres Navigo & Salaire
    const navigoBase = context.config.navigoBase || 90.80;
    const navigoRate = context.config.navigoRate || 67.24; 
    const navigoRefund = navigoBase * (navigoRate / 100);
    
    const grossAnnual = context.config.grossAnnual || 0;
    const extraMonthly = context.config.extraMonthlyIncome || 0;
    const grossMonth = grossAnnual / 12;
    
    // UTILISATION DE LA CONFIG DYNAMIQUE
    const socialCharges = grossMonth * fiscalConfig.salaryChargesRate;
    
    const netSalaryOnly = grossMonth - socialCharges;
    const netBeforeTax = netSalaryOnly + navigoRefund + extraMonthly;
    // Calcul Impôt DYNAMIQUE
    const netTaxableYear = ((netSalaryOnly + extraMonthly) * 12) * (1 - fiscalConfig.standardAllowance);
    
    let taxAmount = 0;
    let previousLimit = 0;
    
    // Boucle sur les tranches dynamiques
    for (const bracket of fiscalConfig.taxBrackets) {
        // Gestion de l'infini
        const limit = bracket.limit === null || bracket.limit === undefined ? Infinity : bracket.limit;
        
        if (netTaxableYear > previousLimit) {
            const taxable = Math.min(netTaxableYear, limit) - previousLimit;
            taxAmount += taxable * bracket.rate;
            previousLimit = limit;
        }
    }

    const monthlyTax = taxAmount / 12;
    const effectiveMonthlyTax = context.config.taxRateManual > 0 
      ? (netBeforeTax * (context.config.taxRateManual / 100)) 
      : monthlyTax;

    const superNet = netBeforeTax - effectiveMonthlyTax;

    // ... (Budget & Capacité, Patrimoine : INCHANGÉS)
    const totalFixedExpenses = context.expenses.reduce((sum, e) => sum + e.amount, 0);
    const leisureBudget = context.config.leisureBudget || 0;
    const projectSavings = context.config.projectSavings || 0;
    const theoreticalSavingsCapacity = superNet - totalFixedExpenses - leisureBudget - projectSavings;
    const totalOwned = context.accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
    const totalParental = context.accounts.reduce((sum, a) => sum + a.parentalCapital, 0);
    const liquidSavings = context.accounts
      .filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type))
      .reduce((sum, a) => sum + a.ownedAmount, 0);
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
      // UTILISATION DE LA CONFIG DYNAMIQUE
      if (acc.type === AccountType.LIVRET_A) ceilingVal = fiscalConfig.ceilings.livretA;
      if (acc.type === AccountType.LDDS) ceilingVal = fiscalConfig.ceilings.ldds;
      if (acc.type === AccountType.LEP) ceilingVal = fiscalConfig.ceilings.lep;
      
      let ceilingInfo = "";
      if (ceilingVal > 0) {
        const fillPct = ((acc.totalAmount) / ceilingVal * 100).toFixed(1);
        ceilingInfo = `(Rempli à ${fillPct}% sur plafond ${ceilingVal}€)`;
      }

      // Passe la config à getAvailabilityInfo
      return `   - [${acc.type}] "${acc.name}" ${ceilingInfo}:
         > TOTAL COMPTE: ${acc.totalAmount.toLocaleString()} €
         > DONT MA PART: ${acc.ownedAmount.toLocaleString()} €
         > DONT PARENTS: ${acc.parentalCapital.toLocaleString()} € (Intouchable)
         > Disponibilité: ${getAvailabilityInfo(acc, fiscalConfig)}
         > Taux: ${acc.interestRate || 0}%`;
    }).join('\n');

    const expensesDetails = context.expenses.map(e => `   - ${e.name}: ${e.amount} €`).join('\n');

    const systemInstruction = `
    RÔLE : Expert en Gestion de Patrimoine (Profil: Prudence Absolue).
    
    PARAMÈTRES LÉGAUX ACTUELS (CONFIGURÉS PAR L'UTILISATEUR) :
    - Taux Charges Sociales Salariales : ${(fiscalConfig.salaryChargesRate * 100).toFixed(2)}%
    - Plafond Livret A : ${fiscalConfig.ceilings.livretA}€
    - Plafond LEP : ${fiscalConfig.ceilings.lep}€

    1. DÉTAIL DES REVENUS (Calcul Dynamique) :
       - Salaire Brut Mensuel : ${grossMonth.toLocaleString(undefined, {maximumFractionDigits: 0})} €
       - Charges Sociales : -${socialCharges.toFixed(2)} €
       - Remboursement Navigo : +${navigoRefund.toFixed(2)} €
       - Revenu Extra : +${extraMonthly} €
       ------------------------------------------------
       = NET AVANT IMPÔT : ${netBeforeTax.toFixed(2)} €
       - Impôt estimé (Selon barème perso) : -${effectiveMonthlyTax.toFixed(2)} €
       = SUPER NET : ${superNet.toFixed(2)} €

    2. CAPACITÉ D'INVESTISSEMENT RÉELLE :
       - Super Net : ${superNet.toFixed(2)} €
       - Charges Fixes : -${totalFixedExpenses.toFixed(2)} €
       - Budget Plaisir : -${leisureBudget} €
       - Épargne Projet : -${projectSavings} €
       ------------------------------------------------
       = RESTE À INVESTIR : ${theoreticalSavingsCapacity.toFixed(2)} € / mois

    3. PATRIMOINE :
       - Capital Parents (Intouchable) : ${totalParental.toLocaleString()} €
       - Mon Capital : ${totalOwned.toLocaleString()} €
       - Survie : ${survivalStr}

    4. COMPTES :
    ${accountsDetails}

    CONSIGNES :
    Utilise ces paramètres dynamiques pour tes calculs. Si le taux de charges est élevé (ex: 25%), note-le comme une hypothèse "Secteur Privé" si pertinent.
    `;

    const historyForGemini = context.history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: `INSTRUCTION SYSTÈME : ${systemInstruction}` }] },
        { role: "model", parts: [{ text: "Bien reçu. J'utilise vos paramètres fiscaux personnalisés pour l'analyse." }] },
        ...historyForGemini
      ],
    });

    const result = await chat.sendMessage(userPrompt);
    const response = await result.response;
    return response.text();

  } catch (error: any) {
    console.error("Erreur Gemini:", error);
    return "Erreur technique IA.";
  }
};