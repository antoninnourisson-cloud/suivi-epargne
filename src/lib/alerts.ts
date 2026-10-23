// Moteur d'alertes unifié : chaque alerte d'optimisation dit ce qu'elle vaut en euros.
// Fonction pure (aucun accès au stockage ni à l'horloge) : l'Accueil l'affiche dans « À faire »,
// et le serveur pourrait un jour la réutiliser telle quelle (sans notification insistante).
// Les calculs viennent des aides existantes (plan de placement, restitution, taux nets,
// contrôle des fiches) : rien n'est recalculé ici à part.
import { AccountType, FiscalConfig, PayslipRecord, SavingsAccount } from '../types';
import type { View } from '../navigation';
import { REGULATED_TYPES, computePlacementStrategy } from './finance';
import { netAnnualRate, netMonthlyRateSchedule } from './projection';
import { accrueMonth, placeDeposit, prepareProjection, restituteParentalCapital, startProjection } from './projectionEngine';
import { detectPayslipAnomalies } from './motivation';
import { describeAnomaly } from '../components/motivation/text';
import { formatEUR, formatPeriod, formatRate, frenchDay } from './format';
import { formatISODay, parseISODate } from './dates';
import { computeIdleCash, describeIdleDestinations, idleDestinations } from './idleCash';
import { growthView, withAssumedRates } from './performance';

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
  /** Rendement supposé des placements sans taux saisi (withAssumedRates) ; calculé ici s'il manque. */
  assumedRates?: Readonly<Record<string, number>>;
}

/** En dessous, une alerte ne vaut pas la peine d'être affichée. */
const MIN_GAIN_PER_YEAR = 5;
/** Horizon de la prévision « livret plein », en mois. */
const FULL_FORECAST_MONTHS = 24;

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
const usableAccounts = (input: AlertsInput) => idleDestinations(input.accounts, input.lepEligible);

/** Place restante sous le plafond de chaque livret réglementé. */
const roomByAccount = (accounts: SavingsAccount[], fiscal: FiscalConfig) =>
  new Map(accounts.filter(a => REGULATED_TYPES.includes(a.type)).map(a => [a.id, Math.max(0, ceilingOf(a, fiscal) - a.totalAmount)]));

// ---------------------------------------------------------------------------
// Règle 1 : argent qui dort sur le compte courant
// ---------------------------------------------------------------------------

