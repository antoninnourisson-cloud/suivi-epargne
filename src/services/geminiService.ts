
import { GoogleGenerativeAI } from "@google/generative-ai";
// RETRAIT de LEGAL_MATURITY et ACCOUNT_CEILINGS des imports
import { SavingsAccount, Expense, ChatMessage, AccountType, FiscalConfig, WorkBenefits } from "../types";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;const MODEL_ID = "gemini-2.0-flash-exp"; 

const genAI = new GoogleGenerativeAI(API_KEY || '');

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
    fiscalConfig: FiscalConfig;
    workBenefits: WorkBenefits; // <--- AJOUT
  }
): Promise<string> => {
  
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_ID });
    const { fiscalConfig, workBenefits } = context;

    // --- 1. CALCULS REVENUS & AVANTAGES ---
    const grossAnnual = context.config.grossAnnual || 0;
    const extraMonthly = context.config.extraMonthlyIncome || 0;
    const grossMonth = grossAnnual / 12;
    const socialCharges = grossMonth * fiscalConfig.salaryChargesRate;
    const netSalaryOnly = grossMonth - socialCharges;

    // Calcul Gains/Coûts Benefits
    let navigoGain = 0;
    if (workBenefits.navigo.active) navigoGain = workBenefits.navigo.basePrice * (workBenefits.navigo.refundRate / 100);
    else navigoGain = (context.config.navigoBase || 90.80) * ((context.config.navigoRate || 67.24) / 100);

    let mutuelleCost = 0;
    if (workBenefits.mutuelle.active) mutuelleCost = workBenefits.mutuelle.totalCost * (1 - workBenefits.mutuelle.employerRate / 100);

    let swileCost = 0;
    if (workBenefits.mealVouchers.active) swileCost = workBenefits.mealVouchers.faceValue * workBenefits.mealVouchers.daysPerMonth * (1 - workBenefits.mealVouchers.employerRate / 100);

    const netBeforeTax = netSalaryOnly + navigoGain + extraMonthly;

    // Calcul Impôt
    const netTaxableYear = ((netSalaryOnly + extraMonthly) * 12) * (1 - fiscalConfig.standardAllowance);
    let taxAmount = 0;
    let previousLimit = 0;
    for (const bracket of fiscalConfig.taxBrackets) {
        const limit = bracket.limit === null || bracket.limit === undefined ? Infinity : bracket.limit;
        if (netTaxableYear > previousLimit) {
            const taxable = Math.min(netTaxableYear, limit) - previousLimit;
            taxAmount += taxable * bracket.rate;
            previousLimit = limit;
        }
    }
    const monthlyTax = taxAmount / 12;
    const effectiveMonthlyTax = context.config.taxRateManual > 0 ? (netBeforeTax * (context.config.taxRateManual / 100)) : monthlyTax;

    // SUPER NET RÉEL (Déduit tout ce qui sort de la poche)
    const superNet = netBeforeTax - effectiveMonthlyTax - mutuelleCost - swileCost;

    const totalFixedExpenses = context.expenses.reduce((sum, e) => sum + e.amount, 0);
    const leisureBudget = context.config.leisureBudget || 0;
    const projectSavings = context.config.projectSavings || 0;
    const theoreticalSavingsCapacity = superNet - totalFixedExpenses - leisureBudget - projectSavings;

    const totalOwned = context.accounts.reduce((sum, a) => sum + a.ownedAmount, 0);
    const totalParental = context.accounts.reduce((sum, a) => sum + a.parentalCapital, 0);
    const liquidSavings = context.accounts.filter(a => !a.contractEndDate && ![AccountType.IMMOBILIER, AccountType.PER, AccountType.PEE].includes(a.type)).reduce((sum, a) => sum + a.ownedAmount, 0);
    let survivalStr = totalFixedExpenses > 0 ? `${Math.floor(liquidSavings/totalFixedExpenses)} mois` : "Infinie";

    // --- 2. FORMATAGE ---
    const accountsDetails = context.accounts.map(acc => {
      let ceilingVal = 0;
      if (acc.type === AccountType.LIVRET_A) ceilingVal = fiscalConfig.ceilings.livretA;
      if (acc.type === AccountType.LDDS) ceilingVal = fiscalConfig.ceilings.ldds;
      if (acc.type === AccountType.LEP) ceilingVal = fiscalConfig.ceilings.lep;
      const fillPct = ceilingVal > 0 ? `(${(acc.totalAmount/ceilingVal*100).toFixed(1)}% de ${ceilingVal}€)` : "";
      return `   - [${acc.type}] "${acc.name}" ${fillPct}:
         > TOTAL: ${acc.totalAmount} € (Moi: ${acc.ownedAmount} | Parents: ${acc.parentalCapital})
         > Dispo: ${getAvailabilityInfo(acc, fiscalConfig)}`;
    }).join('\n');

    const systemInstruction = `
    RÔLE : Expert Patrimoine (Prudence Absolue).
    
    PARAMÈTRES SOCIAUX :
    - Navigo : Gain +${navigoGain.toFixed(2)}€/mois
    - Mutuelle : Coût -${mutuelleCost.toFixed(2)}€/mois
    - Tickets Resto : Coût -${swileCost.toFixed(2)}€/mois

    1. REVENUS NETS RÉELS :
       - Net Avant Impôt (inclut primes/transport) : ${netBeforeTax.toFixed(2)} €
       - Impôt : -${effectiveMonthlyTax.toFixed(2)} €
       - Prélèvements Sociaux (Mutuelle/Swile) : -${(mutuelleCost + swileCost).toFixed(2)} €
       = SUPER NET (Vrai Reste à Vivre) : ${superNet.toFixed(2)} €

    2. CAPACITÉ D'ÉPARGNE :
       - Super Net : ${superNet.toFixed(2)} €
       - Charges Fixes : -${totalFixedExpenses.toFixed(2)} €
       - Plaisir/Projets : -${(leisureBudget + projectSavings).toFixed(2)} €
       = ÉPARGNE DISPONIBLE : ${theoreticalSavingsCapacity.toFixed(2)} € / mois

    3. PATRIMOINE :
       - Capital Parents (INTOUCHABLE) : ${totalParental.toLocaleString()} €
       - Mon Capital : ${totalOwned.toLocaleString()} €
       - Survie : ${survivalStr}

    4. COMPTES :
    ${accountsDetails}

    Utilise ces chiffres précis. Si je demande mon salaire net, donne le "Super Net" en expliquant les déductions Mutuelle/Swile.
    `;

    const historyForGemini = context.history.map(msg => ({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.content }] }));
    const chat = model.startChat({ history: [{ role: "user", parts: [{ text: `SYSTÈME : ${systemInstruction}` }] }, { role: "model", parts: [{ text: "Compris. J'ai intégré les coûts de mutuelle et tickets restaurant." }] }, ...historyForGemini] });
    const result = await chat.sendMessage(userPrompt);
    return (await result.response).text();

  } catch (error: any) {
    console.error("Erreur Gemini:", error);
    return "Erreur technique IA.";
  }
};