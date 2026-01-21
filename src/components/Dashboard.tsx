import React, { useState, useMemo, useEffect } from 'react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area 
} from 'recharts';
import { SavingsAccount, PortfolioSnapshot, AccountType, Expense } from '../types';
import { Euro, TrendingUp, Lock, Wallet, Calendar, Filter, Unlock, Save, Download } from 'lucide-react';
import { Button } from './Button';

interface DashboardProps {
  accounts: SavingsAccount[];
  history: PortfolioSnapshot[];
  expenses: Expense[];
  config: {
    grossAnnual: number;
    navigoBase: number;
    navigoRate: number;
    taxRateManual: number;
  };
}

export const Dashboard: React.FC<DashboardProps> = ({ accounts, history, expenses, config }) => {
  // Persistance de la plage de dates
  const [dateRange, setDateRange] = useState(() => {
    try {
        const stored = localStorage.getItem('dashboard_date_range');
        if (stored) return JSON.parse(stored);
    } catch (e) {}
    
    return {
        start: new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    };
  });

  useEffect(() => {
    localStorage.setItem('dashboard_date_range', JSON.stringify(dateRange));
  }, [dateRange]);

  const totalSavings = accounts.reduce((acc, curr) => acc + curr.totalAmount, 0);
  const mySavings = accounts.reduce((acc, curr) => acc + curr.ownedAmount, 0);
  
  const getAccountStatus = (account: SavingsAccount): 'AVAILABLE' | 'TAX_LOCKED' | 'HARD_LOCKED' => {
    if (account.type === AccountType.PEE) {
        const now = new Date();
        if (account.contractEndDate && new Date(account.contractEndDate) <= now) return 'AVAILABLE';
        if (account.openingDate) {
            const openDate = new Date(account.openingDate);
            const ageInYears = (now.getTime() - openDate.getTime()) / (1000 * 3600 * 24 * 365.25);
            return ageInYears >= 5 ? 'AVAILABLE' : 'HARD_LOCKED';
        }
        return 'HARD_LOCKED';
    }
    if ([AccountType.IMMOBILIER, AccountType.PER, AccountType.AUTRE].includes(account.type)) return 'HARD_LOCKED';
    if (!account.openingDate) return 'AVAILABLE';
    const openDate = new Date(account.openingDate);
    const now = new Date();
    const ageInYears = (now.getTime() - openDate.getTime()) / (1000 * 3600 * 24 * 365.25);
    if (account.type === AccountType.PEA) return ageInYears < 5 ? 'TAX_LOCKED' : 'AVAILABLE';
    if (account.type === AccountType.ASSURANCE_VIE) return ageInYears < 8 ? 'TAX_LOCKED' : 'AVAILABLE';
    return 'AVAILABLE';
  };

  const availabilityStats = useMemo(() => {
    let available = 0; let taxLocked = 0; let hardLocked = 0;
    accounts.forEach(acc => {
      const status = getAccountStatus(acc);
      if (status === 'AVAILABLE') available += acc.ownedAmount;
      else if (status === 'TAX_LOCKED') taxLocked += acc.ownedAmount;
      else hardLocked += acc.ownedAmount;
    });
    return { available, taxLocked, hardLocked };
  }, [accounts]);

  const filteredHistory = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    
    // 1. On récupère l'historique passé
    let data = [...history];

    // 2. On identifie toutes les dates de "test" ou de mise à jour futures
    const futureDates = accounts
      .map(acc => acc.lastUpdate)
      .filter(date => date >= todayStr);
    
    const keyDates = Array.from(new Set([todayStr, ...futureDates])).sort();

    // 3. Calcul dynamique point par point
    keyDates.forEach(date => {
      // Pour cette date précise, on calcule la somme de ce qui est "actif"
      const totalsAtDate = accounts.reduce((accSum, acc) => {
        // Si la date du graphique est >= à la date de mise à jour du compte, 
        // alors ce nouveau montant est effectif sur la courbe.
        const isEffective = date >= acc.lastUpdate;
        
        return {
          total: accSum.total + (isEffective ? acc.totalAmount : (acc.totalAmount - (acc.lastDelta || 0))),
          owned: accSum.owned + (isEffective ? acc.ownedAmount : (acc.ownedAmount - (acc.lastDelta || 0)))
        };
      }, { total: 0, owned: 0 });

      // Note technique : ici on utilise simplement les valeurs actuelles pour les points futurs
      // car ton application stocke l'état présent.
      const currentTotalAtDate = accounts.reduce((s, a) => s + a.totalAmount, 0);
      const currentOwnedAtDate = accounts.reduce((s, a) => s + a.ownedAmount, 0);

      const existingIndex = data.findIndex(item => item.date === date);
      const point = { date, totalAmount: currentTotalAtDate, ownedAmount: currentOwnedAtDate };
      
      if (existingIndex >= 0) {
        data[existingIndex] = point;
      } else {
        data.push(point);
      }
    });

    // 4. Tri et filtrage
    return data
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter(item => item.date >= dateRange.start && item.date <= dateRange.end)
      .map(item => ({ 
        ...item, 
        displayDate: new Date(item.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) 
      }));
  }, [history, dateRange, accounts]); // On observe 'accounts' pour réagir aux modifs
  const dataByType = Object.values(accounts.reduce((acc, curr) => {
    if (!acc[curr.type]) acc[curr.type] = { name: curr.type, value: 0 };
    acc[curr.type].value += curr.ownedAmount;
    return acc;
  }, {} as Record<string, { name: string, value: number }>));

  const dataByInstitution = Object.values(accounts.reduce((acc, curr) => {
    const key = curr.institution;
    if (!acc[key]) acc[key] = { name: key, value: 0 };
    acc[key].value += curr.ownedAmount;
    return acc;
  }, {} as Record<string, { name: string, value: number }>));

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

  // Fonction d'exportation CSV
  const exportSession = () => {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
    
    let csvContent = "Catégorie,Désignation,Valeur,Détail\n";
    
    // Paramètres
    csvContent += `Configuration,Brut Annuel,${config.grossAnnual},€\n`;
    csvContent += `Configuration,Navigo Base,${config.navigoBase},€\n`;
    csvContent += `Configuration,Navigo Remboursement,${config.navigoRate},%\n`;
    csvContent += `Configuration,Taux Impôt Manuel,${config.taxRateManual},%\n`;

    // Comptes
    accounts.forEach(acc => {
      csvContent += `Compte,${acc.name},${acc.ownedAmount},${acc.institution} (${acc.type})\n`;
      if(acc.parentalCapital > 0) csvContent += `Compte (Parents),${acc.name},${acc.parentalCapital},${acc.institution}\n`;
    });

    // Dépenses
    expenses.forEach(exp => {
      csvContent += `Dépense Fixe,${exp.name},${exp.amount},€/mois\n`;
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
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-slate-500 text-sm font-medium">{title}</p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">
            {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)}
          </h3>
          {subtext && <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-wide">{subtext}</p>}
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );

  if (accounts.length === 0) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl text-slate-600">Aucune donnée disponible. Ajoutez vos comptes pour commencer.</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Filter & Export */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-slate-700 font-medium">
            <Filter className="w-4 h-4" />
            <span>Dashboard</span>
          </div>
          <Button onClick={exportSession} variant="secondary" className="text-xs h-9 gap-2">
            <Save className="w-4 h-4 text-indigo-600" />
            Sauvegarder l'état (CSV)
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input 
              type="date" 
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="bg-transparent text-sm outline-none w-32"
            />
          </div>
          <span className="text-slate-400">à</span>
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
             <Calendar className="w-4 h-4 text-slate-400" />
            <input 
              type="date" 
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="bg-transparent text-sm outline-none w-32"
            />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Mon Épargne Nette" amount={mySavings} icon={Wallet} color="bg-indigo-600" subtext="Capital réel" />
        <StatCard title="Disponibilité Immédiate" amount={availabilityStats.available} icon={Unlock} color="bg-emerald-500" subtext="Liquide sans frais" />
        <StatCard title="Contrainte Fiscale" amount={availabilityStats.taxLocked} icon={Euro} color="bg-amber-500" subtext="AV < 8 ans / PEA < 5 ans" />
        <StatCard title="Bloqué (Retraite/PEE)" amount={availabilityStats.hardLocked} icon={Lock} color="bg-slate-800" subtext="Indisponible" />
      </div>

      {/* Evolution Chart */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-96">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Évolution de mon Épargne Nette</h3>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filteredHistory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorOwned" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="displayDate" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(val) => `${val / 1000}k€`} tick={{ fontSize: 12 }} />
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <RechartsTooltip formatter={(value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value)} labelStyle={{ color: '#1e293b' }} />
            <Legend />
            <Area type="monotone" dataKey="ownedAmount" name="Net à moi" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorOwned)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-96">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Répartition par Type</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={dataByType} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                {dataByType.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <RechartsTooltip formatter={(value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-96">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Par Établissement</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dataByInstitution} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 12}} />
              <RechartsTooltip formatter={(value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value)} cursor={{fill: 'transparent'}} />
              <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={30} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};