const dormantCash = (input: AlertsInput, room: Map<string, number>): Alert | null => {
  // Calcul partagé avec l'écran Rendement (lib/idleCash) : même coussin, mêmes livrets.
  const idle = computeIdleCash(input);
  if (!idle) return null;
  const { placed, gain } = idle;
  for (const st of idle.steps) if (st.accountId) room.set(st.accountId, Math.max(0, (room.get(st.accountId) || 0) - st.fillAmount));

  return {
    id: 'dormant-cash',
    kind: 'dormant-cash',
    tone: 'action',
    title: `${eur(placed)} dorment sur votre compte courant : placés sur ${describeIdleDestinations(idle)}, environ ${eur(gain)} d'intérêts par an.`,
    detail: `Pécule garde ${eur(idle.buffer)} sur le compte courant (un mois et demi de dépenses). Versé le 15 ou le dernier jour du mois, l'argent rapporte dès la quinzaine suivante.`,
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
  // Même moteur que les autres projections « selon votre plan » (./projectionEngine) :
  // intérêts du mois (versés au 31 décembre pour les livrets réglementés, ce qui les
  // rapproche du plafond), restitution éventuelle, puis versement réparti par le plan.
  const setup = prepareProjection(usableAccounts(input), input.today, a => netMonthlyRateSchedule(growthView(a, input.assumedRates), fiscal, input.today));
  const state = startProjection(setup);
  const sim = state.accounts;
  const watched = sim.filter(a => REGULATED_TYPES.includes(a.type) && ceilingOf(a, fiscal) - a.totalAmount > 1).map(a => a.id);
  if (watched.length === 0) return null;
  const restitutionAt = input.restitution?.plannedDate && !input.restitution.done ? input.restitution.plannedDate : undefined;
  let restituted = false;

  for (let m = 1; m <= FULL_FORECAST_MONTHS; m++) {
    const month = new Date(input.today.getFullYear(), input.today.getMonth() + m, 1);
    accrueMonth(state, m);
    if (restitutionAt && !restituted && restitutionAt <= formatISODay(month)) { restituteParentalCapital(state); restituted = true; }
    // Une étape sans compte (livrets pleins, ni AV ni PEA) laisse l'argent sur le compte
    // courant : elle ne remplit aucun livret, c'est tout ce qui compte ici.
    placeDeposit(state, monthly, fiscal);
    const full = sim.find(a => watched.includes(a.id) && a.totalAmount >= ceilingOf(a, fiscal) - 1);
    if (!full) continue;

    // La suite : où le plan enverra l'argent le mois d'après.
    const next = computePlacementStrategy(monthly, sim, fiscal).find(st => st.accountId !== full.id && st.fillAmount > 0);
    const nextAccount = next?.accountId ? sim.find(a => a.id === next.accountId) : undefined;
    const nextRate = nextAccount ? netAnnualRate(growthView(nextAccount, input.assumedRates), fiscal, month) : next?.type === AccountType.LDDS ? next.rate || 0 : 0;
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

/**
 * Où le plan enverrait l'argent si les livrets réglementés étaient pleins : c'est là que
 * serait allé l'argent qui remplira la place rendue. Taux net (impôts et prélèvements
 * sociaux d'un retrait déduits), 0 si l'argent resterait sur le compte courant.
 */
const fallbackDestination = (input: AlertsInput, asOf: Date): { label: string; rate: number } => {
  const fiscal = input.fiscalConfig;
  const full = usableAccounts(input)
    .filter(a => a.type !== AccountType.IMMOBILIER)
    .map(a => (REGULATED_TYPES.includes(a.type) ? { ...a, totalAmount: Math.max(a.totalAmount, ceilingOf(a, fiscal)) } : a));
  const step = computePlacementStrategy(1000, full, fiscal).find(st => !st.infoOnly && st.fillAmount > 0);
  const account = step?.accountId ? full.find(a => a.id === step.accountId) : undefined;
  if (account) return { label: `${account.type === AccountType.ASSURANCE_VIE ? "l'" : 'le '}${account.name}`, rate: netAnnualRate(growthView(account, input.assumedRates), fiscal, asOf) };
  if (step?.type === AccountType.LDDS) return { label: 'un LDDS à ouvrir', rate: step.rate || 0 };
  return { label: 'le compte courant', rate: 0 };
};

/**
 * Les intérêts du capital des parents vous sont DÉJÀ offerts chaque année : la restitution
 * les arrête. Le seul gain de la place rendue est l'écart de taux entre le livret et
 * l'endroit où votre argent serait allé sinon (fallbackDestination).
 */
const restitutionRoom = (input: AlertsInput): Alert | null => {
  const r = input.restitution;
  if (!r?.plannedDate || r.done) return null;
  const rows = input.accounts.filter(a => REGULATED_TYPES.includes(a.type) && a.parentalCapital > 0);
  if (rows.length === 0) return null;
  const fallback = fallbackDestination(input, parseISODate(r.plannedDate));
  const offered = rows.reduce((s, a) => s + a.parentalCapital * (a.interestRate || 0) / 100, 0);
  const gain = rows.reduce((s, a) => s + a.parentalCapital * Math.max(0, (a.interestRate || 0) - fallback.rate) / 100, 0);
  const parts = rows.map((a, i) => `${eur(a.parentalCapital)} ${i === 0 ? 'de place ' : ''}sur le ${a.name}`);
  const worth = gain >= MIN_GAIN_PER_YEAR
    ? `environ ${eur(gain)} d'intérêts par an de plus que sur ${fallback.label} (${formatRate(fallback.rate)} net).`
    : `peu ou pas d'intérêts en plus que sur ${fallback.label} (${formatRate(fallback.rate)} net), mais un argent disponible à tout moment.`;
  return {
    id: `restitution-room-${r.plannedDate}`,
    kind: 'restitution-room',
    tone: 'info',
    title: `Après la restitution (${fullDate(r.plannedDate)}), ${listFr(parts)}.`,
    detail: `Votre plan de placement remplira cette place en priorité : ${worth}`
      + (offered >= 1 ? ` Les intérêts du capital de vos parents, qu'ils vous offrent (environ ${eur(offered)} par an), s'arrêtent à la restitution.` : ''),
    gain: gain >= MIN_GAIN_PER_YEAR ? { amount: gain, per: 'an', label: "d'intérêts par an en plus une fois remplie" } : undefined,
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

export const computeAlerts = (alertsInput: AlertsInput): Alert[] => {
  // Un placement sans taux saisi rapporte son rendement supposé, comme au Rendement, dans
  // le simulateur et le plan solo (même compte, même croissance partout).
  const input: AlertsInput = alertsInput.assumedRates ? alertsInput : { ...alertsInput, assumedRates: withAssumedRates(alertsInput.accounts, alertsInput.today).rates };
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
