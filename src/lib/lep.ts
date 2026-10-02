// Éligibilité au LEP dans le temps (service-public.gouv.fr, fiche F2367) : la banque contrôle
// chaque année le revenu fiscal de référence (RFR) de l'année N-2. Un dépassement isolé est
// toléré ; deux années de revenus CONSÉCUTIVES au-dessus du plafond entraînent la fermeture
// obligatoire du livret, en pratique au printemps (au plus tard vers le 30 avril) de la
// deuxième année qui suit la seconde année de revenus trop élevés.
import { AccountType, FiscalConfig, GlobalAppData } from '../types';
import { computeIncome } from './finance';
import { DEFAULT_WORK_BENEFITS } from '../constants';

export interface LepIncomeYear { year: number; rfr: number; source: 'avis' | 'fiches' | 'estimation' }

export type LepTimelineStatus = 'ok' | 'watch' | 'one-over' | 'closing' | 'closed-due';

export interface LepTimeline {
  ceiling: number;
  years: (LepIncomeYear & { over: boolean })[];
  status: LepTimelineStatus;
  /** Année de revenus du premier dépassement de la paire (ou du dépassement isolé). */
  overYear?: number;
  /** Date approximative de fermeture par la banque (ISO). */
  closeBy?: string;
  /** La fermeture repose sur une estimation (pas encore sur des avis d'imposition). */
  estimated: boolean;
}

/** Fermeture : printemps de la 2e année qui suit la seconde année de revenus au-dessus. */
export const lepClosureDate = (secondOverYear: number) => `${secondOverYear + 2}-04-30`;

/** RFR approché à partir du net imposable annuel (abattement de 10 % plafonné et minimum). */
export const rfrFromNetTaxable = (netTaxable: number, cap = 14555, min = 509) =>
  Math.max(0, netTaxable - Math.min(cap, Math.max(Math.min(min, netTaxable), netTaxable * 0.1)));

/**
 * Revenus de chaque année : l'avis d'imposition saisi fait foi, sinon la somme des fiches
 * de paie (au moins 6 mois, ramenée à 12), sinon l'estimation de l'année en cours.
 */
export const buildLepIncomeYears = (
  data: Pick<GlobalAppData, 'payslips' | 'config'>,
  asOf: Date,
  currentYearEstimate?: number,
  allowance?: { cap?: number; min?: number },
): LepIncomeYear[] => {
  const Y = asOf.getFullYear();
  const avis = (data.config as { rfrByYear?: Record<string, number> }).rfrByYear || {};
  const out: LepIncomeYear[] = [];
  for (let y = Y - 3; y <= Y; y++) {
    const fromAvis = avis[String(y)];
    if (typeof fromAvis === 'number' && fromAvis > 0) { out.push({ year: y, rfr: fromAvis, source: 'avis' }); continue; }
    const slips = (data.payslips || []).filter(p => p.extracted?.period?.startsWith(`${y}-`) && (p.extracted.netTaxable || 0) > 0);
    const months = new Set(slips.map(p => p.extracted.period)).size;
    if (months >= 6) {
      const net = slips.reduce((s, p) => s + (p.extracted.netTaxable || 0), 0) * (12 / months);
      out.push({ year: y, rfr: Math.round(rfrFromNetTaxable(net, allowance?.cap, allowance?.min)), source: 'fiches' });
      continue;
    }
    if (y === Y && currentYearEstimate && currentYearEstimate > 0) out.push({ year: y, rfr: Math.round(currentYearEstimate), source: 'estimation' });
  }
  return out;
};

