// ================================================
// FILE: src/lib/accountTypes.ts
// Catalogue des types de compte : nom affiché, plafond par défaut et règle fiscale en mots
// simples (fiche du compte, Mes comptes). Les règles elles-mêmes vivent dans lib/finance
// (capitalTax, availability) : ce fichier ne fait que les dire. Fonctions pures, testées.
// ================================================
import { AccountType, FiscalConfig, SavingsAccount } from '../types';
import { round2 } from './money';
import { PFU_INCOME_TAX_RATE, isHousingSavingsIncomeTaxExempt, socialChargesRateFor, PEL_DEPOSIT_CEILING, CEL_DEPOSIT_CEILING } from './finance';

// Plafonds légaux de l'épargne logement : définis avec le plan de placement, qui s'en sert.
export { PEL_DEPOSIT_CEILING, CEL_DEPOSIT_CEILING };

/** Nom affiché dans la liste « Type » (la valeur enregistrée reste celle de l'enum). */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  [AccountType.LIVRET_A]: 'Livret A',
  [AccountType.LDDS]: 'LDDS',
  [AccountType.LEP]: 'LEP',
  [AccountType.LIVRET_BANCAIRE]: 'Livret bancaire (imposé)',
  [AccountType.CEL]: 'CEL (compte épargne logement)',
  [AccountType.PEL]: 'PEL (plan épargne logement)',
  [AccountType.COMPTE_A_TERME]: 'Compte à terme',
  [AccountType.COMPTE_COURANT]: 'Compte courant',
  [AccountType.PEA]: 'PEA',
  [AccountType.CTO]: 'Compte-titres (CTO)',
  [AccountType.PER]: 'PER (épargne retraite)',
  [AccountType.ASSURANCE_VIE]: 'Assurance vie',
  [AccountType.PEE]: 'PEE (épargne salariale)',
  [AccountType.CRYPTO]: 'Crypto',
  [AccountType.IMMOBILIER]: 'Immobilier',
  [AccountType.AUTRE]: 'Autre',
};

/** Plafond proposé à la création d'un compte (0 : pas de plafond). */
export const defaultCeiling = (type: AccountType, cfg: Pick<FiscalConfig, 'ceilings'>): number => {
  switch (type) {
    case AccountType.LIVRET_A: return cfg.ceilings.livretA;
    case AccountType.LDDS: return cfg.ceilings.ldds;
    case AccountType.LEP: return cfg.ceilings.lep;
    case AccountType.PEL: return PEL_DEPOSIT_CEILING;
    case AccountType.CEL: return CEL_DEPOSIT_CEILING;
    default: return 0;
  }
};

/** Le plafond a un sens pour ce type (livrets, épargne logement, compte « Autre »). */
export const hasCeiling = (type: AccountType): boolean =>
  [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP, AccountType.LIVRET_BANCAIRE, AccountType.CEL, AccountType.PEL, AccountType.AUTRE].includes(type);

const pct = (fraction: number) => `${(Math.round(fraction * 1000) / 10).toLocaleString('fr-FR')} %`;

/**
 * Règle fiscale et disponibilité du compte, en une ou deux phrases (taux des paramètres
 * fiscaux, régime de l'épargne logement selon la date d'ouverture à `asOf`).
 */
