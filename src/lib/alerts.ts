// Moteur d'alertes unifié : chaque alerte d'optimisation dit ce qu'elle vaut en euros.
// Fonction pure (aucun accès au stockage ni à l'horloge) : l'Accueil l'affiche dans « À faire »,
// et le serveur pourrait un jour la réutiliser telle quelle (sans notification insistante).
// Les calculs viennent des aides existantes (plan de placement, restitution, taux nets,
// contrôle des fiches) : rien n'est recalculé ici à part.
import { AccountType, FiscalConfig, PayslipRecord, SavingsAccount } from '../types';
import type { View } from '../navigation';
import { REGULATED_TYPES, accountsAfterRestitution, computePlacementStrategy } from './finance';
import { netAnnualRate } from './projection';
import { detectPayslipAnomalies } from './motivation';
import { describeAnomaly } from '../components/motivation/text';
import { formatEUR, formatPeriod, formatRate, frenchDay } from './format';
import { formatISODay, parseISODate } from './dates';

export type AlertKind = 'dormant-cash' | 'livret-full' | 'better-rate' | 'restitution-room' | 'payslip-anomaly';

export interface AlertGain {
  amount: number;
  per: 'an' | 'mois' | 'once';
  /** Ce que recouvre le montant (« d'intérêts par an »…), pour les lecteurs d'écran. */
  label: string;
}

export interface Alert {
  /** Stable d'un jour à l'autre (sert au « Plus tard »). */
  id: string;
  kind: AlertKind;
  tone: 'action' | 'info';
  title: string;
  detail: string;
  gain?: AlertGain;
  action?: { label: string; view: View };
  /** Compte concerné, pour éviter un doublon avec une autre alerte de l'Accueil. */
  accountId?: string;
}

export interface AlertsInput {
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  today: Date;
  /** Dépenses du mois (charges fixes + argent plaisir) : coussin à garder sur le compte courant. */
  monthlySpending?: number;
  /** Épargne mensuelle prévue (rappel de paie, sinon capacité du Pilotage). */
  monthlyPlan?: number;
  /** false : le LEP va fermer (revenus trop élevés), il n'est plus proposé comme destination. */
  lepEligible?: boolean;
  /** Restitution du capital des parents : date prévue, et si elle est déjà faite. */
  restitution?: { plannedDate?: string; done?: boolean };
  payslips?: PayslipRecord[];
}

/** Coussin gardé sur le compte courant : 1,5 mois de dépenses. */
export const CASH_BUFFER_MONTHS = 1.5;
/** En dessous, une alerte ne vaut pas la peine d'être affichée. */
export const MIN_GAIN_PER_YEAR = 5;
export const MIN_DORMANT_EUR = 300;
/** Horizon de la prévision « livret plein », en mois. */
export const FULL_FORECAST_MONTHS = 24;

