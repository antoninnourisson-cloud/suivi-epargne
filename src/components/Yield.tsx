import React, { useMemo } from 'react';
import { SavingsAccount, AccountType, FiscalConfig } from '../types';
import { computeWeightedAnnualRate } from '../lib/finance';
import { Coins, TrendingUp, AlertCircle, PiggyBank, FileDown, Landmark } from 'lucide-react';

interface YieldProps {
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);
const REGULATED = [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP];

export const Yield: React.FC<YieldProps> = ({ accounts, fiscalConfig }) => {
  const currentYear = new Date().getFullYear();

  const rows = useMemo(() =>
    accounts
      .filter(a => (a.interestRate || 0) > 0 && a.totalAmount > 0)
      .map(a => {
        const weightedRate = computeWeightedAnnualRate(a.interestRate || 0, a.rateHistory, currentYear);
        return {
          id: a.id, name: a.name, type: a.type, rate: a.interestRate || 0,
          weightedRate,
          hasRateHistory: !!(a.rateHistory && a.rateHistory.length > 0),
          base: a.totalAmount,
          annual: a.totalAmount * (weightedRate / 100),
          annualOwned: a.ownedAmount * (weightedRate / 100),
        };
      })
      .sort((x, y) => y.annual - x.annual),
    [accounts, currentYear]);

  const totalAnnual = rows.reduce((s, r) => s + r.annual, 0);
  // Intérêts produits par ma part propre du capital.
  const totalAnnualOwned = rows.reduce((s, r) => s + r.annualOwned, 0);
  // Intérêts produits par le capital de mes parents : ils me les offrent en fin
  // d'année, donc le TOTAL est bien ce qui me revient (je ne touche pas à leur
  // capital, mais j'encaisse 100 % des intérêts).
  const totalAnnualParental = Math.max(0, totalAnnual - totalAnnualOwned);

  // Manque à gagner : cash dormant sur compte courant vs place possible sur livrets non pleins.
  const missed = useMemo(() => {
    const ceilings: Record<string, number> = {
      [AccountType.LIVRET_A]: fiscalConfig.ceilings.livretA,
      [AccountType.LDDS]: fiscalConfig.ceilings.ldds,
      [AccountType.LEP]: fiscalConfig.ceilings.lep,
    };
    const idleCash = accounts
      .filter(a => a.type === AccountType.COMPTE_COURANT)
      .reduce((s, a) => s + a.ownedAmount, 0);

    const livrets = accounts
      .filter(a => REGULATED.includes(a.type))
      .map(a => ({ rate: a.interestRate || 0, space: Math.max(0, (ceilings[a.type] || 0) - a.totalAmount) }))
      .filter(a => a.space > 0)
      .sort((x, y) => y.rate - x.rate);

    // Alloue le cash aux meilleurs livrets non pleins.
    let remaining = idleCash;
    let extra = 0;
    let placeable = 0;
    for (const l of livrets) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, l.space);
      extra += amount * (l.rate / 100);
      placeable += amount;
      remaining -= amount;
    }
    return { idleCash, placeable, extra, bestRate: livrets[0]?.rate || 0 };
  }, [accounts, fiscalConfig]);

  // --- EXPORT FISCAL (comptes imposables, pour la déclaration d'impôts) ---
  const taxableRows = useMemo(() =>
    accounts
      .filter(a => a.isTaxable)
      .map(a => ({
        id: a.id, name: a.name, type: a.type, institution: a.institution,
        base: a.totalAmount, rate: a.interestRate || 0,
        estimatedAnnualInterest: a.totalAmount * ((a.interestRate || 0) / 100),
        openingDate: a.openingDate || '',
      })),
    [accounts]);

  const exportFiscalCsv = () => {
    let csv = 'Compte,Type,Établissement,Solde,Taux (%),Intérêts estimés (an),Date ouverture\n';
    taxableRows.forEach(r => {
      csv += `"${r.name}","${r.type}","${r.institution}",${r.base},${r.rate},${r.estimatedAnnualInterest.toFixed(2)},${r.openingDate}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export-fiscal-${currentYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><Coins className="w-6 h-6 text-indigo-600" /> Rendement réel</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Intérêts annuels générés par tes comptes rémunérés (taux × solde).</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 text-white p-6 rounded-2xl">
          <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Intérêts annuels qui me reviennent</p>
          <p className="text-4xl font-black text-emerald-400">{fmt(totalAnnual)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">soit ≈ {fmt(totalAnnual / 12)}/mois — capital parental inclus</p>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl">
          <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-2"><PiggyBank className="w-4 h-4" /> Dont offerts par mes parents</p>
          <p className="text-4xl font-black text-indigo-600">{fmt(totalAnnualParental)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            Intérêts générés par leur capital, qu'ils m'offrent en fin d'année. Le reste ({fmt(totalAnnualOwned)}) vient de ma part propre.
          </p>
        </div>
      </div>

      {missed.extra > 0.5 && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-300">
            <p className="font-black mb-1">Manque à gagner détecté</p>
            <p>Tu as <b>{fmt(missed.idleCash)}</b> sur compte courant. En plaçant <b>{fmt(missed.placeable)}</b> sur tes livrets non pleins (jusqu'à {missed.bestRate}%), tu générerais environ <b>{fmt(missed.extra)}/an</b> d'intérêts supplémentaires.</p>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[34rem]">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Compte</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase text-right">Taux</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase text-right">Solde</th>
                <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase text-right">Intérêts / an</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-6 py-3"><div className="font-bold text-slate-800 dark:text-slate-100">{r.name}</div><div className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold">{r.type}</div></td>
                  <td className="px-6 py-3 text-right font-mono text-slate-600 dark:text-slate-300">
                    {r.rate}%
                    {r.hasRateHistory && Math.abs(r.weightedRate - r.rate) > 0.01 && (
                      <span className="block text-[10px] text-indigo-400 font-bold normal-case" title="Moyenne pondérée dans le temps suite à un changement de taux">≈{r.weightedRate.toFixed(2)}% pondéré</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-slate-600 dark:text-slate-300">{fmt(r.base)}</td>
                  <td className="px-6 py-3 text-right font-black text-emerald-600">{fmt(r.annual)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-400 dark:text-slate-500 italic">Aucun compte rémunéré (renseigne un taux d'intérêt sur tes comptes).</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {taxableRows.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Landmark className="w-5 h-5 text-indigo-600" /> Export fiscal {currentYear}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Comptes imposables (Assurance Vie, PEA...) — utile pour ta déclaration d'impôts.</p>
            </div>
            <button onClick={exportFiscalCsv} className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-xl font-bold text-sm flex-shrink-0"><FileDown className="w-4 h-4" /> Exporter (CSV)</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[34rem]">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Compte</th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase text-right">Solde</th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase text-right">Intérêts estimés {currentYear}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {taxableRows.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="px-6 py-3"><div className="font-bold text-slate-800 dark:text-slate-100">{r.name}</div><div className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-bold">{r.institution} · {r.type}</div></td>
                    <td className="px-6 py-3 text-right font-mono text-slate-600 dark:text-slate-300">{fmt(r.base)}</td>
                    <td className="px-6 py-3 text-right font-black text-amber-600">{fmt(r.estimatedAnnualInterest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
