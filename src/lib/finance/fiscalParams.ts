// Paramètres fiscaux : barèmes, vérification annuelle, migration, nettoyage.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { FiscalConfig, TaxBracket, AccountMovement } from '../../types';
import { DEFAULT_STANDARD_ALLOWANCE_CAP, DEFAULT_STANDARD_ALLOWANCE_MIN, DEFAULT_DECOTE, SOCIAL_CHARGES_LIFE_INSURANCE, DEFAULT_FISCAL_CONFIG, TAX_SCALES, LATEST_TAX_SCALE, TaxScale } from '../../constants';
import { formatISODay } from '../dates';

// ---------------------------------------------------------------------------
// Paramètres fiscaux : nouveau barème, vérification annuelle
// ---------------------------------------------------------------------------

// Infinity devient `null` une fois passé par le JSON du fichier Drive.
const bracketLimit = (b: TaxBracket) => (b.limit === null || b.limit === undefined ? Infinity : b.limit);
export const sameTaxBrackets = (a: TaxBracket[], b: TaxBracket[]) =>
  a.length === b.length && a.every((x, i) => bracketLimit(x) === bracketLimit(b[i]) && Math.abs(x.rate - b[i].rate) < 1e-9);

/** Barème officiel correspondant exactement au barème utilisé, s'il y en a un. */
export const identifyTaxScale = (brackets: TaxBracket[]): TaxScale | undefined =>
  TAX_SCALES.find(sc => sameTaxBrackets(sc.brackets, brackets));

export interface FiscalReview {
  newScale?: TaxScale;      // barème officiel plus récent que celui utilisé
  annualCheckDue: boolean;  // janvier à mars : paramètres de l'année pas encore vérifiés
}

export const findFiscalReview = (cfg: FiscalConfig, asOfDate: Date = new Date()): FiscalReview => {
  const current = identifyTaxScale(cfg.taxBrackets);
  const usedYear = current?.year ?? cfg.taxScaleYear;
  const newScale = !sameTaxBrackets(cfg.taxBrackets, LATEST_TAX_SCALE.brackets) && (usedYear === undefined || usedYear < LATEST_TAX_SCALE.year)
    ? LATEST_TAX_SCALE : undefined;
  const annualCheckDue = asOfDate.getMonth() <= 2 && (cfg.paramsReviewedYear ?? 0) < asOfDate.getFullYear();
  return { newScale, annualCheckDue };
};

/** Applique un barème officiel en gardant l'ancien dans l'historique. */
export const applyTaxScale = (cfg: FiscalConfig, scale: TaxScale, asOfDate: Date = new Date()): FiscalConfig => ({
  ...cfg,
  taxBrackets: scale.brackets.map(b => ({ ...b })),
  taxScaleYear: scale.year,
  ...(scale.decote ? { decote: { ...scale.decote } } : {}),
  ...(scale.allowanceCap ? { standardAllowanceCap: scale.allowanceCap } : {}),
  ...(scale.allowanceMin ? { standardAllowanceMin: scale.allowanceMin } : {}),
  taxBracketsHistory: [
    ...(cfg.taxBracketsHistory || []),
    { year: identifyTaxScale(cfg.taxBrackets)?.year ?? cfg.taxScaleYear, replacedOn: formatISODay(asOfDate), brackets: cfg.taxBrackets },
  ],
});

/**
 * Mise à niveau des paramètres fiscaux d'un ancien fichier : champs ajoutés depuis, et
 * prélèvements sociaux 2026 (17,2 % → 18,6 %, l'assurance vie restant à 17,2 %). Ne touche
 * à une valeur que si elle vaut exactement l'ancienne valeur légale, jamais à un réglage
 * personnalisé.
 */
export const migrateFiscalConfig = (cfg: FiscalConfig): FiscalConfig => {
  const out: FiscalConfig = { ...cfg };
  if (out.socialChargesLifeInsurance === undefined) {
    out.socialChargesLifeInsurance = SOCIAL_CHARGES_LIFE_INSURANCE;
    if (Math.abs(out.socialChargesCapital - 0.172) < 1e-9) out.socialChargesCapital = DEFAULT_FISCAL_CONFIG.socialChargesCapital;
  }
  if (!out.decote) out.decote = { ...DEFAULT_DECOTE };
  if (out.standardAllowanceMin === undefined) out.standardAllowanceMin = DEFAULT_STANDARD_ALLOWANCE_MIN;
  if (out.standardAllowanceCap === undefined || out.standardAllowanceCap === 14171 || out.standardAllowanceCap === 14426) out.standardAllowanceCap = DEFAULT_STANDARD_ALLOWANCE_CAP;
  if (out.lepIncomeCeiling === 22419 || out.lepIncomeCeiling === 22823) out.lepIncomeCeiling = DEFAULT_FISCAL_CONFIG.lepIncomeCeiling;
  if (out.lepCeilingPerHalfPart === undefined) out.lepCeilingPerHalfPart = DEFAULT_FISCAL_CONFIG.lepCeilingPerHalfPart;
  if (out.donation75Ceiling === undefined || out.donation75Ceiling === 1000) out.donation75Ceiling = DEFAULT_FISCAL_CONFIG.donation75Ceiling;
  return out;
};

// ---------------------------------------------------------------------------
// Nettoyage des données au chargement
// ---------------------------------------------------------------------------

const cleanLabel = (s: string | undefined) => (s || '').trim().replace(/\s+/g, ' ');

/** Noms et établissements sans espaces superflus (« BPVF » et « BPVF  » faisaient deux banques). */
export const normalizeAccounts = <T extends { name: string; institution: string; movements?: AccountMovement[] }>(accounts: T[]): T[] =>
  accounts.map(a => ({ ...a, name: cleanLabel(a.name), institution: cleanLabel(a.institution), movements: a.movements || [] }));

/**
 * Un seul point par mois (le plus récent) : d'anciennes versions en enregistraient
 * plusieurs, d'où des mois répétés dans l'historique.
 */
export const dedupeMonthlySnapshots = <T extends { date: string }>(snapshots: T[]): T[] => {
  const byMonth = new Map<string, T>();
  for (const s of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) byMonth.set(s.date.slice(0, 7), s);
  return [...byMonth.values()];
};
