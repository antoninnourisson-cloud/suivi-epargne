import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import type { StackedPoint } from './DashboardCharts';

// Graphiques chargés à part (recharts) : les cartes s'affichent sans les attendre.
const StackedSavingsChart = lazyWithRetry(() => import('./DashboardCharts').then(m => ({ default: m.StackedSavingsChart })));
const InstitutionChart = lazyWithRetry(() => import('./DashboardCharts').then(m => ({ default: m.InstitutionChart })));
import { describeLepTimeline, LepTimeline } from '../lib/lep';
import { accountColor } from '../lib/chartTheme';
import { TodoList, TodoSpec } from './TodoList';
import type { View } from '../navigation';
import type { EmergencyFund } from '../lib/planning';
import type { AgendaEvent } from '../lib/agenda';
import { Sprout, LifeBuoy, Download, CalendarDays, ChevronDown, ChartLine } from 'lucide-react';
import { lazyWithRetry } from './ErrorBoundary';
import { SavingsAccount, PortfolioSnapshot, AccountType, Expense, FiscalConfig, WorkBenefits, RecurringMovement, Subscription } from '../types';
import { Landmark, CalendarClock, Save, AlertTriangle, Trash2, Clock, TrendingUp, TrendingDown, PiggyBank, Percent, ShieldAlert, Repeat } from 'lucide-react';
import { computeAccruedParentalInterest, computeRecentSavingsRate, computeAccountBalanceAtDate, findStaleRegulatedRates, findDueRecurring, computeMonthSavedAmount, computeSavedSince, payPeriodOf, computeSavingsRateHistory, computeUnlockCost, findFiscalReview, applyTaxScale, nextSubscriptionDate, findAvRateUpdatesDue } from '../lib/finance';
import { parseISODate, formatISODay, daysBetween, localTodayISO } from '../lib/dates';
import { Button, Card, DeltaBadge, MoneyText, PageHeader, SegmentedButton, Sparkline, StatTile } from './ui';
import { AvailabilityBar, type AvailabilitySegment } from './dashboard/AvailabilityBar';
import { homeSparkline, deltaOverDays } from '../lib/homeSeries';
import { formatEUR, formatSignedEUR, frenchDay, formatPeriod } from '../lib/format';
import { InstallPrompt } from './InstallPrompt';
import { RegulatedRatesEditor } from './RegulatedRatesEditor';
import { signedAmount, round2 } from '../lib/money';
import { groupByInstitution } from '../lib/chartData';

