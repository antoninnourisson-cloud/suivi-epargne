import React, { useState, useMemo, useEffect, Suspense } from 'react';

// Graphiques chargés à part (recharts) : les cartes s'affichent sans les attendre.
const StackedSavingsChart = lazyWithRetry(() => import('./DashboardCharts').then(m => ({ default: m.StackedSavingsChart })));
const InstitutionChart = lazyWithRetry(() => import('./DashboardCharts').then(m => ({ default: m.InstitutionChart })));
import { accountColor } from '../lib/chartTheme';
import { TodoList, TodoSpec } from './TodoList';
import type { View } from '../navigation';
import type { EmergencyFund } from '../lib/planning';
import type { AgendaEvent } from '../lib/agenda';
import { Sprout, LifeBuoy, Download, CalendarDays } from 'lucide-react';
import { lazyWithRetry } from './ErrorBoundary';
import { SavingsAccount, PortfolioSnapshot, AccountType, Expense, FiscalConfig, WorkBenefits, RecurringMovement, Subscription } from '../types';
import { Landmark, CalendarClock, Save, AlertTriangle, Trash2, Clock, TrendingUp, TrendingDown, PiggyBank, Percent, ShieldAlert, Repeat } from 'lucide-react';
import { computeAccruedParentalInterest, computeRecentSavingsRate, computeAccountBalanceAtDate, findStaleRegulatedRates, computeLepEligibility, computeIncome, findDueRecurring, computeMonthSavedAmount, computeSavedSince, payPeriodOf, computeSavingsRateHistory, computeUnlockCost, findFiscalReview, applyTaxScale, nextSubscriptionDate, findAvRateUpdatesDue } from '../lib/finance';
import { parseISODate, formatISODay, daysBetween, localTodayISO } from '../lib/dates';
import { Button } from './Button';
import { formatEUR, formatSignedEUR, frenchDay, formatPeriod } from '../lib/format';
import { InstallPrompt } from './InstallPrompt';
import { RegulatedRatesEditor } from './RegulatedRatesEditor';
import { signedAmount, round2 } from '../lib/money';

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
}