const eur = (n: number) => formatEUR(n, 0);
const fullDate = (iso: string) => `${frenchDay(parseISODate(iso))} ${parseISODate(iso).getFullYear()}`;
const listFr = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}`);

const ceilingOf = (a: SavingsAccount, fiscal: FiscalConfig): number => {
  if (a.ceiling && a.ceiling > 0) return a.ceiling;
  if (a.type === AccountType.LIVRET_A) return fiscal.ceilings.livretA;
  if (a.type === AccountType.LDDS) return fiscal.ceilings.ldds;
  if (a.type === AccountType.LEP) return fiscal.ceilings.lep;
  return 0;
};

/** Valeur annuelle d'un gain, pour classer les alertes entre elles. */
export const yearlyValue = (g?: AlertGain): number => (!g ? 0 : g.per === 'mois' ? g.amount * 12 : g.amount);

/** Actions d'abord, puis informations ; dans chaque groupe, la plus grosse somme d'abord. */
export const sortAlerts = <T extends { tone: 'action' | 'info'; gain?: AlertGain }>(alerts: T[]): T[] =>
  alerts
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      if (x.a.tone !== y.a.tone) return x.a.tone === 'action' ? -1 : 1;
      return yearlyValue(y.a.gain) - yearlyValue(x.a.gain) || x.i - y.i;
    })
    .map(({ a }) => a);

/** Comptes candidats comme destination : LEP retiré s'il va fermer. */
const usableAccounts = (input: AlertsInput) =>
  input.lepEligible === false ? input.accounts.filter(a => a.type !== AccountType.LEP) : input.accounts;

/** Place restante sous le plafond de chaque livret réglementé. */
const roomByAccount = (accounts: SavingsAccount[], fiscal: FiscalConfig) =>
  new Map(accounts.filter(a => REGULATED_TYPES.includes(a.type)).map(a => [a.id, Math.max(0, ceilingOf(a, fiscal) - a.totalAmount)]));

// ---------------------------------------------------------------------------
// Règle 1 : argent qui dort sur le compte courant
// ---------------------------------------------------------------------------

const dormantCash = (input: AlertsInput, room: Map<string, number>): Alert | null => {
  const spending = input.monthlySpending ?? 0;
  if (!(spending > 0)) return null;
  const current = input.accounts.filter(a => a.type === AccountType.COMPTE_COURANT);
  if (current.length === 0) return null;
  const cash = current.reduce((s, a) => s + Math.max(0, a.ownedAmount), 0);
  const excess = Math.floor(cash - spending * CASH_BUFFER_MONTHS);
  if (excess < MIN_DORMANT_EUR) return null;

  // Même ordre que le plan de placement (meilleur taux, puis LEP > Livret A > LDDS), sur
  // les seuls livrets : l'argent du quotidien doit rester disponible à tout moment.
  const steps = computePlacementStrategy(excess, usableAccounts(input), input.fiscalConfig)
    .filter(s => s.isLiquid && !s.infoOnly && s.fillAmount > 0);
  if (steps.length === 0) return null;
  const placed = steps.reduce((s, st) => s + st.fillAmount, 0);
  const gain = steps.reduce((s, st) => s + st.fillAmount * (st.rate || 0) / 100, 0);
  if (gain < MIN_GAIN_PER_YEAR) return null;
  for (const st of steps) if (st.accountId) room.set(st.accountId, Math.max(0, (room.get(st.accountId) || 0) - st.fillAmount));

  const names = steps.map(st => (st.accountId ? `le ${st.accountName}` : 'un LDDS à ouvrir'));
  return {
    id: 'dormant-cash',
    kind: 'dormant-cash',
    tone: 'action',
    title: `${eur(placed)} dorment sur votre compte courant : placés sur ${listFr(names)}, environ ${eur(gain)} d'intérêts par an.`,
    detail: `Pécule garde ${eur(spending * CASH_BUFFER_MONTHS)} sur le compte courant (un mois et demi de dépenses). Versé le 15 ou le dernier jour du mois, l'argent rapporte dès la quinzaine suivante.`,
    gain: { amount: gain, per: 'an', label: "d'intérêts par an" },
    action: { label: 'Voir le plan', view: 'pilot' },
  };
};

// ---------------------------------------------------------------------------
// Règle 2 : argent sur un livret moins rémunéré qu'un autre qui a de la place
// ---------------------------------------------------------------------------