interface DashboardProps {
  accounts: SavingsAccount[];
  history: PortfolioSnapshot[];
  expenses: Expense[];
  fiscalConfig: FiscalConfig;
  // Nécessaire au seul calcul du net imposable, pour l'alerte d'éligibilité LEP.
  workBenefits?: WorkBenefits;
  onDeleteAccount?: (account: SavingsAccount) => void;
  recurringMovements?: RecurringMovement[];
  // Enregistre l'échéance proposée (passe par le même chemin que l'ajout rapide : notif
  // parents, arrondis, toast).
  onRecordRecurring?: (r: RecurringMovement, date: string) => void;
  // Objectif d'épargne du mois : montant du rappel de paie, sinon capacité du Pilotage.
  monthPlan?: number;
  // Paie nette mensuelle, pour le taux d'épargne.
  monthlyPay?: number;
  paydayDay?: number;
  trackingStartDate?: string;
  subscriptions?: Subscription[];
  // Mise à jour des paramètres fiscaux (nouveau barème, vérification annuelle).
  onUpdateFiscalConfig?: (update: (prev: FiscalConfig) => FiscalConfig) => void;
  onOpenSettings?: () => void;
  onUpdateAccounts?: (update: (prev: SavingsAccount[]) => SavingsAccount[]) => void;
  payRaise?: { delta: number; period: string; hasFixedAmount: boolean } | null;
  onAcceptPayRaise?: () => void;
  onDismissPayRaise?: () => void;
  config: {
    grossAnnual: number;
    navigoBase: number;
    navigoRate: number;
    taxRateManual: number;
  };
  // Ouvre un autre écran (actions des alertes, premier lancement).
  onNavigate?: (view: View) => void;
  onAddAccount?: () => void;
  // Rappel trimestriel de télécharger une copie.
  lastExportAt?: string;
  onExport?: () => void;
  emergency?: EmergencyFund | null;
  onSetEmergencyMonths?: (m: number) => void;
  agendaNext?: AgendaEvent[];
  lepTimeline?: LepTimeline | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ accounts, history, fiscalConfig, onDeleteAccount, recurringMovements = [], onRecordRecurring, monthPlan, monthlyPay = 0, paydayDay, trackingStartDate, subscriptions = [], onUpdateFiscalConfig, onOpenSettings, onUpdateAccounts, payRaise, onAcceptPayRaise, onDismissPayRaise, onNavigate, onAddAccount, lastExportAt, onExport, emergency, onSetEmergencyMonths, agendaNext = [], lepTimeline }) => {
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    try {
        const stored = localStorage.getItem('dashboard_date_range');
        if (stored) return JSON.parse(stored);
    } catch (e) {}
    
    // `setMonth(-6)` sur un 31 du mois débordait (31 février → 3 mars) ; on borne le jour
    // au dernier jour du mois cible. Et tout en heure LOCALE, pas UTC.
    const now = new Date();
    const lastDayOfTargetMonth = new Date(now.getFullYear(), now.getMonth() - 5, 0).getDate();
    const start = new Date(now.getFullYear(), now.getMonth() - 6, Math.min(now.getDate(), lastDayOfTargetMonth));
    return { start: formatISODay(start), end: localTodayISO() };
  });

  useEffect(() => {
    try { localStorage.setItem('dashboard_date_range', JSON.stringify(dateRange)); } catch { /* non mémorisé */ }
  }, [dateRange]);

  // Part possédée À CE JOUR : les mouvements datés dans le futur sont neutralisés, comme
  // le fait déjà le graphique — sinon la carte "Mon épargne nette" et le dernier point de
  // la courbe divergeaient dès qu'un mouvement futur existait.
  const ownedToday = (acc: SavingsAccount): number => {
    const today = localTodayISO();
    let balance = acc.ownedAmount;
    (acc.movements || []).forEach(m => {
      if (m.date > today && m.kind !== 'parental') balance -= signedAmount(m);
    });
    return balance;
  };
  const mySavings = accounts.reduce((acc, curr) => acc + ownedToday(curr), 0);

  // --- ALERTES PLAFOND (livrets réglementés proches ou au plafond) ---
  const ceilingAlerts = useMemo(() => {
    const defaults: Record<string, number> = {
      [AccountType.LIVRET_A]: fiscalConfig.ceilings.livretA,
      [AccountType.LDDS]: fiscalConfig.ceilings.ldds,
      [AccountType.LEP]: fiscalConfig.ceilings.lep,
    };
    return accounts
      .map(a => {
        // Le plafond saisi sur le compte (AccountForm) prime : il était stocké mais
        // ignoré par tous les consommateurs, qui n'utilisaient que la config globale.
        const ceiling = (a.ceiling && a.ceiling > 0) ? a.ceiling : (defaults[a.type] || 0);
        return { a, ceiling };
      })
      .filter(({ ceiling }) => ceiling > 0)
      .map(({ a, ceiling }) => {
        const pct = (a.totalAmount / ceiling) * 100;
        return { id: a.id, name: a.name, type: a.type, pct, remaining: ceiling - a.totalAmount, ceiling };
      })
      // Presque plein seulement : un livret déjà plein n'appelle aucune action (le plan de
      // placement l'ignore déjà), inutile de le rappeler en permanence.
      .filter(x => x.pct >= 90 && x.pct < 100)
      .sort((a, b) => b.pct - a.pct);
  }, [accounts, fiscalConfig]);

  // --- COMPTES VIDES INACTIFS (candidats à la suppression) ---
  const inactiveEmptyAccounts = useMemo(() => {
    const now = new Date();
    return accounts.filter(a => {
      if (a.totalAmount !== 0) return false;
      const lastMove = (a.movements || []).slice().sort((x, y) => y.date.localeCompare(x.date))[0];
      const refDate = lastMove ? parseISODate(lastMove.date) : (a.openingDate ? parseISODate(a.openingDate) : null);
      if (!refDate) return true; // aucune date connue, jamais alimenté
      const days = (now.getTime() - refDate.getTime()) / (1000 * 3600 * 24);
      return days >= 60;
    });
  }, [accounts]);

  // --- RAPPEL D'ACTUALISATION (aucun mouvement récent sur l'ensemble des comptes) ---
  const daysSinceLastUpdate = useMemo(() => {
    // Les mouvements datés dans le futur sont ignorés : un seul suffisait à rendre le
    // compteur négatif et à désactiver le rappel pour toujours.
    const today = localTodayISO();
    let latest: string | null = null;
    accounts.forEach(a => (a.movements || []).forEach(m => {
      if (m.date <= today && (!latest || m.date > latest)) latest = m.date;
    }));
    if (!latest) return null;
    return Math.floor((Date.now() - parseISODate(latest).getTime()) / (1000 * 3600 * 24));
  }, [accounts]);

  // Les seuils de maturité viennent de fiscalConfig.legalMaturity (comme lib/finance.ts et
  // l'Horloge fiscale) : ils étaient codés en dur ici (5/8), seul écran incapable de suivre
  // la config — trois réponses différentes possibles pour le même compte.
  const getAccountStatus = useCallback((account: SavingsAccount): 'AVAILABLE' | 'TAX_LOCKED' | 'HARD_LOCKED' => {
    const { pea, assuranceVie, pee } = fiscalConfig.legalMaturity;
    if (account.type === AccountType.PEE) {
        const now = new Date();
        if (account.contractEndDate && parseISODate(account.contractEndDate) <= now) return 'AVAILABLE';
        if (account.openingDate) {
            const openDate = parseISODate(account.openingDate);
            const ageInYears = (now.getTime() - openDate.getTime()) / (1000 * 3600 * 24 * 365.25);
            return ageInYears >= pee ? 'AVAILABLE' : 'HARD_LOCKED';
        }
        return 'HARD_LOCKED';
    }
    if ([AccountType.IMMOBILIER, AccountType.PER, AccountType.AUTRE].includes(account.type)) return 'HARD_LOCKED';
    if (!account.openingDate) return 'AVAILABLE';
    const openDate = parseISODate(account.openingDate);
    const now = new Date();
    const ageInYears = (now.getTime() - openDate.getTime()) / (1000 * 3600 * 24 * 365.25);
    if (account.type === AccountType.PEA) return ageInYears < pea ? 'TAX_LOCKED' : 'AVAILABLE';
    if (account.type === AccountType.ASSURANCE_VIE) return ageInYears < assuranceVie ? 'TAX_LOCKED' : 'AVAILABLE';
    return 'AVAILABLE';
  }, [fiscalConfig]);

  const availabilityStats = useMemo(() => {
    let available = 0; let taxLocked = 0; let hardLocked = 0;
    accounts.forEach(acc => {
      const status = getAccountStatus(acc);
      const owned = ownedToday(acc); // même convention "à ce jour" que la carte du total
      if (status === 'AVAILABLE') available += owned;
      else if (status === 'TAX_LOCKED') taxLocked += owned;
      else hardLocked += owned;
    });
    return { available, taxLocked, hardLocked };
  }, [accounts, getAccountStatus]);

  const unlockCost = useMemo(() => computeUnlockCost(accounts, fiscalConfig), [accounts, fiscalConfig]);
  const fiscalReview = useMemo(() => findFiscalReview(fiscalConfig), [fiscalConfig]);
  const [ratesEditorOpen, setRatesEditorOpen] = useState(false);

  // Taux servi de l'AV publié en janvier : à reporter, ou à confirmer inchangé.
  const avRateKey = `av_rate_checked_${new Date().getFullYear()}`;
  const [avRateChecked, setAvRateChecked] = useState(() => { try { return localStorage.getItem(avRateKey) === '1'; } catch { return false; } });
  const avRatesDue = useMemo(() => (avRateChecked ? [] : findAvRateUpdatesDue(accounts)), [accounts, avRateChecked]);
  const confirmAvRates = () => { try { localStorage.setItem(avRateKey, '1'); } catch { /* préférence non mémorisée */ } setAvRateChecked(true); };

  // Prélèvements des 7 prochains jours (aujourd'hui compris), du plus proche au plus lointain.
  const upcomingDebits = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return subscriptions
      .filter(s => s.active && s.amount > 0)
      .map(s => ({ s, date: nextSubscriptionDate(s, today) }))
      .map(x => ({ ...x, inDays: daysBetween(today, x.date) }))
      .filter(x => x.inDays <= 7)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [subscriptions]);

  const isConstrainedAccount = (type: AccountType) => {
    return [AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.PEE, AccountType.PER].includes(type);
  };

  // --- LOGIQUE CORRIGÉE : GESTION DU FUTUR ---
  const stackedData = useMemo(() => {
    const data: StackedPoint[] = [];
    // parseISODate (minuit LOCAL) et non `new Date('YYYY-MM-DD')` (minuit UTC) : l'ancien
    // mélange UTC-parse + `setDate` local faisait SAUTER le jour du passage à l'heure
    // d'hiver (reproduit : le 26/10/2025 n'était jamais généré), donc les mouvements de ce
    // jour n'étaient jamais rembobinés et tout le graphique à gauche était décalé.
    const endDate = parseISODate(dateRange.end);
    const startDate = parseISODate(dateRange.start);
    if (endDate < startDate) return []; // plage inversée : rien à tracer
    const endDateStr = dateRange.end;

    // Borne dure : la boucle est journalière, une date de fin fantaisiste (2099...) gelait
    // l'onglet. ~5 ans suffisent largement pour l'historique visualisable.
    const MAX_DAYS = 1830;
    const effectiveStart = daysBetween(startDate, endDate) > MAX_DAYS
      ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - MAX_DAYS)
      : startDate;

    // 1. DÉPART : montants finaux, corrigés des mouvements futurs (> dateRange.end), et
    // index date→flux par compte pour ne pas re-filtrer tous les mouvements à chaque jour.
    const currentBalances = new Map<string, number>();
    const flowsByAccountDate = new Map<string, Map<string, number>>();
    accounts.forEach(acc => {
      let balanceAtEndDate = acc.ownedAmount;
      const byDate = new Map<string, number>();
      (acc.movements || []).forEach(m => {
        if (m.kind === 'parental') return; // part des parents : hors de « mon épargne »
        const flow = signedAmount(m);
        if (m.date > endDateStr) balanceAtEndDate -= flow; // annule le mouvement futur
        else byDate.set(m.date, (byDate.get(m.date) || 0) + flow);
      });
      flowsByAccountDate.set(acc.id, byDate);
      currentBalances.set(acc.id, balanceAtEndDate);
    });

    // 2. BOUCLE : on remonte le temps (push + reverse : unshift réindexait tout le tableau
    // à chaque itération, O(n²) sur les longues plages)
    for (let d = new Date(endDate); d >= effectiveStart; d.setDate(d.getDate() - 1)) {
      const dateStr = formatISODay(d);

      const daySnapshot: StackedPoint = {
        date: dateStr,
        displayDate: d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      };

      let dailyTotal = 0;
      currentBalances.forEach((amount, id) => {
        const safeAmount = round2(amount);
        daySnapshot[id] = safeAmount;
        dailyTotal += safeAmount;
      });
      daySnapshot.total = dailyTotal;

      data.push(daySnapshot);

      accounts.forEach(acc => {
        const flow = flowsByAccountDate.get(acc.id)?.get(dateStr);
        if (flow) currentBalances.set(acc.id, (currentBalances.get(acc.id) || 0) - flow);
      });
    }

    data.reverse();
    // Au-delà de 4 mois, un point par semaine suffit (et le dernier jour est toujours gardé) :
    // le graphique reste lisible et léger même sur cinq ans.
    if (data.length > 120) {
      const step = data.length > 730 ? 14 : 7;
      return data.filter((_, i) => i % step === 0 || i === data.length - 1);
    }
    return data;
  }, [accounts, dateRange]);

  // --- PROJECTION DE TRAJECTOIRE ---
  // Extrapole le rythme d'épargne RÉEL observé sur les 90 derniers jours (indépendant du
  // filtre de dates du graphique ci-dessus, pour rester stable même si l'utilisateur change
  // la période affichée). `computeRecentSavingsRate`/`computeAccountBalanceAtDate` sont
  // partagées avec Objectifs, pour que les deux écrans ne puissent jamais raconter deux
  // rythmes différents.
  // Avec un jour de paie connu, la jauge suit la paie (du 27 au 26 suivant) et non le mois
  // calendaire : le 1er octobre, c'est encore la paie du 27 septembre qu'on place.
  const payPeriod = paydayDay ? payPeriodOf(paydayDay) : null;
  const monthSaved = useMemo(
    () => (payPeriod ? computeSavedSince(accounts, formatISODay(payPeriod.payDate), new Date(), trackingStartDate) : computeMonthSavedAmount(accounts, new Date(), trackingStartDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, payPeriod?.key, trackingStartDate]
  );

  const [rateMonth, setRateMonth] = useState<string | null>(null);
  // Évolution de votre part depuis le début du mois (point mensuel de l'historique).
  const monthDelta = useMemo(() => {
    const key = localTodayISO().slice(0, 7);
    const prev = [...history].filter(h => h.date < `${key}-01`).sort((a, b) => a.date.localeCompare(b.date)).pop();
    return prev && prev.ownedAmount !== undefined ? mySavings - prev.ownedAmount : null;
  }, [history, mySavings]);
  const rateHistory = useMemo(() => computeSavingsRateHistory(accounts, monthlyPay, 12, new Date(), trackingStartDate), [accounts, monthlyPay, trackingStartDate]);
  // Moyenne des mois COMPLETS seulement : le mois en cours n'est pas encore fini.
  const avgRate = useMemo(() => {
    const full = rateHistory.slice(0, -1).filter(m => m.saved !== 0);
    return full.length > 0 ? full.reduce((sum, m) => sum + m.rate, 0) / full.length : null;
  }, [rateHistory]);

  const projection = useMemo(() => {
    const now = new Date();
    const monthlyRate = computeRecentSavingsRate(accounts, 90, now);
    if (monthlyRate === null || Math.abs(monthlyRate) < 1) return null; // pas assez d'historique, ou rythme quasi nul

    const totalNow = computeAccountBalanceAtDate(accounts, formatISODay(now));

    // --- DÉRIVE DE RYTHME : comparaison au trimestre précédent (jours -180 à -90) ---
    // Même fonction, `asOfDate` décalé d'un trimestre, pour détecter un ralentissement (ou
    // une accélération) sans rien collecter de nouveau. `null` ou rythme précédent proche de
    // 0 => comparaison ignorée : sinon un rythme précédent quasi nul ferait passer n'importe
    // quelle variation pour un séisme.
    const past90 = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
    const previousMonthlyRate = computeRecentSavingsRate(accounts, 90, past90);
    let drift: { previousMonthlyRate: number; changeRatio: number } | null = null;
    if (previousMonthlyRate !== null && Math.abs(previousMonthlyRate) >= 20) {
      const changeRatio = (monthlyRate - previousMonthlyRate) / Math.abs(previousMonthlyRate);
      // Écart de moins de 25% : variation normale d'un trimestre à l'autre, pas une dérive.
      if (Math.abs(changeRatio) >= 0.25) drift = { previousMonthlyRate, changeRatio };
    }

    return { monthlyRate, totalNow, in6: totalNow + monthlyRate * 6, in12: totalNow + monthlyRate * 12, drift };
  }, [accounts]);

  const fmtEUR = (v: number) => formatEUR(v, 0);

  // --- CHIFFRE PRINCIPAL : TENDANCE ---
  // Votre part à une date passée, même convention que la projection (mouvements rembobinés).
  const today = localTodayISO();
  const balanceAt = useCallback((iso: string) => computeAccountBalanceAtDate(accounts, iso), [accounts]);
  const spark = useMemo(() => homeSparkline({ history, current: mySavings, today, balanceAt }), [history, mySavings, today, balanceAt]);
  const delta30 = useMemo(() => deltaOverDays(mySavings, balanceAt, today), [mySavings, balanceAt, today]);

  // « Plus de détails » (projection, graphiques) : replié par défaut, choix mémorisé.
  const [moreOpen, setMoreOpen] = useState(() => { try { return localStorage.getItem('home_more_open') === '1'; } catch { return false; } });
  const toggleMore = () => setMoreOpen(o => { try { localStorage.setItem('home_more_open', o ? '0' : '1'); } catch { /* non mémorisé */ } return !o; });

  // --- RAPPEL DE RÉVISION DES TAUX RÉGLEMENTÉS (1er février / 1er août) ---
  // Masquable par révision (clé locale) : si le taux n'a en fait pas bougé, l'utilisateur
  // écarte le rappel une fois et ne le revoit qu'à la révision suivante.
  const [dismissedRateRevision, setDismissedRateRevision] = useState<string | null>(() => {
    try { return localStorage.getItem('dismissed_rate_revision'); } catch { return null; }
  });
  const staleRates = useMemo(() => findStaleRegulatedRates(accounts), [accounts]);
  const showRateReminder = staleRates && staleRates.revision.key !== dismissedRateRevision;
  const dismissRateReminder = () => {
    if (!staleRates) return;
    try { localStorage.setItem('dismissed_rate_revision', staleRates.revision.key); } catch { /* non bloquant */ }
    setDismissedRateRevision(staleRates.revision.key);
  };

  // --- ÉLIGIBILITÉ LEP ---
  // Le plafond porte sur le Revenu Fiscal de Référence du foyer ; on ne dispose ici que du
  // net imposable du salaire, d'où une ESTIMATION clairement présentée comme telle.

  // --- ÉCHÉANCES RÉCURRENTES À ENREGISTRER ---
  // « Pas ce mois-ci » est mémorisé localement par mois : la même échéance revient
  // naturellement le mois suivant.
  const monthKey = localTodayISO().slice(0, 7);
  const skippedKey = `skipped_recurring_${monthKey}`;
  const [skippedRecurring, setSkippedRecurring] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(skippedKey) || '[]')); } catch { return new Set(); }
  });
  const dueRecurring = useMemo(
    () => findDueRecurring(recurringMovements, accounts, new Date(), skippedRecurring),
    [recurringMovements, accounts, skippedRecurring]
  );
  const skipRecurring = (id: string) => {
    const next = new Set(skippedRecurring); next.add(id);
    try { localStorage.setItem(skippedKey, JSON.stringify([...next])); } catch { /* non bloquant */ }
    setSkippedRecurring(next);
  };

  // --- RAPPEL DE FIN D'ANNÉE : INTÉRÊTS PARENTAUX ---
  // Le capital que les parents ont placé sur ces comptes reste intouchable, mais ses
  // intérêts sont offerts en fin d'année (accord familial, pas une règle fiscale) — même
  // calcul que Rendement (`computeParentalInterest`), affiché ici en rappel ponctuel plutôt
  // que d'obliger à aller consulter cet onglet spécifiquement en décembre.
  const parentalYearEndReminder = useMemo(() => {
    const now = new Date();
    if (now.getMonth() !== 11) return null; // uniquement en décembre
    // Intérêts RÉELLEMENT acquis : ce rappel annonce « cette année », il ne doit pas
    // extrapoler douze mois sur le solde du jour (un versement de novembre s'y voyait
    // crédité une année pleine).
    const { totalAnnualParental } = computeAccruedParentalInterest(accounts, now.getFullYear(), now);
    return totalAnnualParental > 1 ? totalAnnualParental : null;
  }, [accounts]);

  // Par établissement, avec la même convention « à ce jour » que les cartes (mouvements
  // futurs exclus) ; regroupement insensible aux espaces et à la casse.
  const dataByInstitution = groupByInstitution(accounts, ownedToday);

  // Couleur par compte : rang de son identifiant (trié), donc stable quand l'ordre
  // d'affichage change, et jamais deux comptes de la même couleur jusqu'à dix comptes.
  const sortedIds = useMemo(() => accounts.map(a => a.id).sort(), [accounts]);
  const getAccountColor = (accountId: string) => accountColor(sortedIds, accountId);

  const exportSession = () => {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let csvContent = "Catégorie,Désignation,Valeur,Détail\n";
    accounts.forEach(acc => {
      csvContent += `Compte,${acc.name},${acc.ownedAmount},${acc.institution} (${acc.type})\n`;
      if(acc.parentalCapital > 0) csvContent += `Compte (Parents),${acc.name},${acc.parentalCapital},${acc.institution}\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Sauvegarde_Epargne_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (accounts.length === 0) return (
    <section aria-labelledby="welcome-title" className="max-w-xl mx-auto mt-6 rounded-3xl bg-surface-container-low border border-outline-variant p-8 text-center text-on-surface">
      <span className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-primary-container text-on-primary-container flex items-center justify-center">
        <Sprout className="w-7 h-7" aria-hidden="true" />
      </span>
      <h2 id="welcome-title" className="text-[28px] leading-9 font-normal text-on-surface">Bienvenue dans Pécule</h2>
      <p className="text-on-surface-variant mt-2">Trois étapes pour faire pousser votre épargne :</p>
      <ol className="text-left mt-6 space-y-3 text-sm text-on-surface">
        {[
          'Ajoutez vos comptes (Livret A, LEP, assurance vie…) avec leur solde.',
          'Indiquez votre salaire et vos charges dans le Pilotage.',
          'Choisissez votre jour de paie : Pécule vous dira quoi placer, et où.',
        ].map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-primary text-on-primary text-xs font-medium tabular-nums flex items-center justify-center shrink-0" aria-hidden="true">{i + 1}</span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-col sm:flex-row gap-2 justify-center">
        {onAddAccount && <Button onClick={onAddAccount}>Ajouter mon premier compte</Button>}
        {onNavigate && <Button variant="tonal" onClick={() => onNavigate('pilot')}>Ouvrir le Pilotage</Button>}
      </div>
    </section>
  );

  const exportDue = !!onExport && (!lastExportAt || daysBetween(parseISODate(lastExportAt), new Date()) >= 90);
  const todos: TodoSpec[] = [];
  if (daysSinceLastUpdate !== null && daysSinceLastUpdate >= 21) todos.push({
    key: 'stale-update', icon: Clock, tone: 'action', snoozable: true,
    text: `Aucune actualisation de solde depuis ${daysSinceLastUpdate} jours.`,
    primary: onNavigate ? { label: 'Actualiser', onClick: () => onNavigate('update') } : undefined,
  });
  if (onRecordRecurring) for (const { recurring: r, dueDate } of dueRecurring) todos.push({
    key: `rec-${r.id}-${dueDate}`, icon: Repeat, tone: 'action',
    text: <>Échéance du {parseISODate(dueDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} : {r.label}, {r.type === 'IN' ? '+' : '−'}{fmtEUR(r.amount)} sur {accounts.find(a => a.id === r.accountId)?.name}</>,
    primary: { label: 'Enregistrer', onClick: () => onRecordRecurring(r, dueDate) },
    secondary: { label: 'Pas ce mois-ci', onClick: () => skipRecurring(r.id) },
  });
  const lepText = describeLepTimeline(lepTimeline ?? null);
  if (lepTimeline && lepText) todos.push({
    key: `lep-${lepTimeline.status}-${lepTimeline.closeBy ?? lepTimeline.overYear ?? ''}`, icon: ShieldAlert,
    tone: lepTimeline.status === 'closing' || lepTimeline.status === 'closed-due' ? 'action' : 'info',
    snoozable: lepTimeline.status !== 'closed-due',
    text: lepText.title,
    detail: lepText.detail,
    primary: onNavigate ? { label: lepTimeline.estimated ? 'Importer mon avis' : 'Voir mes comptes', onClick: () => onNavigate(lepTimeline.estimated ? 'settings' : 'accounts') } : undefined,
  });
  if (showRateReminder && staleRates) todos.push({
    key: 'rates', icon: Percent, tone: 'action',
    text: <>Taux réglementés révisés au {staleRates.revision.label} : mettez à jour {staleRates.accounts.map(a => a.name).join(', ')}.</>,
    detail: 'Un taux périmé fausse le rendement, la projection et le plan de placement.',
    primary: onUpdateAccounts ? { label: ratesEditorOpen ? 'Fermer' : 'Mettre à jour', onClick: () => setRatesEditorOpen(o => !o) } : undefined,
    secondary: { label: 'Taux inchangé', onClick: dismissRateReminder },
    extra: ratesEditorOpen && onUpdateAccounts ? <RegulatedRatesEditor accounts={accounts} onApply={onUpdateAccounts} /> : undefined,
  });
  if (parentalYearEndReminder !== null) todos.push({
    key: `parental-ye-${new Date().getFullYear()}`, icon: PiggyBank, tone: 'info', snoozable: true,
    text: <>Fin d'année : le capital de vos parents a produit environ {fmtEUR(parentalYearEndReminder)} d'intérêts cette année. Ils vous reviennent ; le capital, lui, reste à eux.</>,
    primary: onNavigate ? { label: 'Voir la part parentale', onClick: () => onNavigate('parental') } : undefined,
  });
  if (onDeleteAccount) for (const a of inactiveEmptyAccounts) todos.push({
    key: `empty-${a.id}`, icon: Trash2, tone: 'info', snoozable: true,
    text: `${a.name} est à 0 € et inactif.`,
    primary: { label: 'Supprimer', onClick: () => onDeleteAccount(a) },
  });
  if (onUpdateFiscalConfig && fiscalReview.newScale) todos.push({
    key: `scale-${fiscalReview.newScale.year}`, icon: Landmark, tone: 'action',
    text: `Nouveau barème de l'impôt : ${fiscalReview.newScale.label}.`,
    detail: 'Votre « super net » utilise encore l\'ancien. L\'ancien barème reste dans l\'historique (Paramètres).',
    primary: { label: 'Appliquer', onClick: () => onUpdateFiscalConfig(prev => applyTaxScale(prev, fiscalReview.newScale!)) },
  });
  if (onUpdateFiscalConfig && fiscalReview.annualCheckDue) todos.push({
    key: `annual-${new Date().getFullYear()}`, icon: Landmark, tone: 'action',
    text: <>Nouvelle année : vérifiez vos paramètres fiscaux (plafond LEP {formatEUR(fiscalConfig.lepIncomeCeiling ?? 0)}, abattement plafonné à {formatEUR(fiscalConfig.standardAllowanceCap ?? 0)}, barème {fiscalConfig.taxScaleYear ?? 'personnalisé'}).</>,
    primary: { label: 'C\'est à jour', onClick: () => onUpdateFiscalConfig(prev => ({ ...prev, paramsReviewedYear: new Date().getFullYear() })) },
    secondary: onOpenSettings ? { label: 'Ouvrir les paramètres', onClick: onOpenSettings } : undefined,
  });
  if (payRaise) todos.push({
    key: `raise-${payRaise.period}`, icon: TrendingUp, tone: 'action',
    text: `Votre net a augmenté de ${formatEUR(payRaise.delta, 0)} par mois (fiche de ${formatPeriod(payRaise.period)}).`,
    detail: payRaise.hasFixedAmount ? `« Ajouter » augmente votre épargne mensuelle de ${formatEUR(payRaise.delta, 0)}. Si c'est une prime ponctuelle, ignorez.` : '« Ajouter » base le Pilotage sur cette fiche. Si c\'est une prime ponctuelle, ignorez.',
    primary: onAcceptPayRaise ? { label: 'Ajouter', onClick: onAcceptPayRaise } : undefined,
    secondary: onDismissPayRaise ? { label: 'Ignorer', onClick: onDismissPayRaise } : undefined,
  });
  if (avRatesDue.length > 0) todos.push({
    key: `av-rate-${new Date().getFullYear()}`, icon: Percent, tone: 'action',
    text: `Taux servi ${new Date().getFullYear() - 1} : reportez le nouveau taux du fonds euros de ${avRatesDue.map(a => a.name).join(', ')}, publié par votre assureur en janvier.`,
    primary: onNavigate ? { label: 'Mes comptes', onClick: () => onNavigate('accounts') } : undefined,
    secondary: { label: 'Taux inchangé', onClick: confirmAvRates },
  });
  for (const a of ceilingAlerts) todos.push({
    key: `ceiling-${a.id}-${Math.floor(a.pct / 5)}`, icon: AlertTriangle, tone: 'info', snoozable: true,
    text: `${a.name} est rempli à ${Math.round(a.pct)} % : il reste ${formatEUR(a.remaining, 0)} avant le plafond.`,
    primary: onNavigate ? { label: 'Voir le plan', onClick: () => onNavigate('pilot') } : undefined,
  });
  if (exportDue) todos.push({
    key: 'export', icon: Download, tone: 'info', snoozable: true,
    text: 'Téléchargez une copie de vos données (tous les trois mois, par précaution).',
    detail: 'Pécule garde déjà une copie mensuelle sur votre Drive ; celle-ci reste chez vous.',
    primary: { label: 'Télécharger', onClick: onExport! },
  });
  if (emergency && !emergency.reached) todos.push({
    key: 'emergency', icon: LifeBuoy, tone: 'info', snoozable: true,
    text: `Épargne de précaution : il manque ${formatEUR(emergency.missing, 0)} pour couvrir ${emergency.months} mois de dépenses.`,
    detail: 'Gardez-la sur des livrets disponibles à tout moment avant de placer sur l\'assurance vie.',
  });


  const progressTrack = 'h-2 rounded-full bg-surface-container-highest overflow-hidden';
  const dateFieldClass = 'h-10 px-3 rounded-xs border border-outline bg-transparent text-sm text-on-surface tabular-nums hover:border-on-surface focus:border-indigo-600 dark:focus:border-indigo-300 outline-none dark:[color-scheme:dark]';

  // --- CARTE « PLACÉ DEPUIS LA PAIE » (jauge du mois + taux d'épargne) ---
  const savingsCard = ((monthPlan !== undefined && monthPlan > 0) || monthlyPay > 0) && (() => {
    const hasPlan = monthPlan !== undefined && monthPlan > 0;
    const plan = monthPlan || 0;
    const now = new Date();
    const periodEnd = payPeriod
      ? new Date(payPeriod.payDate.getFullYear(), payPeriod.payDate.getMonth() + 1, Math.min(paydayDay!, new Date(payPeriod.payDate.getFullYear(), payPeriod.payDate.getMonth() + 2, 0).getDate()))
      : new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const daysLeft = Math.max(0, daysBetween(now, periodEnd));
    const gaugeTitle = payPeriod ? `Placé depuis la paie du ${frenchDay(payPeriod.payDate)}` : 'Placé ce mois-ci';
    const pct = hasPlan ? Math.max(0, Math.min(100, (monthSaved / plan) * 100)) : 0;
    const done = hasPlan && monthSaved >= plan;
    const maxRate = Math.max(1, ...rateHistory.map(m => Math.abs(m.rate)));
    const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    return (
      <Card title={gaugeTitle} icon={PiggyBank} action={
        <p className="text-base font-medium text-on-surface tabular-nums whitespace-nowrap">
          {monthSaved < 0 ? formatSignedEUR(monthSaved, 0) : fmtEUR(monthSaved)}
          {hasPlan && <span className="text-on-surface-variant font-normal"> / {fmtEUR(plan)}</span>}
        </p>
      }>
        {hasPlan && (
          <div className={progressTrack} role="progressbar" aria-label={gaugeTitle} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <div className={`h-full rounded-full ${done ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        {hasPlan && (
          <p className="text-sm text-on-surface-variant mt-2">
            {done ? 'Objectif atteint.'
              : monthSaved < 0 ? `Vous avez plus retiré que versé (${fmtEUR(monthSaved)}).`
              : `Reste ${fmtEUR(plan - monthSaved)} à placer, ${daysLeft} jour${daysLeft > 1 ? 's' : ''} avant ${payPeriod ? 'la prochaine paie' : 'la fin du mois'}.`}
          </p>
        )}
        {monthlyPay > 0 && (
          <div className={hasPlan ? 'mt-5 pt-4 border-t border-outline-variant' : ''}>
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-3 mb-3">
              <p className="text-sm font-medium text-on-surface flex items-center gap-1.5 whitespace-nowrap"><Percent className="w-4 h-4 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /> Taux d'épargne</p>
              <p className="text-sm text-on-surface-variant">
                Ce mois-ci <span className="font-medium text-on-surface tabular-nums whitespace-nowrap">{Math.round(rateHistory[rateHistory.length - 1]?.rate ?? 0)} %</span>
                {avgRate !== null && <> · moyenne 12 mois <span className="font-medium text-on-surface tabular-nums whitespace-nowrap">{Math.round(avgRate)} %</span></>}
              </p>
            </div>
            <div className="flex items-end gap-1 h-20">
              {rateHistory.map((m, i) => {
                const h = Math.max(2, (Math.abs(m.rate) / maxRate) * 100);
                const current = i === rateHistory.length - 1;
                const monthName = parseISODate(`${m.month}-01`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
                return (
                  <button type="button" key={m.month} onClick={() => setRateMonth(rateMonth === m.month ? null : m.month)} aria-pressed={rateMonth === m.month}
                    aria-label={`${monthName}${current ? ' (en cours)' : ''} : ${Math.round(m.rate)} %, ${fmtEUR(m.saved)}${m.rate < 0 ? ', retrait net' : ''}`}
                    className="flex-1 flex flex-col items-center justify-end h-full gap-1 rounded-xs focus-visible:ring-2 focus-visible:ring-indigo-500">
                    <div className={`w-full rounded-t-xs ${m.rate < 0 ? 'bg-rose-500 dark:bg-rose-400' : current ? 'bg-indigo-300 dark:bg-indigo-700 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.35)_3px,rgba(255,255,255,.35)_5px)]' : 'bg-indigo-600 dark:bg-indigo-300'} ${rateMonth === m.month ? 'ring-2 ring-tertiary ring-offset-1 ring-offset-surface-container-lowest' : ''}`} style={{ height: `${h}%` }} />
                    <span className={`text-[11px] font-medium ${current ? 'text-on-surface underline' : 'text-on-surface-variant'}`}>{MONTH_INITIALS[Number(m.month.slice(5)) - 1]}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-on-surface-variant mt-2 min-h-5" aria-live="polite">
              {(() => { const m = rateHistory.find(x => x.month === rateMonth); return m ? `${parseISODate(`${m.month}-01`).toLocaleDateString('fr-FR', { month: 'long' })} : ${Math.round(m.rate)} % de la paie, ${formatSignedEUR(m.saved, 0)}.` : `Touchez un mois pour le détail. Part de votre paie (${fmtEUR(monthlyPay)}) mise de côté ; mois en cours hachuré, retraits en rouge.`; })()}
            </p>
          </div>
        )}
      </Card>
    );
  })();

  const availabilitySegments: AvailabilitySegment[] = [
    { key: 'available', label: 'Disponible tout de suite', hint: 'Livrets et comptes courants', amount: availabilityStats.available, color: 'bg-primary' },
    ...(availabilityStats.taxLocked > 0 ? [{ key: 'tax', label: 'Disponible avec impôt', hint: 'Assurance vie et PEA récents', amount: availabilityStats.taxLocked, color: 'bg-tertiary', hatch: 'light' as const }] : []),
    ...(availabilityStats.hardLocked > 0 ? [{ key: 'locked', label: 'Bloqué', hint: 'Retraite, épargne salariale', amount: availabilityStats.hardLocked, color: 'bg-outline', hatch: 'dense' as const }] : []),
  ];
  const moreSummary = `${projection ? 'Projection, évolution' : 'Évolution'} et répartition par établissement`;
  const showUnlockDetails = availabilityStats.taxLocked > 0 && (unlockCost.extraTax >= 1 || unlockCost.closesPea || !!unlockCost.nextFree || unlockCost.unknown.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader visuallyHidden title="Accueil" />
      <InstallPrompt />

      {/* 1. Où j'en suis : le chiffre principal, sa tendance et sa disponibilité. */}
      <Card variant="elevated" aria-label="Mon épargne nette">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <StatTile
            size="hero"
            label="Mon épargne nette"
            value={formatEUR(mySavings, 0)}
            delta={<DeltaBadge value={delta30} period="sur 30 jours" />}
            hint={<>
              Votre part, hors capital de vos parents
              {monthDelta !== null && <> · <MoneyText value={monthDelta} signed decimals={0} tone="auto" className="font-medium" /> depuis le début du mois</>}
            </>}
          />
          {spark.length >= 2 && (
            <div className="shrink-0 flex flex-col items-start sm:items-end gap-1">
              <Sparkline values={spark} width={200} height={56} className="max-w-full" />
              <p className="text-xs text-on-surface-variant">Tendance sur {spark.length} mois</p>
            </div>
          )}
        </div>
        <div className="mt-6 pt-5 border-t border-outline-variant">
          <AvailabilityBar segments={availabilitySegments}>
            {showUnlockDetails && (
              <div className="mt-4 rounded-xl bg-surface-container p-3 text-sm text-on-surface-variant space-y-1">
                {unlockCost.extraTax >= 1 && <p>Tout retirer aujourd'hui : <span className="font-medium text-on-surface tabular-nums">≈ {formatEUR(unlockCost.extraTax, 0)}</span> d'impôt en plus qu'après la maturité.</p>}
                {unlockCost.closesPea && <p className="flex items-center gap-1.5 text-error font-medium"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> Un retrait clôturerait votre PEA.</p>}
                {unlockCost.nextFree && <p>Libre de surcoût le <span className="font-medium text-on-surface tabular-nums">{parseISODate(unlockCost.nextFree.date).toLocaleDateString('fr-FR')}</span> ({unlockCost.nextFree.name}).</p>}
                {unlockCost.unknown.length > 0 && <p>Versements à renseigner pour chiffrer : {unlockCost.unknown.join(', ')}.</p>}
              </div>
            )}
          </AvailabilityBar>
        </div>
      </Card>

      {/* 2. Ce qu'il y a à faire. */}
      <TodoList items={todos} />

      {/* 3. Le mois en cours et ce qui arrive. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {savingsCard}

        {emergency && (
          <Card title="Épargne de précaution" icon={LifeBuoy} action={
            <p className="text-base font-medium text-on-surface tabular-nums whitespace-nowrap">{fmtEUR(emergency.current)} <span className="text-on-surface-variant font-normal">/ {fmtEUR(emergency.target)}</span></p>
          }>
            <div className={progressTrack} role="progressbar" aria-label="Épargne de précaution" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(emergency.pct)}>
              <div className={`h-full rounded-full ${emergency.reached ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-primary'}`} style={{ width: `${emergency.pct}%` }} />
            </div>
            <p className="text-sm text-on-surface-variant mt-2">
              {emergency.reached ? 'Atteinte. ' : `Il manque ${fmtEUR(emergency.missing)}. `}
              {emergency.months} mois de dépenses ({fmtEUR(emergency.monthlySpending)} par mois), sur vos livrets et comptes courants, votre part seulement.
            </p>
            {onSetEmergencyMonths && (
              <SegmentedButton
                className="mt-4"
                label="Nombre de mois"
                options={[{ value: '3', label: '3 mois' }, { value: '6', label: '6 mois' }]}
                value={String(emergency.months)}
                onChange={v => onSetEmergencyMonths(Number(v))}
              />
            )}
          </Card>
        )}

        {agendaNext.length > 0 && (
          <Card title="Prochaines échéances" icon={CalendarDays} action={onNavigate && <Button variant="text" onClick={() => onNavigate('agenda')} className="-my-2">Tout voir</Button>}>
            <ul className="divide-y divide-outline-variant -my-2">
              {agendaNext.map(e => (
                <li key={`${e.date}-${e.title}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate text-on-surface font-medium">{e.title}</span>
                  <span className="shrink-0 text-on-surface-variant tabular-nums">{frenchDay(parseISODate(e.date), true)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {upcomingDebits.length > 0 && (
          <Card title="Prélèvements des 7 prochains jours" icon={CalendarClock} action={
            <p className="text-base font-medium text-on-surface tabular-nums whitespace-nowrap"><span className="sr-only">Total : </span>{formatEUR(upcomingDebits.reduce((sum, x) => sum + x.s.amount, 0))}</p>
          }>
            <ul className="divide-y divide-outline-variant -my-2">
              {upcomingDebits.map(({ s, date, inDays }) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-on-surface">{s.name}</span>{s.debitAccount && <span className="text-on-surface-variant"> · {s.debitAccount}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <MoneyText value={s.amount} className="font-medium text-on-surface" />
                    <span className="block text-xs text-on-surface-variant">{inDays === 0 ? "aujourd'hui" : inDays === 1 ? 'demain' : frenchDay(date, true)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {/* 4. Pour aller plus loin : repliable, mémorisé. */}
      <div>
        <button
          type="button"
          onClick={toggleMore}
          aria-expanded={moreOpen}
          aria-controls="home-more"
          className="w-full flex items-center justify-between gap-3 px-5 py-3 rounded-2xl border border-outline-variant text-left hover:bg-on-surface/4 transition-colors"
        >
          <span className="min-w-0">
            <span className="block text-base font-medium text-on-surface">Plus de détails</span>
            <span className="block text-sm text-on-surface-variant">{moreSummary}</span>
          </span>
          <ChevronDown className={`w-5 h-5 shrink-0 text-on-surface-variant transition-transform ${moreOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>

        {moreOpen && (
          <div id="home-more" className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {projection && (
              <Card title="Projection de trajectoire" icon={TrendingUp}>
                <p className="text-sm text-on-surface-variant -mt-2 mb-4">
                  Extrapolation du rythme réel des 90 derniers jours ({projection.monthlyRate >= 0 ? '+' : ''}{fmtEUR(projection.monthlyRate)} par mois) : une estimation, pas une garantie.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile className="p-4 rounded-xl bg-surface-container" label="Dans 6 mois" value={fmtEUR(projection.in6)} />
                  <StatTile className="p-4 rounded-xl bg-surface-container" label="Dans 12 mois" value={fmtEUR(projection.in12)} />
                </div>
                {projection.drift && (
                  <div className={`mt-4 flex items-start gap-2 p-3 rounded-xl text-sm ${projection.drift.changeRatio < 0 ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'}`}>
                    {projection.drift.changeRatio < 0
                      ? <TrendingDown className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      : <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />}
                    <span>
                      Votre rythme d'épargne a {projection.drift.changeRatio < 0 ? 'ralenti' : 'accéléré'} de {Math.abs(Math.round(projection.drift.changeRatio * 100))} %
                      par rapport au trimestre précédent ({fmtEUR(projection.drift.previousMonthlyRate)} par mois → {fmtEUR(projection.monthlyRate)} par mois).
                    </span>
                  </div>
                )}
              </Card>
            )}

            <Card title="Par établissement" icon={Landmark}>
              <div style={{ height: Math.max(190, dataByInstitution.length * 44 + 70) }}>
                <Suspense fallback={<div className="h-full w-full rounded-xl bg-surface-container animate-pulse" aria-hidden />}>
                  <InstitutionChart data={dataByInstitution} />
                </Suspense>
              </div>
            </Card>

            <Card className="lg:col-span-2" title="Évolution de mon épargne nette" icon={ChartLine}>
              <div className="flex flex-col gap-3 -mt-2 mb-4">
                <p className="text-sm text-on-surface-variant">
                  {accounts.some(a => isConstrainedAccount(a.type)) ? 'Zones hachurées : épargne disponible seulement avec impôt ou bloquée.' : 'Votre part, compte par compte.'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" value={dateRange.start} onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))} aria-label="Début de la période" className={dateFieldClass} />
                  <span className="text-on-surface-variant text-sm">à</span>
                  <input type="date" value={dateRange.end} onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))} aria-label="Fin de la période" className={dateFieldClass} />
                  <Button variant="tonal" onClick={exportSession}><Save className="w-4 h-4" aria-hidden="true" /> Export CSV</Button>
                </div>
              </div>
              <div className="h-80">
                <Suspense fallback={<div className="h-full w-full rounded-xl bg-surface-container animate-pulse" aria-hidden />}>
                  <StackedSavingsChart stackedData={stackedData} accounts={accounts} getAccountColor={getAccountColor} isConstrainedAccount={isConstrainedAccount} />
                </Suspense>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};
