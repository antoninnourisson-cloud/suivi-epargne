// ================================================
// FILE: src/lib/taxReturn.ts
// Aide à la déclaration de revenus : ce qu'il faut vérifier ou reporter, case par case, à
// partir des données de l'app (fiches de paie, comptes, mouvements, dons). Saison de la
// déclaration (rappel de l'accueil, de l'agenda et du serveur). Fonctions pures, testées.
//
// Cases, seuils et règles vérifiés sur les sources officielles (octobre 2026) :
// - Intérêts : brochure pratique IR 2026, revenus de capitaux mobiliers, p. 121 et 127-134
//   https://www.impots.gouv.fr/www2/fichiers/documentation/brochure/ir_2026/pdf_som/08-RCM_121a136.pdf
//   2TR = intérêts des livrets bancaires fiscalisés, comptes de dépôt et comptes à terme ;
//   Livret A, LEP, LDDS, livret jeune exonérés (« ne déclarez pas ») ; montants préremplis
//   d'après le relevé de l'établissement payeur établi en France ; établissement à l'étranger :
//   formulaire 2047 ; acompte de 12,8 % (prélèvement forfaitaire non libératoire) « en principe
//   prérempli case 2CK », imputé sur l'impôt et l'excédent restitué ; option barème : case 2OP.
//   Dispense de l'acompte (revenu fiscal de référence N-2 < 25 000 € seul, 50 000 € couple,
//   demande avant le 30 novembre) : https://www.service-public.gouv.fr/particuliers/vosdroits/F2613
// - PER : brochure IR 2026, charges déductibles, p. 225-236 (6NS déclarant 1, 6NT déclarant 2,
//   6NU personne à charge ; plafond « épargne retraite » imprimé sur la déclaration)
//   https://www.impots.gouv.fr/www2/fichiers/documentation/brochure/ir_2026/pdf_som/12-charges_ded_rev_225a236.pdf
//   et https://www.service-public.gouv.fr/particuliers/vosdroits/F14709 (plafond sur l'avis
//   d'impôt ; versements volontaires à titre individuel).
// - Comptes à l'étranger : case 8UU puis formulaire 3916-3916 bis, amende de 1 500 € par
//   compte bancaire non déclaré (10 000 € dans un État non coopératif) :
//   https://www.service-public.gouv.fr/particuliers/actualites/A18891 ; comptes d'actifs
//   numériques (3916-bis) : https://www.impots.gouv.fr/actualite/modalites-de-declaration-des-comptes-dactifs-numeriques-detenus-letranger ;
//   amende de 750 € par compte, 1 500 € si leur valeur dépasse 50 000 € (CGI art. 1649 bis C
//   et 1736 X, notice du formulaire 3916 de mars 2026 :
//   https://www.impots.gouv.fr/sites/default/files/formulaires/3916/2026/3916_5454.pdf).
//   Indice donné par service-public : un IBAN qui ne commence pas par FR.
// - Crypto : annexe 2086, plus-value case 3AN, moins-value case 3BN ; exonération si le total
//   des prix de cession de l'année ne dépasse pas 305 € (hors échanges entre cryptos, en sursis) :
//   https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-plus-ou-moins-values-sur-cessions-dactifs-numeriques ;
//   sous 305 €, l'annexe reste à remplir avec le seul prix de chaque cession (BOFiP
//   BOI-RPPM-PVBMC-30-30-20240423 § 40) ; calcul : prix de cession − prix total d'acquisition ×
//   prix de cession / valeur globale du portefeuille (BOI-RPPM-PVBMC-30-20).
// - Calendrier : 2026, ouverture en ligne le 9 avril, dates limites du 21 mai au 4 juin selon
//   le département (https://www.service-public.gouv.fr/particuliers/actualites/A15597 et
//   https://www.impots.gouv.fr/toutes-les-questions/particulier/quelle-date-dois-je-faire-ma-declaration).
//   Le calendrier de l'année suivante n'est publié qu'au printemps : formulation prudente.
// ================================================
import { AccountMovement, AccountType, GlobalAppData, SavingsAccount } from '../types';
import { computeAccruedInterest, computeDonationSummary, cryptoDisposalsOfYear, CRYPTO_EXEMPT_DISPOSALS, hasTaxableYearlyInterest, isInitialBalance } from './finance';
import { formatEUR } from './format';

