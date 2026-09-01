import React, { useState, useMemo, useEffect } from 'react';
import { 
  ResponsiveContainer, Tooltip as RechartsTooltip, Legend, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area 
} from 'recharts';
import { SavingsAccount, PortfolioSnapshot, AccountType, Expense, FiscalConfig } from '../types';
import { Euro, Lock, Wallet, Filter, Unlock, Save, AlertTriangle, Trash2, Clock, TrendingUp, TrendingDown, PiggyBank } from 'lucide-react';
import { computeParentalInterest, computeRecentSavingsRate, computeAccountBalanceAtDate } from '../lib/finance';
import { parseISODate, formatISODay, daysBetween, localTodayISO } from '../lib/dates';
import { Button } from './Button';

interface DashboardProps {
  accounts: SavingsAccount[];
  history: PortfolioSnapshot[];
  expenses: Expense[];
  fiscalConfig: FiscalConfig;
  onDeleteAccount?: (account: SavingsAccount) => void;
  config: {
    grossAnnual: number;
    navigoBase: number;
    navigoRate: number;
    taxRateManual: number;
  };
}

export const Dashboard: React.FC<DashboardProps> = ({ accounts, history, expenses, fiscalConfig, onDeleteAccount, config }) => {
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
  // le fait déjà le graphique — sinon la carte "Mon Épargne Nette" et le dernier point de
  // la courbe divergeaient dès qu'un mouvement futur existait.
  const ownedToday = (acc: SavingsAccount): number => {
    const today = localTodayISO();
    let balance = acc.ownedAmount;
    (acc.movements || []).forEach(m => {
      if (m.date > today) balance -= m.type === 'IN' ? m.amount : -m.amount;
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
      .filter(x => x.pct >= 90)
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
  // l'Horloge Fiscale) : ils étaient codés en dur ici (5/8), seul écran incapable de suivre
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
        const flow = m.type === 'IN' ? m.amount : -m.amount;
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
        const safeAmount = Math.round(amount * 100) / 100;
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
    return data;
  }, [accounts, dateRange]);

  // --- PROJECTION DE TRAJECTOIRE ---
  // Extrapole le rythme d'épargne RÉEL observé sur les 90 derniers jours (indépendant du
  // filtre de dates du graphique ci-dessus, pour rester stable même si l'utilisateur change
  // la période affichée). `computeRecentSavingsRate`/`computeAccountBalanceAtDate` sont
  // partagées avec Objectifs, pour que les deux écrans ne puissent jamais raconter deux
  // rythmes différents.
  const projection = useMemo(() => {
    const now = new Date();
    const monthlyRate = computeRecentSavingsRate(accounts, 90, now);
    if (monthlyRate === null || Math.abs(monthlyRate) < 1) return null; // pas assez d'historique, ou rythme quasi nul

    const totalNow = computeAccountBalanceAtDate(accounts, now.toISOString().split('T')[0]);

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

  const fmtEUR = (v: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);

  // --- RAPPEL DE FIN D'ANNÉE : INTÉRÊTS PARENTAUX ---
  // Le capital que les parents ont placé sur ces comptes reste intouchable, mais ses
  // intérêts sont offerts en fin d'année (accord familial, pas une règle fiscale) — même
  // calcul que Rendement (`computeParentalInterest`), affiché ici en rappel ponctuel plutôt
  // que d'obliger à aller consulter cet onglet spécifiquement en décembre.
  const parentalYearEndReminder = useMemo(() => {
    const now = new Date();
    if (now.getMonth() !== 11) return null; // uniquement en décembre
    const { totalAnnualParental } = computeParentalInterest(accounts, now.getFullYear());
    return totalAnnualParental > 1 ? totalAnnualParental : null;
  }, [accounts]);

  const dataByInstitution = Object.values(accounts.reduce((acc, curr) => {
    const key = curr.institution;
    if (!acc[key]) acc[key] = { name: key, value: 0 };
    acc[key].value += curr.ownedAmount;
    return acc;
  }, {} as Record<string, { name: string, value: number }>));

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
  // Couleur stable par IDENTITÉ de compte (hash de l'id), plus par position dans le
  // tableau : supprimer/restaurer/réordonner un compte remélangait toutes les couleurs du
  // graphique et de sa légende.
  const getAccountColor = (accountId: string) => {
    let h = 0;
    for (let i = 0; i < accountId.length; i++) h = (h * 31 + accountId.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  };

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

  const StatCard = ({ title, amount, icon: Icon, color, subtext }: any) => (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">{title}</p>
          <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">
            {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)}
          </h3>
          {subtext && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 uppercase font-bold tracking-wide">{subtext}</p>}
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );

  if (accounts.length === 0) return <div className="text-center py-20 text-slate-600 dark:text-slate-300">Aucune donnée disponible.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-medium">
            <Filter className="w-4 h-4" />
            <span>Dashboard</span>
          </div>
          <Button onClick={exportSession} variant="secondary" className="text-xs h-9 gap-2">
            <Save className="w-4 h-4 text-indigo-600" />
            Sauvegarder l'état (CSV)
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dateRange.start} onChange={(e) => setDateRange((prev: any) => ({ ...prev, start: e.target.value }))} className="bg-slate-50 dark:bg-slate-900 text-sm border p-2 rounded-lg" />
          <span className="text-slate-400 dark:text-slate-500 text-sm">à</span>
          <input type="date" value={dateRange.end} onChange={(e) => setDateRange((prev: any) => ({ ...prev, end: e.target.value }))} className="bg-slate-50 dark:bg-slate-900 text-sm border p-2 rounded-lg" />
        </div>
      </div>

      {daysSinceLastUpdate !== null && daysSinceLastUpdate >= 21 && (
        <div className="flex items-center gap-3 p-3 rounded-xl border bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold">
          <Clock className="w-4 h-4 flex-shrink-0" />
          Aucune actualisation de solde depuis {daysSinceLastUpdate} jours — pense à mettre tes comptes à jour.
        </div>
      )}

      {parentalYearEndReminder !== null && (
        <div className="flex items-center gap-3 p-3 rounded-xl border bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900 text-indigo-800 dark:text-indigo-300 text-sm font-bold">
          <PiggyBank className="w-4 h-4 flex-shrink-0" />
          Rappel de fin d'année : les intérêts générés cette année par la part de tes parents représentent environ {fmtEUR(parentalYearEndReminder)} — normalement à toi d'après votre accord (le capital, lui, reste intouchable).
        </div>
      )}

      {inactiveEmptyAccounts.length > 0 && onDeleteAccount && (
        <div className="space-y-2">
          {inactiveEmptyAccounts.map(a => (
            <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-sm">
              <span className="text-slate-600 dark:text-slate-300 font-bold flex items-center gap-2"><Trash2 className="w-4 h-4 text-slate-400 dark:text-slate-500" /> {a.name} est à 0€ et inactif — le supprimer ?</span>
              <button onClick={() => onDeleteAccount(a)} className="text-xs font-bold text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg flex-shrink-0">Supprimer</button>
            </div>
          ))}
        </div>
      )}

      {ceilingAlerts.length > 0 && (
        <div className="space-y-2">
          {ceilingAlerts.map(a => {
            const full = a.pct >= 100;
            return (
              <div key={a.id} className={`flex items-center gap-3 p-3 rounded-xl border text-sm font-bold ${full ? 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300' : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300'}`}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {full
                  ? <span>{a.name} ({a.type}) est au plafond ({a.ceiling.toLocaleString()} €). Redirige tes prochains versements ailleurs.</span>
                  : <span>{a.name} ({a.type}) est rempli à {a.pct.toFixed(0)}% — il reste {Math.round(a.remaining).toLocaleString()} € avant le plafond.</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Mon Épargne Nette" amount={mySavings} icon={Wallet} color="bg-indigo-600" subtext="Capital réel" />
        <StatCard title="Disponibilité Immédiate" amount={availabilityStats.available} icon={Unlock} color="bg-emerald-500" subtext="Liquide" />
        <StatCard title="Contrainte Fiscale" amount={availabilityStats.taxLocked} icon={Euro} color="bg-amber-500" subtext="AV/PEA récents" />
        <StatCard title="Bloqué" amount={availabilityStats.hardLocked} icon={Lock} color="bg-slate-800" subtext="Retraite/PEE" />
      </div>

      {projection && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg bg-indigo-600"><TrendingUp className="w-4 h-4 text-white" /></div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Projection de trajectoire</h3>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Extrapolation du rythme réel des 90 derniers jours ({projection.monthlyRate >= 0 ? '+' : ''}{fmtEUR(projection.monthlyRate)}/mois) — une estimation, pas une garantie.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900">
              <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wide">Dans 6 mois</p>
              <p className="text-xl font-black text-slate-800 dark:text-slate-100 mt-1">{fmtEUR(projection.in6)}</p>
            </div>
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900">
              <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wide">Dans 12 mois</p>
              <p className="text-xl font-black text-slate-800 dark:text-slate-100 mt-1">{fmtEUR(projection.in12)}</p>
            </div>
          </div>

          {projection.drift && (
            <div className={`mt-4 flex items-start gap-2 p-3 rounded-lg text-xs font-bold ${projection.drift.changeRatio < 0 ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'}`}>
              {projection.drift.changeRatio < 0
                ? <TrendingDown className="w-4 h-4 flex-shrink-0 mt-0.5" />
                : <TrendingUp className="w-4 h-4 flex-shrink-0 mt-0.5" />}
              <span>
                Ton rythme d'épargne a {projection.drift.changeRatio < 0 ? 'ralenti' : 'accéléré'} de {Math.abs(Math.round(projection.drift.changeRatio * 100))}%
                par rapport au trimestre précédent ({fmtEUR(projection.drift.previousMonthlyRate)}/mois → {fmtEUR(projection.monthlyRate)}/mois).
              </span>
            </div>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 h-96">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Évolution de mon Épargne Nette (Empilé)</h3>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={stackedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {accounts.map(acc => {
                const color = getAccountColor(acc.id);
                const isHatched = isConstrainedAccount(acc.type);
                return (
                  <React.Fragment key={acc.id}>
                    <linearGradient id={`color-${acc.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
                      <stop offset="95%" stopColor={color} stopOpacity={0.1}/>
                    </linearGradient>
                    <pattern id={`stripe-${acc.id}`} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                       <rect width="100%" height="100%" fill="white" fillOpacity="0" />
                       <path d="M 0 0 L 0 8" stroke={color} strokeWidth="3" strokeOpacity="0.5" />
                       <rect width="100%" height="100%" fill={color} fillOpacity="0.1" /> 
                    </pattern>
                  </React.Fragment>
                );
              })}
            </defs>
            <XAxis dataKey="displayDate" tick={{ fontSize: 10 }} minTickGap={30} />
            <YAxis tickFormatter={(val) => `${(val/1000).toFixed(1)}k`} tick={{ fontSize: 10 }} />
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <RechartsTooltip 
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              itemStyle={{ fontSize: '12px', padding: 0 }}
              formatter={(value: number, name: string) => {
                const accName = accounts.find(a => a.id === name)?.name || name;
                if (name === 'total') return [new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value), "TOTAL"];
                return [new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value), accName];
              }}
              labelStyle={{ color: '#64748b', marginBottom: '0.5rem', fontWeight: 'bold' }}
            />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} formatter={(value) => accounts.find(a => a.id === value)?.name || value} />
            {accounts.map(acc => (
              <Area
                key={acc.id}
                type="monotone"
                dataKey={acc.id}
                name={acc.id}
                stackId="1"
                stroke={getAccountColor(acc.id)}
                fill={isConstrainedAccount(acc.type) ? `url(#stripe-${acc.id})` : `url(#color-${acc.id})`}
                fillOpacity={1}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 h-80">
        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Par Établissement</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dataByInstitution} layout="vertical">
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" width={150} tick={{fontSize: 11, fontWeight: 500}} />
            <RechartsTooltip formatter={(v: number) => `${v.toLocaleString()}€`} cursor={{fill: 'transparent'}} />
            <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};