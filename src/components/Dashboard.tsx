import React, { useState, useMemo, useEffect } from 'react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area 
} from 'recharts';
import { SavingsAccount, PortfolioSnapshot, AccountType, Expense } from '../types';
import { Euro, Lock, Wallet, Filter, Unlock, Save } from 'lucide-react';
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
  // --- 1. GESTION DES DATES ---
  const [dateRange, setDateRange] = useState(() => {
    try {
        const stored = localStorage.getItem('dashboard_date_range');
        if (stored) return JSON.parse(stored);
    } catch (e) {}
    
    return {
        // Par défaut, on remonte 6 mois en arrière
        start: new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    };
  });

  useEffect(() => {
    localStorage.setItem('dashboard_date_range', JSON.stringify(dateRange));
  }, [dateRange]);

  // --- 2. STATISTIQUES GLOBALES ---
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

  // --- 3. CALCUL DE L'ÉVOLUTION (REVERSE ENGINEERING) ---
  const stackedData = useMemo(() => {
    const data: any[] = [];
    const endDate = new Date(dateRange.end);
    const startDate = new Date(dateRange.start);
    
    // On part des montants ACTUELS (Aujourd'hui) -> C'est notre point de vérité
    const currentBalances = new Map<string, number>();
    accounts.forEach(acc => {
      currentBalances.set(acc.id, acc.ownedAmount);
    });

    // On remonte le temps jour par jour (de Fin -> Début)
    for (let d = new Date(endDate); d >= startDate; d.setDate(d.getDate() - 1)) {
      const dateStr = d.toISOString().split('T')[0];
      
      // A. Snapshot de l'état à cette date
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
      
      data.unshift(daySnapshot); // On insère au début pour l'ordre chronologique final

      // B. Calcul de l'état J-1 (On inverse les flux du jour J)
      accounts.forEach(acc => {
        const movesOnDate = (acc.movements || []).filter(m => m.date === dateStr);
        if (movesOnDate.length > 0) {
          const currentBal = currentBalances.get(acc.id) || 0;
          // Si j'ai eu +500 aujourd'hui, hier j'avais 500 de moins.
          const flow = movesOnDate.reduce((sum, m) => sum + (m.type === 'IN' ? m.amount : -m.amount), 0);
          currentBalances.set(acc.id, currentBal - flow);
        }
      });
    }

    return data;
  }, [accounts, dateRange]);

  // --- 4. DONNÉES STATIQUES (CAMEMBERT & BARRES) ---
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

  // --- 5. UTILITAIRES GRAPHIQUES ---
  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
  const getAccountColor = (index: number) => COLORS[index % COLORS.length];

  const exportSession = () => {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
    let csvContent = "Catégorie,Désignation,Valeur,Détail\n";
    csvContent += `Configuration,Brut Annuel,${config.grossAnnual},€\n`;
    csvContent += `Configuration,Navigo Base,${config.navigoBase},€\n`;
    csvContent += `Configuration,Navigo Remboursement,${config.navigoRate},%\n`;
    csvContent += `Configuration,Taux Impôt Manuel,${config.taxRateManual},%\n`;
    accounts.forEach(acc => {
      csvContent += `Compte,${acc.name},${acc.ownedAmount},${acc.institution} (${acc.type})\n`;
      if(acc.parentalCapital > 0) csvContent += `Compte (Parents),${acc.name},${acc.parentalCapital},${acc.institution}\n`;
    });
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

  if (accounts.length === 0) return <div className="text-center py-20 text-slate-600">Aucune donnée disponible.</div>;

  return (
    <div className="space-y-6">
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
          <input type="date" value={dateRange.start} onChange={(e) => setDateRange((prev: any) => ({ ...prev, start: e.target.value }))} className="bg-slate-50 text-sm border p-2 rounded-lg" />
          <span className="text-slate-400 text-sm">à</span>
          <input type="date" value={dateRange.end} onChange={(e) => setDateRange((prev: any) => ({ ...prev, end: e.target.value }))} className="bg-slate-50 text-sm border p-2 rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Mon Épargne Nette" amount={mySavings} icon={Wallet} color="bg-indigo-600" subtext="Capital réel" />
        <StatCard title="Disponibilité Immédiate" amount={availabilityStats.available} icon={Unlock} color="bg-emerald-500" subtext="Liquide" />
        <StatCard title="Contrainte Fiscale" amount={availabilityStats.taxLocked} icon={Euro} color="bg-amber-500" subtext="AV/PEA récents" />
        <StatCard title="Bloqué" amount={availabilityStats.hardLocked} icon={Lock} color="bg-slate-800" subtext="Retraite/PEE" />
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-96">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Évolution de mon Épargne Nette (Empilé)</h3>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={stackedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {accounts.map((acc, index) => (
                <linearGradient key={`grad-${acc.id}`} id={`color-${acc.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={getAccountColor(index)} stopOpacity={0.8}/>
                  <stop offset="95%" stopColor={getAccountColor(index)} stopOpacity={0.1}/>
                </linearGradient>
              ))}
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
            {accounts.map((acc, index) => (
              <Area 
                key={acc.id}
                type="monotone" 
                dataKey={acc.id} 
                name={acc.id} 
                stackId="1" 
                stroke={getAccountColor(index)} 
                fill={`url(#color-${acc.id})`}
                fillOpacity={1}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-80">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Répartition par Type</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={dataByType} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                {dataByType.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <RechartsTooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-80">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Par Établissement</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dataByInstitution} layout="vertical">
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 10}} />
              <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};