export type TaxReturnSection = 'income' | 'savings' | 'deductions' | 'abroad' | 'crypto';

export interface TaxReturnLine {
  /** Clé stable (liste React, tests, résumé). */
  id: string;
  section: TaxReturnSection;
  box: string;          // case ou formulaire (ex. « 1AJ », « 8UU · 3916 »)
  label: string;
  amount?: number;
  note: string;
  // exact : à reporter tel quel ; estimate : calculé par l'app, à comparer ; todo : démarche
  // à faire ; check : à vérifier (l'app ne peut pas savoir) ; info : à savoir.
  confidence: 'exact' | 'estimate' | 'todo' | 'check' | 'info';
  link?: { label: string; url: string };
  /** Résumé court pour les rappels (« vos salaires (1AJ) ») ; absent = pas dans le résumé. */
  topic?: string;
}

export const TAX_RETURN_SECTIONS: { id: TaxReturnSection; title: string }[] = [
  { id: 'income', title: 'Salaires' },
  { id: 'savings', title: 'Intérêts et placements' },
  { id: 'deductions', title: 'Réductions et déductions' },
  { id: 'abroad', title: "Comptes à l'étranger" },
  { id: 'crypto', title: 'Cryptomonnaies' },
];

/** Pages officielles citées par l'aide (vérifiées en octobre 2026). */
export const TAX_LINKS = {
  declaration: { label: 'La déclaration de revenus (service-public.fr)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F358' },
  deadlines: { label: 'Dates limites (impots.gouv.fr)', url: 'https://www.impots.gouv.fr/toutes-les-questions/particulier/quelle-date-dois-je-faire-ma-declaration' },
  realExpenses: { label: 'Forfait ou frais réels (service-public.fr)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1989' },
  savingsIncome: { label: "Revenus d'épargne (service-public.fr)", url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2613' },
  per: { label: 'Épargne retraite (service-public.fr)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F14709' },
  donations: { label: 'Dons aux associations (service-public.fr)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F426' },
  foreignAccounts: { label: "Comptes à l'étranger (service-public.fr)", url: 'https://www.service-public.gouv.fr/particuliers/actualites/A18891' },
  cryptoAccounts: { label: "Comptes crypto à l'étranger (impots.gouv.fr)", url: 'https://www.impots.gouv.fr/actualite/modalites-de-declaration-des-comptes-dactifs-numeriques-detenus-letranger' },
  cryptoSales: { label: 'Ventes de crypto (impots.gouv.fr)', url: 'https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-plus-ou-moins-values-sur-cessions-dactifs-numeriques' },
} as const;

/** Total annuel des prix de cession de crypto en dessous duquel les ventes sont exonérées. */
export const CRYPTO_EXEMPT_DISPOSALS_TOTAL = CRYPTO_EXEMPT_DISPOSALS;
/** Acompte d'impôt retenu par la banque sur les intérêts imposables (prélèvement non libératoire). */
export const INTEREST_WITHHOLDING_RATE = 0.128;

/** Dates de la campagne, sans chiffre inventé : le calendrier exact sort au printemps. */
export const TAX_RETURN_CALENDAR_TEXT = 'La déclaration en ligne ouvre en avril ; la date limite tombe fin mai ou début juin selon votre département.';

/**
 * Établissements souvent établis à l'étranger : un compte chez eux est probablement à
 * déclarer (3916 ou 3916-bis). Simple indice, l'utilisateur confirme sur la fiche du compte.
 */
const LIKELY_FOREIGN = /\b(revolut|n26|wise|bunq|trade\s?republic|degiro|interactive\s?brokers|scalable|binance|kraken|coinbase|bitpanda|crypto\.com|bybit|etoro)\b/i;

/** Mouvement d'argent réellement versé ou retiré (ni valorisation, ni part des parents, ni correction). */
const isCashFlow = (m: AccountMovement) => !m.kind && !isInitialBalance(m);

const inYear = (m: AccountMovement, year: number) => m.date >= `${year}-01-01` && m.date <= `${year}-12-31`;

/** Compte existant pendant l'année (date d'ouverture inconnue : on le compte, par prudence). */
const existedIn = (a: SavingsAccount, year: number) => !a.openingDate || a.openingDate <= `${year}-12-31`;

const accountLabel = (a: SavingsAccount) => (a.institution && !a.name.toLowerCase().includes(a.institution.toLowerCase()) ? `${a.name} (${a.institution})` : a.name);
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const eur = (n: number) => formatEUR(n, 0);

/** « a, b et c ». */
export const listFr = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}`);

/** Comment répondre, dans la fiche du compte (AccountForm), pour une ligne « à vérifier ». */
const ANSWER_IN_FORM = 'Répondez à « Compte détenu à l\'étranger ? » (Oui ou Non) dans la fiche du compte, puis enregistrez.';

/** Le compte est-il à vérifier (étranger probable, mais rien n'est précisé) ? */
export const isLikelyForeignAccount = (a: Pick<SavingsAccount, 'type' | 'institution' | 'name' | 'heldAbroad'>): boolean =>
  a.heldAbroad === undefined && (a.type === AccountType.CRYPTO || LIKELY_FOREIGN.test(`${a.institution} ${a.name}`));

/**
 * Ce qu'il faut vérifier ou reporter sur la déclaration de l'année `incomeYear` (déposée
 * au printemps suivant). Les montants pré-remplis par l'administration restent la
 * référence : l'app aide à les contrôler et rappelle ce qu'elle ne pré-remplit pas.
 */
export const buildTaxReturnChecklist = (
  data: Pick<GlobalAppData, 'payslips' | 'donations' | 'accounts'>,
  incomeYear: number,
  opts: { estimatedNetTaxableBeforeAllowance?: number; allowanceRate?: number; allowanceCap?: number; ceiling75?: number } = {}
): TaxReturnLine[] => {
  const lines: TaxReturnLine[] = [];
  const accounts = (data.accounts || []).filter(a => existedIn(a, incomeYear));

  // --- Salaires ---
  const slips = (data.payslips || []).filter(p => p.extracted?.period?.startsWith(`${incomeYear}-`));
  const months = new Set(slips.map(p => p.extracted.period));
  const taxable = slips.reduce((s, p) => s + (p.extracted.netTaxable || 0), 0);
  if (months.size > 0 && taxable > 0) {
    lines.push({
      id: 'salary', section: 'income', box: '1AJ', label: 'Salaires', amount: Math.round(taxable), confidence: months.size >= 12 ? 'exact' : 'estimate',
      note: months.size >= 12 ? 'Somme des nets imposables de vos 12 fiches : comparez au montant pré-rempli.'
        : `Somme de ${months.size} fiche${months.size > 1 ? 's' : ''} sur 12 : le cumul « net imposable » de votre fiche de décembre fait foi.`,
      link: TAX_LINKS.declaration, topic: 'vos salaires (1AJ)',
    });
  } else if (opts.estimatedNetTaxableBeforeAllowance) {
    lines.push({ id: 'salary', section: 'income', box: '1AJ', label: 'Salaires', amount: Math.round(opts.estimatedNetTaxableBeforeAllowance), confidence: 'estimate',
      note: 'Estimation depuis les salaires saisis dans le Pilotage. Le cumul « net imposable » de votre fiche de décembre fait foi.',
      link: TAX_LINKS.declaration, topic: 'vos salaires (1AJ)' });
  }
  const withheld = slips.reduce((s, p) => s + (p.extracted.incomeTaxWithheld || 0), 0);
  if (withheld > 0) {
    lines.push({ id: 'withheld', section: 'income', box: '8HV', label: 'Impôt déjà prélevé à la source', amount: Math.round(withheld), confidence: months.size >= 12 ? 'exact' : 'estimate',
      note: 'Pré-rempli par l\'administration ; sert à calculer le solde à payer ou à rembourser.', link: TAX_LINKS.declaration });
  }
  const base = lines.find(l => l.id === 'salary')?.amount;
  if (base && opts.allowanceRate) {
    const allowance = Math.min(base * opts.allowanceRate, opts.allowanceCap ?? Infinity);
    lines.push({ id: 'real-expenses', section: 'income', box: '1AK', label: 'Frais réels (facultatif)', confidence: 'info',
      note: `L'abattement automatique de 10 % vaut environ ${Math.round(allowance).toLocaleString('fr-FR')} €. Déclarez vos frais réels (trajets, repas…) seulement s'ils dépassent ce montant.`,
      link: TAX_LINKS.realExpenses });
  }

  // --- Intérêts imposables (2TR, 2CK) ---
  // Intérêts de l'année entière, sur le solde total du compte : c'est ce que la banque
  // déclare au nom du titulaire, part des parents comprise.
  const interestOf = (a: SavingsAccount) => computeAccruedInterest(a, incomeYear, new Date(incomeYear + 1, 0, 1));
  // Livret bancaire, compte à terme, compte rémunéré, PEL et CEL imposés (voir capitalTax).
  const interestRows = accounts
    .filter(a => hasTaxableYearlyInterest(a, new Date(incomeYear, 11, 31)))
    .map(a => ({ a, interest: interestOf(a) }))
    .filter(r => r.interest >= 0.5);
  const local = interestRows.filter(r => !r.a.heldAbroad);
  const abroad = interestRows.filter(r => r.a.heldAbroad);
  const localTotal = local.reduce((s, r) => s + r.interest, 0);
  if (local.length > 0) {
    lines.push({
      id: 'interest', section: 'savings', box: '2TR', label: 'Intérêts imposables', amount: Math.round(localTotal), confidence: 'estimate',
      note: `Intérêts ${incomeYear} de ${listFr(local.map(r => r.a.name))}, calculés par Pécule. Votre banque les déclare : le montant est en principe pré-rempli, comparez-le à son relevé fiscal annuel. Un livret jeune est exonéré : ne le comptez pas.`,
      link: TAX_LINKS.savingsIncome, topic: 'les intérêts imposables (2TR)',
    });
    lines.push({
      id: 'interest-credit', section: 'savings', box: '2CK', label: 'Acompte de 12,8 % déjà retenu', amount: Math.round(localTotal * INTEREST_WITHHOLDING_RATE), confidence: 'estimate',
      note: 'En principe pré-rempli : la banque retient cet acompte sur les intérêts, il est déduit de votre impôt (l\'excédent vous est remboursé). Rien n\'est retenu si vous avez demandé une dispense : possible si votre revenu fiscal de référence d\'il y a deux ans est sous 25 000 € (personne seule) ou 50 000 € (couple), en le demandant à la banque avant le 30 novembre.',
      link: TAX_LINKS.savingsIncome,
    });
  }
  if (abroad.length > 0) {
    const total = abroad.reduce((s, r) => s + r.interest, 0);
    lines.push({
      id: 'interest-abroad', section: 'savings', box: '2047 → 2TR', label: "Intérêts d'un compte à l'étranger", amount: Math.round(total), confidence: 'todo',
      note: `${listFr(abroad.map(r => r.a.name))} : un établissement à l'étranger ne transmet rien aux impôts français, rien n'est pré-rempli. Déclarez ces intérêts sur le formulaire 2047, qui les reporte en case 2TR. L'acompte de 12,8 % se déclare et se paie en principe vous-même (formulaire 2778), puis se reporte en case 2CK.`,
      link: TAX_LINKS.savingsIncome, topic: "les intérêts d'un compte à l'étranger (2047)",
    });
  }
  if (interestRows.length > 0) {
    lines.push({
      id: 'interest-option', section: 'savings', box: '2OP', label: 'Imposition au barème (facultatif)', confidence: 'info',
      note: 'Par défaut, ces intérêts sont imposés à 12,8 %. Si votre tranche d\'imposition est à 0 % ou 11 %, cocher la case 2OP peut coûter moins ; ce choix vaut alors pour tous vos revenus de placement de l\'année.',
      link: TAX_LINKS.savingsIncome,
    });
  }
  const avWithdrawals = accounts.filter(a => a.type === AccountType.ASSURANCE_VIE)
    .flatMap(a => (a.movements || []).filter(m => m.type === 'OUT' && isCashFlow(m) && inYear(m, incomeYear)));
  if (avWithdrawals.length > 0) {
    lines.push({ id: 'life-insurance', section: 'savings', box: '2CH / 2DH / 2ZZ', label: 'Rachat d\'assurance vie', confidence: 'info',
      note: 'Votre assureur vous envoie un relevé fiscal au printemps : les montants sont pré-remplis, vérifiez-les avec lui.',
      link: TAX_LINKS.savingsIncome, topic: "votre retrait d'assurance vie" });
  }
  if (accounts.some(a => [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP].includes(a.type))) {
    lines.push({ id: 'livrets', section: 'savings', box: '—', label: 'Intérêts des livrets', confidence: 'info', note: 'Livret A, LDDS et LEP sont exonérés : rien à déclarer.', link: TAX_LINKS.savingsIncome });
  }

  // --- Déductions et réductions : PER, dons ---
  const pers = accounts.filter(a => a.type === AccountType.PER);
  if (pers.length > 0) {
    const deposits = pers.reduce((s, a) => s + (a.movements || [])
      .filter(m => m.type === 'IN' && isCashFlow(m) && inYear(m, incomeYear))
      .reduce((t, m) => t + m.amount, 0), 0);
    // PER ouvert ou ajouté à Pécule pendant l'année : son solde de départ peut contenir des
    // versements de l'année, que l'app ne distingue pas. On ne conclut pas « rien à déclarer ».
    const startedInYear = pers.some(a => a.openingDate?.startsWith(`${incomeYear}-`)
      || (a.movements || []).some(m => isInitialBalance(m) && inYear(m, incomeYear)));
    const startNote = `Votre solde de départ dans Pécule peut contenir des versements de ${incomeYear} : l'attestation annuelle de votre PER donne le bon montant.`;
    lines.push(deposits > 0
      ? {
        id: 'per', section: 'deductions', box: '6NS', label: 'Versements sur votre PER', amount: Math.round(deposits), confidence: 'estimate',
        note: `Versements notés dans Pécule en ${incomeYear} : l'attestation annuelle de votre PER fait foi.${startedInYear ? ` ${startNote}` : ''} Seuls vos versements volontaires comptent (pas l'abondement de l'employeur). Ils sont déduits de votre revenu dans la limite du plafond « épargne retraite » indiqué sur votre dernier avis d'impôt ; au-delà, l'excédent n'est pas déduit. Case 6NT pour le second déclarant d'un couple.`,
        link: TAX_LINKS.per, topic: 'vos versements PER (6NS)',
      }
      : startedInYear
        ? {
          id: 'per', section: 'deductions', box: '6NS', label: 'Versements sur votre PER', confidence: 'check',
          note: `Aucun versement noté en ${incomeYear} depuis l'ajout de votre PER. ${startNote} Reportez ce montant en case 6NS ; il est déduit de votre revenu dans la limite du plafond « épargne retraite » indiqué sur votre dernier avis d'impôt.`,
          link: TAX_LINKS.per, topic: 'vos versements PER (6NS)',
        }
        : {
          id: 'per', section: 'deductions', box: '6NS', label: 'Versements sur votre PER', confidence: 'info',
          note: `Aucun versement noté en ${incomeYear} : rien à déclarer en 6NS. Si vous en avez fait, reportez le montant de l'attestation de votre PER.`,
          link: TAX_LINKS.per,
        });
  }
  const don = computeDonationSummary(data.donations || [], incomeYear, { ceiling75: opts.ceiling75 });
  // 2025 : deux cases selon la date du don (plafond relevé le 14 octobre, voir finance/donations).
  const boxes75 = don.boxes75.map(b => b.box);
  for (const b of don.boxes75) {
    lines.push({
      id: don.boxes75.length > 1 ? `donations-75-${b.box}` : 'donations-75', section: 'deductions', box: b.box,
      label: `Dons aux organismes d'aide aux personnes en difficulté${b.period ? ` ${b.period}` : ''}`, amount: Math.round(b.amount), confidence: 'exact',
      note: don.boxes75.length > 1 || b.period
        ? `Réduction de 75 %, dans la limite de 1 000 € pour les dons faits jusqu'au 13 octobre ${incomeYear} et de ${formatEUR(don.ceiling75, 0)} au total sur l'année ; l'excédent passe en case 7UF. Gardez les reçus fiscaux.`
        : 'Réduction de 75 %. Gardez les reçus fiscaux.',
      link: TAX_LINKS.donations, topic: `vos dons (${[...boxes75, '7UF'].join(', ')})`,
    });
  }
  if (don.total66 > 0) lines.push({ id: 'donations-66', section: 'deductions', box: '7UF', label: 'Autres dons', amount: Math.round(don.total66), confidence: 'exact', note: 'Réduction de 66 %, dans la limite de 20 % du revenu imposable.', link: TAX_LINKS.donations, topic: `vos dons (${[...(boxes75.length ? boxes75 : ['7UD']), '7UF'].join(', ')})` });
  if (don.missingReceipts.length > 0) lines.push({ id: 'donations-receipts', section: 'deductions', box: '—', label: 'Reçus manquants', confidence: 'todo', note: `${don.missingReceipts.length} don${don.missingReceipts.length > 1 ? 's' : ''} sans reçu fiscal noté : réclamez-le avant de déclarer.`, link: TAX_LINKS.donations });

  // --- Comptes à l'étranger (8UU, 3916 / 3916-bis) ---
  for (const a of accounts) {
    if (a.heldAbroad) {
      const crypto = a.type === AccountType.CRYPTO;
      const lifeInsurance = a.type === AccountType.ASSURANCE_VIE;
      lines.push({
        id: `abroad-${a.id}`, section: 'abroad', box: crypto ? '8UU · 3916-bis' : '8UU · 3916', label: accountLabel(a), confidence: 'todo',
        note: crypto
          ? `Cochez la case 8UU, puis remplissez un formulaire 3916-bis pour ce compte : chaque année tant qu'il existe, même sans vente et même vide. Un oubli coûte 750 € d'amende par compte (1 500 € si vos comptes crypto dépassent 50 000 €).`
          : lifeInsurance
            ? 'Contrat souscrit hors de France : cochez la case 8UU, puis déclarez-le sur le formulaire 3916, chaque année tant qu\'il est en cours.'
            : `Cochez la case 8UU, puis remplissez un formulaire 3916 pour ce compte : chaque année tant qu'il est ouvert, même sans opération. Un compte fermé en ${incomeYear} se déclare aussi. Un oubli coûte 1 500 € d'amende par compte.`,
        link: crypto ? TAX_LINKS.cryptoAccounts : TAX_LINKS.foreignAccounts,
      });
    } else if (isLikelyForeignAccount(a)) {
      lines.push({
        id: `abroad-check-${a.id}`, section: 'abroad', box: a.type === AccountType.CRYPTO ? '3916-bis ?' : '3916 ?', label: `${accountLabel(a)} : établissement à l'étranger ?`, confidence: 'check',
        note: a.type === AccountType.CRYPTO
          ? `La plupart des grandes plateformes (Binance, Coinbase, Kraken…) sont établies hors de France : regardez le pays indiqué dans leurs conditions. Si c'est le cas, le compte se déclare chaque année (case 8UU et formulaire 3916-bis). Un portefeuille que vous gardez vous-même n'est pas un compte ouvert auprès d'une plateforme. ${ANSWER_IN_FORM}`
          : `Néobanque ou courtier souvent établi hors de France : si l'IBAN de ce compte ne commence pas par FR, il est sûrement tenu à l'étranger et se déclare chaque année (case 8UU et formulaire 3916). ${ANSWER_IN_FORM}`,
        link: a.type === AccountType.CRYPTO ? TAX_LINKS.cryptoAccounts : TAX_LINKS.foreignAccounts,
      });
    }
  }

  // --- Cryptomonnaies : ventes (2086, 3AN / 3BN) ---
  const cryptos = accounts.filter(a => a.type === AccountType.CRYPTO);
  if (cryptos.length > 0) {
    // Même total que l'écran Rendement et le simulateur (seuil annuel des 305 €).
    const withdrawals = cryptoDisposalsOfYear(cryptos, incomeYear);
    const gather = 'Pour chaque vente, rassemblez sa date, son prix et ses frais, la valeur totale de votre portefeuille ce jour-là, et le total de vos achats depuis le début (relevés de la plateforme).';
    if (withdrawals > 0) {
      // Les retraits notés ne sont qu'un indice des ventes : formulation conditionnelle.
      const exempt = withdrawals <= CRYPTO_EXEMPT_DISPOSALS_TOTAL;
      const notSale = 'Un retrait n\'est pas forcément une vente (envoi vers un autre portefeuille à vous, par exemple).';
      lines.push({
        id: 'crypto-sales', section: 'crypto', box: exempt ? '2086' : '2086 · 3AN / 3BN', label: 'Ventes de cryptomonnaies (retraits notés)', amount: Math.round(withdrawals), confidence: 'todo',
        note: exempt
          ? `Pécule voit ${eur(withdrawals)} retirés en ${incomeYear}, mais pas les ventes dont les euros sont restés sur la plateforme. Si le total de vos ventes de l'année ne dépasse pas 305 €, elles sont exonérées : remplissez quand même le formulaire 2086, en indiquant seulement le prix de chaque vente.`
          : `Pécule voit ${eur(withdrawals)} retirés en ${incomeYear}. ${notSale} Si vos ventes de l'année dépassent 305 € au total, la plus-value éventuelle est imposable : le formulaire 2086 la calcule et la reporte en case 3AN (une perte va en case 3BN). ${gather} Les échanges d'une crypto contre une autre ne comptent pas.`,
        link: TAX_LINKS.cryptoSales, topic: 'vos ventes de crypto (2086)',
      });
    } else {
      lines.push({
        id: 'crypto-sales', section: 'crypto', box: '2086', label: 'Ventes de cryptomonnaies', confidence: 'check',
        note: `Aucun retrait noté en ${incomeYear}. Pécule ne voit pas les ventes dont les euros sont restés sur la plateforme : si vous avez vendu contre des euros, remplissez le formulaire 2086 (même sous 305 € de ventes, où elles sont exonérées). ${gather} Les échanges d'une crypto contre une autre ne comptent pas.`,
        link: TAX_LINKS.cryptoSales,
      });
    }
  }

  return lines;
};