export const describeAccountTax = (
  account: { type: AccountType; openingDate?: string },
  cfg: FiscalConfig,
  asOf: Date = new Date(),
): string => {
  const ps = pct(socialChargesRateFor(account.type, cfg));
  const ir = pct(PFU_INCOME_TAX_RATE);
  switch (account.type) {
    case AccountType.LIVRET_A:
    case AccountType.LDDS:
    case AccountType.LEP:
      return "Intérêts sans impôt ni prélèvements sociaux. Disponible à tout moment.";
    case AccountType.LIVRET_BANCAIRE:
    case AccountType.COMPTE_COURANT:
      return `Intérêts imposés chaque année : ${ir} d'impôt et ${ps} de prélèvements sociaux, retenus par la banque. Disponible à tout moment.`;
    case AccountType.COMPTE_A_TERME:
      return `Intérêts imposés : ${ir} d'impôt et ${ps} de prélèvements sociaux. Argent compté comme bloqué jusqu'à l'échéance (une sortie anticipée réduit les intérêts).`;
    case AccountType.AUTRE:
      return `Compté comme disponible, intérêts imposés (${ir} d'impôt et ${ps} de prélèvements sociaux). Cochez « Argent bloqué » s'il ne peut pas être retiré.`;
    case AccountType.CEL:
    case AccountType.PEL: {
      const exempt = isHousingSavingsIncomeTaxExempt(account, asOf);
      const regime = !account.openingDate
        ? `Date d'ouverture inconnue : Pécule compte ${ir} d'impôt, comme pour un plan ouvert depuis 2018.`
        : exempt
          ? `Ouvert avant 2018 : intérêts sans impôt sur le revenu${account.type === AccountType.PEL ? ' pendant 12 ans' : ''}.`
          : `Intérêts imposés chaque année : ${ir} d'impôt.`;
      const access = account.type === AccountType.PEL
        ? "Un retrait avant 4 ans clôture le plan : Pécule le compte comme bloqué jusque-là."
        : 'Retraits libres (gardez 300 € sur le compte).';
      return `${regime} Prélèvements sociaux : ${ps}. ${access}`;
    }
    // Compte-titres : dividendes et intérêts imposés l'année où ils sont versés (12,8 % retenus
    // à l'avance par la banque, à valoir sur l'impôt), plus-values seulement à la vente.
    // Vérifié le 2026-10-23 : https://entreprendre.service-public.gouv.fr/vosdroits/F32963
    // (prélèvement de 12,8 % à titre d'acompte, PFU 31,4 % dont 18,6 % de prélèvements sociaux)
    // et https://www.impots.gouv.fr/particulier/questions/jai-realise-une-plus-value-mobiliere-comment-est-elle-imposee
    case AccountType.CTO:
      return `Dividendes et intérêts imposés chaque année : ${ir} d'impôt (retenus à l'avance par la banque) et ${ps} de prélèvements sociaux. Plus-values imposées seulement quand vous vendez, aux mêmes taux. Notez vos versements pour suivre la performance.`;
    case AccountType.CRYPTO:
      return `Gains imposés seulement quand vous vendez : ${ir} d'impôt et ${ps} de prélèvements sociaux sur la plus-value. Notez vos versements pour suivre la performance.`;
    case AccountType.PEA:
      return `Gains sans impôt sur le revenu après 5 ans (avant : ${ir} et clôture du plan) ; ${ps} de prélèvements sociaux au retrait.`;
    case AccountType.ASSURANCE_VIE:
      return `Gains imposés au retrait seulement, avec un impôt réduit après 8 ans ; prélèvements sociaux : ${ps}.`;
    case AccountType.PER:
      return "Vos versements sont déduits de votre revenu imposable, dans la limite d'un plafond (économie chiffrée dans Rendement). Bloqué jusqu'à la retraite, sauf cas prévus par la loi.";
    case AccountType.PEE:
      return `Gains sans impôt sur le revenu ; ${ps} de prélèvements sociaux. Chaque versement est bloqué 5 ans.`;
    case AccountType.IMMOBILIER:
      return 'Valeur estimée, comptée comme bloquée. Fiscalité non calculée par Pécule.';
    default:
      return '';
  }
};

/** Total des comptes portant une étiquette (un projet : voyage, apport…), votre part et celle des parents. */
export const totalsForTag = (accounts: Pick<SavingsAccount, 'tags' | 'ownedAmount' | 'parentalCapital'>[], tag: string): { owned: number; parental: number; count: number } => {
  const tagged = accounts.filter(a => (a.tags || []).includes(tag));
  return {
    owned: round2(tagged.reduce((s, a) => s + a.ownedAmount, 0)),
    parental: round2(tagged.reduce((s, a) => s + a.parentalCapital, 0)),
    count: tagged.length,
  };
};