const betterRate = (input: AlertsInput, room: Map<string, number>): Alert[] => {
  const usable = usableAccounts(input);
  const regulated = usable.filter(a => REGULATED_TYPES.includes(a.type));
  const out: Alert[] = [];
  const sources = [...regulated].filter(a => a.ownedAmount > 0).sort((a, b) => (a.interestRate || 0) - (b.interestRate || 0));
  for (const src of sources) {
    const rs = src.interestRate || 0;
    const target = regulated
      .filter(t => t.id !== src.id && (t.interestRate || 0) > rs + 0.001 && (room.get(t.id) || 0) > 0)
      .sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0))[0];
    if (!target) continue;
    const rt = target.interestRate || 0;
    const amount = Math.floor(Math.min(src.ownedAmount, room.get(target.id) || 0));
    const gain = amount * (rt - rs) / 100;
    if (gain < MIN_GAIN_PER_YEAR) continue;
    room.set(target.id, Math.max(0, (room.get(target.id) || 0) - amount));
    // Un virement entre livrets fait perdre une quinzaine (retrait et versement ne tombent
    // jamais sur la même borne) : on l'annonce, avec le temps qu'il faut pour la rattraper.
    const cost = amount * rs / 100 / 24;
    const months = Math.max(1, Math.ceil(cost / (gain / 12)));
    out.push({
      id: `better-rate-${src.id}-${target.id}`,
      kind: 'better-rate',
      tone: 'action',
      title: `${eur(amount)} du ${src.name} rapporteraient plus sur le ${target.name} (${formatRate(rt)} au lieu de ${formatRate(rs)}) : environ ${eur(gain)} de plus par an.`,
      detail: cost >= 1
        ? `Le virement coûte une quinzaine d'intérêts (environ ${eur(cost)}), rattrapée en ${months} mois.`
        : 'Faites le virement le 15 ou le dernier jour du mois : il rapporte dès la quinzaine suivante.',
      gain: { amount: gain, per: 'an', label: "d'intérêts en plus par an" },
      action: { label: 'Voir mes comptes', view: 'accounts' },
      accountId: src.id,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Règle 3 : un livret sera plein avec le plan mensuel actuel
// ---------------------------------------------------------------------------

const livretFullForecast = (input: AlertsInput): Alert | null => {
  const monthly = input.monthlyPlan ?? 0;
  if (!(monthly > 0)) return null;
  const fiscal = input.fiscalConfig;
  let sim = usableAccounts(input).filter(a => a.type !== AccountType.IMMOBILIER).map(a => ({ ...a }));
  const watched = sim.filter(a => REGULATED_TYPES.includes(a.type) && ceilingOf(a, fiscal) - a.totalAmount > 1).map(a => a.id);
  if (watched.length === 0) return null;
  const restitutionAt = input.restitution?.plannedDate && !input.restitution.done ? input.restitution.plannedDate : undefined;
  let restituted = false;

  for (let m = 1; m <= FULL_FORECAST_MONTHS; m++) {
    const month = new Date(input.today.getFullYear(), input.today.getMonth() + m, 1);
    if (restitutionAt && !restituted && restitutionAt <= formatISODay(month)) { sim = accountsAfterRestitution(sim); restituted = true; }
    for (const st of computePlacementStrategy(monthly, sim, fiscal)) {
      if (st.infoOnly || !st.accountId) continue;
      const a = sim.find(x => x.id === st.accountId);
      if (a) { a.totalAmount += st.fillAmount; a.ownedAmount += st.fillAmount; }
    }
    const full = sim.find(a => watched.includes(a.id) && a.totalAmount >= ceilingOf(a, fiscal) - 1);
    if (!full) continue;

    // La suite : où le plan enverra l'argent le mois d'après.
    const next = computePlacementStrategy(monthly, sim, fiscal).find(st => st.accountId !== full.id && st.fillAmount > 0);
    const nextAccount = next?.accountId ? sim.find(a => a.id === next.accountId) : undefined;
    const nextRate = nextAccount ? netAnnualRate(nextAccount, fiscal) : next?.type === AccountType.LDDS ? next.rate || 0 : 0;
    const nextText = nextAccount ? `prévoyez la suite sur ${nextAccount.type === AccountType.ASSURANCE_VIE ? "l'" : 'le '}${nextAccount.name}`
      : next?.type === AccountType.LDDS ? 'prévoyez d\'ouvrir un LDDS pour la suite'
      : 'prévoyez la suite (PEA ou assurance vie)';
    // Laissée sur le compte courant, l'épargne de l'année suivante ne rapporterait rien :
    // versée chaque mois, elle produit en moyenne 6,5 mois d'intérêts la première année.
    const gain = monthly * nextRate / 100 * 6.5;
    const key = formatISODay(month).slice(0, 7);
    return {
      id: `livret-full-${full.id}-${key}`,
      kind: 'livret-full',
      tone: m <= 3 ? 'action' : 'info',
      title: `Votre ${full.name} sera plein vers ${formatPeriod(key)} : ${nextText}.`,
      detail: `Au rythme de ${eur(monthly)} par mois${restituted ? ', restitution du capital de vos parents comprise' : ''}.${gain >= MIN_GAIN_PER_YEAR ? ` Laissée sur le compte courant, la suite perdrait environ ${eur(gain)} d'intérêts la première année.` : ''}`,
      gain: gain >= MIN_GAIN_PER_YEAR ? { amount: gain, per: 'an', label: "d'intérêts la première année" } : undefined,
      action: { label: 'Voir le plan', view: 'pilot' },
      accountId: full.id,
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Règle 4 : place libérée sous les plafonds par la restitution
// ---------------------------------------------------------------------------

const restitutionRoom = (input: AlertsInput): Alert | null => {
  const r = input.restitution;
  if (!r?.plannedDate || r.done) return null;
  const rows = input.accounts.filter(a => REGULATED_TYPES.includes(a.type) && a.parentalCapital > 0);
  if (rows.length === 0) return null;
  const gain = rows.reduce((s, a) => s + a.parentalCapital * (a.interestRate || 0) / 100, 0);
  const parts = rows.map((a, i) => `${eur(a.parentalCapital)} ${i === 0 ? 'de place ' : ''}sur le ${a.name}`);
  return {
    id: `restitution-room-${r.plannedDate}`,
    kind: 'restitution-room',
    tone: 'info',
    title: `Après la restitution (${fullDate(r.plannedDate)}), ${listFr(parts)}.`,
    detail: `Votre plan de placement remplira cette place en priorité : environ ${eur(gain)} d'intérêts par an une fois remplie, pour vous.`,
    gain: gain >= MIN_GAIN_PER_YEAR ? { amount: gain, per: 'an', label: "d'intérêts par an une fois remplie" } : undefined,
    action: { label: 'Voir la part parentale', view: 'parental' },
  };
};

// ---------------------------------------------------------------------------
// Règle 5 : fiche de paie à vérifier (pas de montant : une sécurité)
// ---------------------------------------------------------------------------

const payslipAnomaly = (input: AlertsInput): Alert | null => {
  const payslips = input.payslips || [];
  const latest = payslips.filter(p => p.reviewed && p.extracted?.period)
    .sort((a, b) => (b.extracted.period as string).localeCompare(a.extracted.period as string))[0];
  if (!latest) return null;
  const anomaly = detectPayslipAnomalies(payslips).find(a => a.payslipId === latest.id);
  if (!anomaly) return null;
  return {
    id: `payslip-anomaly-${anomaly.payslipId}`,
    kind: 'payslip-anomaly',
    tone: 'info',
    title: `Fiche de paie de ${formatPeriod(anomaly.period)} à vérifier.`,
    detail: describeAnomaly(anomaly),
    action: { label: 'Voir mes fiches', view: 'payslips' },
  };
};

export const computeAlerts = (input: AlertsInput): Alert[] => {
  // Place sous les plafonds partagée : l'argent proposé pour le compte courant n'est pas
  // proposé une seconde fois pour un changement de livret.
  const room = roomByAccount(usableAccounts(input), input.fiscalConfig);
  const alerts: Alert[] = [];
  const dormant = dormantCash(input, room);
  if (dormant) alerts.push(dormant);
  alerts.push(...betterRate(input, room));
  const full = livretFullForecast(input);
  if (full) alerts.push(full);
  const restitution = restitutionRoom(input);
  if (restitution) alerts.push(restitution);
  const payslip = payslipAnomaly(input);
  if (payslip) alerts.push(payslip);
  return sortAlerts(alerts);
};