/**
 * Résumé des points à vérifier, pour un rappel : « vos salaires (1AJ) », « 2 comptes à
 * l'étranger (3916) »… Sans doublon, dans l'ordre de la déclaration.
 */
export const taxReturnTopics = (lines: TaxReturnLine[]): string[] => {
  const out: string[] = [];
  const add = (t: string) => { if (!out.includes(t)) out.push(t); };
  for (const l of lines) if (l.topic) add(l.topic);
  const abroad = lines.filter(l => l.section === 'abroad' && l.confidence === 'todo').length;
  if (abroad > 0) add(`${abroad} ${plural(abroad, "compte à l'étranger", "comptes à l'étranger")} (8UU)`);
  const toCheck = lines.filter(l => l.section === 'abroad' && l.confidence === 'check').length;
  if (toCheck > 0) add(`${toCheck} ${plural(toCheck, 'compte peut-être tenu', 'comptes peut-être tenus')} à l'étranger`);
  return out;
};

// ---------------------------------------------------------------------------
// Saison de la déclaration
// ---------------------------------------------------------------------------

/**
 * Du 1er avril au 10 juin : la déclaration des revenus de l'année écoulée est en cours
 * (ouverture en ligne en avril, dernières dates limites début juin). `null` hors saison.
 */
export const taxReturnSeason = (asOf: Date = new Date()): { incomeYear: number } | null => {
  const m = asOf.getMonth(), d = asOf.getDate();
  const inSeason = (m >= 3 && m <= 4) || (m === 5 && d <= 10);
  return inSeason ? { incomeYear: asOf.getFullYear() - 1 } : null;
};