export const computeLepTimeline = (
  accounts: { type: AccountType }[],
  incomes: LepIncomeYear[],
  ceiling: number | undefined,
  asOf: Date = new Date(),
): LepTimeline | null => {
  if (!accounts.some(a => a.type === AccountType.LEP) || !ceiling || ceiling <= 0 || incomes.length === 0) return null;
  const years = [...incomes].sort((a, b) => a.year - b.year).map(i => ({ ...i, over: i.rfr > ceiling }));
  const today = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')}`;

  // Dernière paire d'années consécutives au-dessus du plafond.
  for (let i = years.length - 1; i > 0; i--) {
    const a = years[i - 1], b = years[i];
    if (a.over && b.over && b.year === a.year + 1) {
      const closeBy = lepClosureDate(b.year);
      return { ceiling, years, status: today > closeBy ? 'closed-due' : 'closing', overYear: a.year, closeBy, estimated: a.source !== 'avis' || b.source !== 'avis' };
    }
  }
  const last = years[years.length - 1];
  const lastOver = [...years].reverse().find(y => y.over);
  // Dépassement isolé récent : la fermeture dépend de l'année suivante.
  if (lastOver && lastOver.year >= asOf.getFullYear() - 2) {
    const next = years.find(y => y.year === lastOver.year + 1);
    if (!next || next.over) {
      return { ceiling, years, status: 'one-over', overYear: lastOver.year, closeBy: lepClosureDate(lastOver.year + 1), estimated: lastOver.source !== 'avis' };
    }
  }
  if (last && !last.over && (ceiling - last.rfr) / ceiling < 0.1) return { ceiling, years, status: 'watch', estimated: last.source !== 'avis' };
  return { ceiling, years, status: 'ok', estimated: false };
};

const frDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

/** Phrase à afficher (accueil, notification). `null` quand tout va bien. */
export const describeLepTimeline = (t: LepTimeline | null): { title: string; detail: string } | null => {
  if (!t || t.status === 'ok') return null;
  const src = t.estimated ? ' (estimation : importez votre avis d\'imposition dans Paramètres pour un calcul exact)' : '';
  switch (t.status) {
    case 'closed-due':
      return { title: 'LEP : vous n\'y avez plus droit', detail: `Vos revenus ${t.overYear} et ${t.overYear! + 1} dépassent le plafond (${eur(t.ceiling)}). Votre banque devait le fermer vers le ${frDate(t.closeBy!)}. Prévoyez où placer ce montant (Livret A, LDDS) : les intérêts acquis vous restent.${src}` };
    case 'closing':
      return { title: `LEP : fermeture prévue vers le ${frDate(t.closeBy!)}`, detail: `Vos revenus ${t.overYear} et ${t.overYear! + 1} dépassent le plafond (${eur(t.ceiling)}) deux années de suite : la banque devra fermer votre LEP. Préparez un autre livret pour cette somme.${src}` };
    case 'one-over':
      return { title: `LEP : revenus ${t.overYear} au-dessus du plafond`, detail: `Un dépassement isolé est toléré. Si vos revenus ${t.overYear! + 1} dépassent aussi ${eur(t.ceiling)}, le LEP sera fermé vers le ${frDate(t.closeBy!)}.${src}` };
    case 'watch':
      return { title: 'LEP : revenus proches du plafond', detail: `Il reste moins de 10 % de marge sous ${eur(t.ceiling)}. Au-delà deux années de suite, le livret est fermé.${src}` };
  }
  return null;
};

/** Plafond de RFR du foyer : plafond pour une part, plus un montant par demi-part. */
export const lepHouseholdCeiling = (fiscal: FiscalConfig | undefined): number | undefined => {
  const base = fiscal?.lepIncomeCeiling;
  if (!base) return undefined;
  const parts = fiscal?.lepHouseholdParts && fiscal.lepHouseholdParts > 0 ? fiscal.lepHouseholdParts : 1;
  return base + Math.max(0, Math.round((parts - 1) * 2)) * (fiscal?.lepCeilingPerHalfPart ?? 0);
};

/** Tout le calcul depuis les données de l'app (accueil, agenda, notifications du serveur). */
export const lepTimelineFromData = (data: GlobalAppData, asOf: Date = new Date()): LepTimeline | null => {
  const fiscal = data.fiscalConfig;
  const ceiling = lepHouseholdCeiling(fiscal);
  if (!ceiling || !fiscal) return null;
  const c = data.config;
  const estimate = c?.grossAnnual > 0
    ? computeIncome({ grossAnnual: c.grossAnnual, extraMonthlyIncome: 0, navigoBase: c.navigoBase ?? 0, navigoRate: c.navigoRate ?? 0, taxRateManual: 0 }, fiscal, data.workBenefits ?? DEFAULT_WORK_BENEFITS).netTaxableYear
    : undefined;
  const years = buildLepIncomeYears(data, asOf, estimate, { cap: fiscal.standardAllowanceCap, min: fiscal.standardAllowanceMin });
  return computeLepTimeline(data.accounts || [], years, ceiling, asOf);
};