export const Dashboard: React.FC<DashboardProps> = ({ accounts, history, fiscalConfig, workBenefits, onDeleteAccount, config, recurringMovements = [], onRecordRecurring, monthPlan, monthlyPay = 0, paydayDay, trackingStartDate, subscriptions = [], onUpdateFiscalConfig, onOpenSettings, onUpdateAccounts, payRaise, onAcceptPayRaise, onDismissPayRaise, onNavigate, onAddAccount, lastExportAt, onExport, emergency, onSetEmergencyMonths, agendaNext = [] }) => {
  const [dateRange, setDateRange] = useState(() => {
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
    localStorage.setItem('dashboard_date_range', JSON.stringify(dateRange));
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
  const getAccountStatus = (account: SavingsAccount): 'AVAILABLE' | 'TAX_LOCKED' | 'HARD_LOCKED' => {
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
  };

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
  }, [accounts, fiscalConfig]);

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
    const data: any[] = [];
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

      const daySnapshot: any = {
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
  const lepStatus = useMemo(() => {
    if (!workBenefits) return null;
    const breakdown = computeIncome(
      { grossAnnual: config.grossAnnual, extraMonthlyIncome: 0, navigoBase: config.navigoBase, navigoRate: config.navigoRate, taxRateManual: config.taxRateManual },
      fiscalConfig,
      workBenefits
    );
    return computeLepEligibility(accounts, breakdown.netTaxableYear, fiscalConfig);
  }, [accounts, config, fiscalConfig, workBenefits]);

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

  // Regroupement insensible aux espaces et à la casse : « BPVF » et « BPVF  » formaient
  // deux barres distinctes.
  const dataByInstitution = Object.values(accounts.reduce((acc, curr) => {
    const name = (curr.institution || 'Sans établissement').trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (!acc[key]) acc[key] = { name, value: 0 };
    acc[key].value += curr.ownedAmount;
    return acc;
  }, {} as Record<string, { name: string, value: number }>));

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

  const StatCard = ({ title, amount, subtext, extra, hero }: { title: string; amount: number; subtext?: string; extra?: React.ReactNode; hero?: React.ReactNode }) => (
    <div className="bg-white dark:bg-slate-800 p-4 md:p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 min-w-0">
      <p className="text-slate-600 dark:text-slate-300 text-xs md:text-sm font-bold">{title}</p>
      <p className={`${hero ? 'text-3xl md:text-4xl' : 'text-xl md:text-2xl'} font-black text-slate-800 dark:text-slate-100 mt-1 tabular-nums`}>{formatEUR(amount, 0)}</p>
      {subtext && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-bold">{subtext}</p>}
      {hero}
      {extra}
    </div>
  );

  if (accounts.length === 0) return (
    <section aria-labelledby="welcome-title" className="max-w-xl mx-auto bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-8 mt-6 text-center shadow-sm">
      <Sprout className="w-10 h-10 text-indigo-600 mx-auto mb-3" aria-hidden="true" />
      <h2 id="welcome-title" className="text-2xl font-black text-slate-800 dark:text-slate-100">Bienvenue dans Pécule</h2>
      <p className="text-slate-600 dark:text-slate-300 mt-2">Trois étapes pour faire pousser votre épargne :</p>
      <ol className="text-left mt-6 space-y-3 text-sm text-slate-700 dark:text-slate-200">
        <li className="flex gap-3"><span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0">1</span> Ajoutez vos comptes (Livret A, LEP, assurance vie…) avec leur solde.</li>
        <li className="flex gap-3"><span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0">2</span> Indiquez votre salaire et vos charges dans le Pilotage.</li>
        <li className="flex gap-3"><span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0">3</span> Choisissez votre jour de paie : Pécule vous dira quoi placer, et où.</li>
      </ol>
      <div className="mt-8 flex flex-col sm:flex-row gap-2 justify-center">
        {onAddAccount && <button onClick={onAddAccount} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-black">Ajouter mon premier compte</button>}
        {onNavigate && <button onClick={() => onNavigate('pilot')} className="px-6 py-3 rounded-xl font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700">Ouvrir le Pilotage</button>}
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
  if (lepStatus && lepStatus.status !== 'ok') todos.push({
    key: `lep-${lepStatus.status}`, icon: ShieldAlert, tone: 'info', snoozable: true,
    text: lepStatus.status === 'exceeded'
      ? <>Votre revenu estimé ({fmtEUR(lepStatus.estimatedRfr)}) dépasse le plafond du LEP ({fmtEUR(lepStatus.ceiling)}) : votre banque pourrait ne pas le reconduire.</>
      : <>Votre revenu estimé ({fmtEUR(lepStatus.estimatedRfr)}) approche du plafond du LEP ({fmtEUR(lepStatus.ceiling)}) : il reste {lepStatus.marginPct.toLocaleString('fr-FR', { maximumFractionDigits: lepStatus.marginPct < 1 ? 1 : 0 })} % de marge.</>,
    detail: 'Estimation depuis votre salaire. Le vrai critère est le revenu fiscal de référence de votre avis d\'imposition.',
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

  return (
    <div className="space-y-6">
      <InstallPrompt />

      <TodoList items={todos} />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
        <div className="col-span-2"><StatCard title="Mon épargne nette" amount={mySavings} subtext="Votre part, hors capital de vos parents" hero={monthDelta !== null ? <p className={`text-xs font-bold mt-1 ${monthDelta >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>{formatSignedEUR(monthDelta, 0)} depuis le début du mois</p> : undefined} /></div>
        <StatCard title="Disponible tout de suite" amount={availabilityStats.available} subtext="Livrets et comptes courants" />
        {availabilityStats.taxLocked > 0 && <StatCard title="Disponible avec impôt" amount={availabilityStats.taxLocked} subtext="Assurance vie et PEA récents" extra={availabilityStats.taxLocked > 0 && (
          <div className="mt-2 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
            {unlockCost.extraTax >= 1 && <p>Tout retirer aujourd'hui : <b>≈ {formatEUR(unlockCost.extraTax, 0)}</b> d'impôt en plus qu'après la maturité.</p>}
            {unlockCost.closesPea && <p className="text-rose-700 dark:text-rose-400 font-bold">Un retrait clôturerait votre PEA.</p>}
            {unlockCost.nextFree && <p>Libre de surcoût le <b>{parseISODate(unlockCost.nextFree.date).toLocaleDateString('fr-FR')}</b> ({unlockCost.nextFree.name}).</p>}
            {unlockCost.unknown.length > 0 && <p className="text-slate-500 dark:text-slate-400">Versements à renseigner pour chiffrer : {unlockCost.unknown.join(', ')}.</p>}
          </div>
        )} />}
        {availabilityStats.hardLocked > 0 && <StatCard title="Bloqué" amount={availabilityStats.hardLocked} subtext="Retraite, épargne salariale" />}
      </div>

      {/* Sur grand écran, les cartes se rangent sur deux colonnes au lieu de s'étirer. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      {emergency && (
        <section aria-labelledby="emergency-title" className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h3 id="emergency-title" className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><LifeBuoy className="w-4 h-4 text-indigo-600" aria-hidden="true" /> Épargne de précaution</h3>
            <p className="text-sm font-black text-slate-700 dark:text-slate-200">{fmtEUR(emergency.current)} <span className="text-slate-500 dark:text-slate-400 font-bold">/ {fmtEUR(emergency.target)}</span></p>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden" role="progressbar" aria-label="Épargne de précaution" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(emergency.pct)}>
            <div className={`h-full rounded-full ${emergency.reached ? 'bg-emerald-500' : 'bg-indigo-600'}`} style={{ width: `${emergency.pct}%` }} />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">
            {emergency.reached ? 'Atteinte. ' : `Il manque ${fmtEUR(emergency.missing)}. `}
            {emergency.months} mois de dépenses ({fmtEUR(emergency.monthlySpending)} par mois), sur vos livrets et comptes courants, votre part seulement.
          </p>
          {onSetEmergencyMonths && (
            <div className="mt-3 flex items-center gap-2" role="group" aria-label="Nombre de mois">
              {[3, 6].map(m => (
                <button key={m} onClick={() => onSetEmergencyMonths(m)} aria-pressed={emergency.months === m} className={`px-3 py-1 rounded-full text-xs font-bold border ${emergency.months === m ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{m} mois</button>
              ))}
            </div>
          )}
        </section>
      )}

      {agendaNext.length > 0 && (
        <section aria-labelledby="agenda-next-title" className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h3 id="agenda-next-title" className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-indigo-600" aria-hidden="true" /> Prochaines échéances</h3>
            {onNavigate && <button onClick={() => onNavigate('agenda')} className="text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:underline">Tout voir</button>}
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {agendaNext.map(e => (
              <li key={`${e.date}-${e.title}`} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200 font-bold">{e.title}</span>
                <span className="flex-shrink-0 text-xs text-slate-500 dark:text-slate-400">{frenchDay(parseISODate(e.date), true)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {upcomingDebits.length > 0 && (
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-indigo-600" /> Prélèvements des 7 prochains jours</h3>
            <p className="text-sm font-black text-slate-700 dark:text-slate-200">{formatEUR(upcomingDebits.reduce((sum, x) => sum + x.s.amount, 0))}</p>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {upcomingDebits.map(({ s, date, inDays }) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
                  <b>{s.name}</b>{s.debitAccount && <span className="text-slate-500 dark:text-slate-400"> · {s.debitAccount}</span>}
                </span>
                <span className="flex-shrink-0 text-right">
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{formatEUR(s.amount)}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">{inDays === 0 ? "aujourd'hui" : inDays === 1 ? 'demain' : frenchDay(date, true)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {((monthPlan !== undefined && monthPlan > 0) || monthlyPay > 0) && (() => {
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
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><PiggyBank className="w-4 h-4 text-indigo-600" /> {gaugeTitle}</h3>
              <p className="text-sm font-black text-slate-700 dark:text-slate-200">{monthSaved < 0 ? formatSignedEUR(monthSaved, 0) : fmtEUR(monthSaved)}{hasPlan && <span className="text-slate-500 dark:text-slate-400 font-bold"> / {fmtEUR(plan)}</span>}</p>
            </div>
            {hasPlan && (
              <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden" role="progressbar" aria-label={gaugeTitle} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                <div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-indigo-600'}`} style={{ width: `${pct}%` }} />
              </div>
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
              {!hasPlan ? '' : done ? 'Objectif atteint. '
                : monthSaved < 0 ? `Vous avez plus retiré que versé (${fmtEUR(monthSaved)}). `
                : `Reste ${fmtEUR(plan - monthSaved)} à placer, ${daysLeft} jour${daysLeft > 1 ? 's' : ''} avant ${payPeriod ? 'la prochaine paie' : 'la fin du mois'}.`}
            </p>
            {monthlyPay > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700">
                <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-3 mb-2">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 whitespace-nowrap"><Percent className="w-3.5 h-3.5 text-indigo-600" /> Taux d'épargne</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ce mois-ci <b className="text-slate-800 dark:text-slate-100">{Math.round(rateHistory[rateHistory.length - 1]?.rate ?? 0)} %</b>
                    {avgRate !== null && <> · moyenne 12 mois <b className="text-slate-800 dark:text-slate-100">{Math.round(avgRate)} %</b></>}
                  </p>
                </div>
                <div className="flex items-end gap-1 h-16">
                  {rateHistory.map((m, i) => {
                    const h = Math.max(2, (Math.abs(m.rate) / maxRate) * 100);
                    const current = i === rateHistory.length - 1;
                    const monthName = parseISODate(`${m.month}-01`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
                    return (
                      <button type="button" key={m.month} onClick={() => setRateMonth(rateMonth === m.month ? null : m.month)} aria-pressed={rateMonth === m.month}
                        aria-label={`${monthName}${current ? ' (en cours)' : ''} : ${Math.round(m.rate)} %, ${fmtEUR(m.saved)}${m.rate < 0 ? ', retrait net' : ''}`}
                        className="flex-1 flex flex-col items-center justify-end h-full gap-1 rounded focus-visible:ring-2 focus-visible:ring-indigo-500">
                        <div className={`w-full rounded-sm ${m.rate < 0 ? 'bg-rose-500' : current ? 'bg-indigo-300 dark:bg-indigo-700 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.35)_3px,rgba(255,255,255,.35)_5px)]' : 'bg-indigo-600'} ${rateMonth === m.month ? 'ring-2 ring-amber-400' : ''}`} style={{ height: `${h}%` }} />
                        <span className={`text-[11px] font-bold ${current ? 'text-slate-800 dark:text-slate-100 underline' : 'text-slate-500 dark:text-slate-400'}`}>{MONTH_INITIALS[Number(m.month.slice(5)) - 1]}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 min-h-[1.25rem]" aria-live="polite">
                  {(() => { const m = rateHistory.find(x => x.month === rateMonth); return m ? `${parseISODate(`${m.month}-01`).toLocaleDateString('fr-FR', { month: 'long' })} : ${Math.round(m.rate)} % de la paie, ${formatSignedEUR(m.saved, 0)}.` : `Touchez un mois pour le détail. Part de votre paie (${fmtEUR(monthlyPay)}) mise de côté ; mois en cours hachuré, retraits en rouge.`; })()}
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {projection && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg bg-indigo-600"><TrendingUp className="w-4 h-4 text-white" /></div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Projection de trajectoire</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Extrapolation du rythme réel des 90 derniers jours ({projection.monthlyRate >= 0 ? '+' : ''}{fmtEUR(projection.monthlyRate)}/mois) — une estimation, pas une garantie.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900">
              <p className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wide">Dans 6 mois</p>
              <p className="text-xl font-black text-slate-800 dark:text-slate-100 mt-1">{fmtEUR(projection.in6)}</p>
            </div>
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900">
              <p className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wide">Dans 12 mois</p>
              <p className="text-xl font-black text-slate-800 dark:text-slate-100 mt-1">{fmtEUR(projection.in12)}</p>
            </div>
          </div>

          {projection.drift && (
            <div className={`mt-4 flex items-start gap-2 p-3 rounded-lg text-xs font-bold ${projection.drift.changeRatio < 0 ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'}`}>
              {projection.drift.changeRatio < 0
                ? <TrendingDown className="w-4 h-4 flex-shrink-0 mt-0.5" />
                : <TrendingUp className="w-4 h-4 flex-shrink-0 mt-0.5" />}
              <span>
                Votre rythme d'épargne a {projection.drift.changeRatio < 0 ? 'ralenti' : 'accéléré'} de {Math.abs(Math.round(projection.drift.changeRatio * 100))}%
                par rapport au trimestre précédent ({fmtEUR(projection.drift.previousMonthlyRate)}/mois → {fmtEUR(projection.monthlyRate)}/mois).
              </span>
            </div>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 xl:col-span-2">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Évolution de mon épargne nette</h3>
            {accounts.some(a => isConstrainedAccount(a.type)) && <p className="text-[11px] text-slate-500 dark:text-slate-400">Zones hachurées : épargne disponible seulement avec impôt ou bloquée.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={dateRange.start} onChange={(e) => setDateRange((prev: any) => ({ ...prev, start: e.target.value }))} aria-label="Début de la période" className="bg-slate-50 dark:bg-slate-900 text-sm border border-slate-200 dark:border-slate-700 p-2 rounded-lg" />
            <span className="text-slate-500 dark:text-slate-400 text-sm">à</span>
            <input type="date" value={dateRange.end} onChange={(e) => setDateRange((prev: any) => ({ ...prev, end: e.target.value }))} aria-label="Fin de la période" className="bg-slate-50 dark:bg-slate-900 text-sm border border-slate-200 dark:border-slate-700 p-2 rounded-lg" />
            <Button onClick={exportSession} variant="secondary" className="text-xs h-9 gap-2">
              <Save className="w-4 h-4 text-indigo-600" /> Export CSV
            </Button>
          </div>
        </div>
        <div className="h-80">
        <Suspense fallback={<div className="h-full w-full rounded-lg bg-slate-100 dark:bg-slate-900 animate-pulse" aria-hidden />}>
          <StackedSavingsChart stackedData={stackedData} accounts={accounts} getAccountColor={getAccountColor} isConstrainedAccount={isConstrainedAccount} />
        </Suspense>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-4">Par établissement</h3>
        <div style={{ height: Math.max(120, dataByInstitution.length * 44) }}>
        <Suspense fallback={<div className="h-full w-full rounded-lg bg-slate-100 dark:bg-slate-900 animate-pulse" aria-hidden />}>
          <InstitutionChart data={dataByInstitution} />
        </Suspense>
        </div>
      </div>
      </div>
    </div>
  );
};