export interface TaxReturnReminder {
  incomeYear: number;
  title: string;
  /** Phrase de résumé (« À vérifier : … ») suivie du calendrier. */
  detail: string;
}

/**
 * Rappel de la déclaration pour tout le monde (pas seulement les donateurs) : les points de
 * l'aide qui concernent l'utilisateur, et le calendrier en termes prudents.
 */
export const buildTaxReturnReminder = (data: Pick<GlobalAppData, 'payslips' | 'donations' | 'accounts'>, incomeYear: number): TaxReturnReminder => {
  const topics = taxReturnTopics(buildTaxReturnChecklist(data, incomeYear));
  const summary = topics.length > 0 ? `À vérifier : ${listFr(topics)}. ` : '';
  return {
    incomeYear,
    title: `Déclaration des revenus ${incomeYear}`,
    detail: `${summary}${TAX_RETURN_CALENDAR_TEXT}`,
  };
};

export type TaxReturnAlert = TaxReturnReminder & { key: string };

/** Alerte « À faire » de l'accueil pendant la saison ; `null` hors saison. */
export const buildTaxReturnAlert = (
  data: Pick<GlobalAppData, 'payslips' | 'donations' | 'accounts'>,
  asOf: Date = new Date(),
): TaxReturnAlert | null => {
  const season = taxReturnSeason(asOf);
  if (!season) return null;
  return { key: `tax-return-${season.incomeYear}`, ...buildTaxReturnReminder(data, season.incomeYear) };
};
