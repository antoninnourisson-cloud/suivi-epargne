// ================================================
// FILE: src/components/RestitutionPanel.tsx
// Restitution du capital parental : date conseillée (le 1er janvier garde toute l'année
// d'intérêts), montants par compte, effet sur le plan de placement, puis enregistrement
// en un clic avec récapitulatif aux parents, relevé exportable et annulation.
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount, ParentalRestitution, AccountType } from '../types';
import { computeRestitutionPlan, suggestedRestitutionDate } from '../lib/finance';
import { formatEUR, frenchDay } from '../lib/format';
import { parseISODate, localTodayISO } from '../lib/dates';
import { HandCoins, CalendarCheck, Lightbulb, CheckCircle2, FileDown, RotateCcw, Mail } from 'lucide-react';

interface RestitutionPanelProps {
  accounts: SavingsAccount[];
  restitution?: ParentalRestitution;
  monthPlan?: number;          // épargne prévue par mois (rappel de paie / capacité)
  canEmailParents: boolean;
  hasCustomSplit?: boolean;
  onPlan: (date: string | undefined) => void;
  onRestitute: (date: string, sendMail: boolean) => void;
  onUndo: () => void;
}

const fmt = (n: number) => formatEUR(n);
const dayLabel = (iso: string) => {
  const d = parseISODate(iso);
  return `${frenchDay(d)} ${d.getFullYear()}`;
};

export const RestitutionPanel: React.FC<RestitutionPanelProps> = ({ accounts, restitution, monthPlan, canEmailParents, hasCustomSplit, onPlan, onRestitute, onUndo }) => {
  const suggested = suggestedRestitutionDate();
  const [date, setDate] = useState(restitution?.plannedDate || suggested);
  const [confirming, setConfirming] = useState(false);
  const [withdrawDate, setWithdrawDate] = useState(localTodayISO());
  const [sendMail, setSendMail] = useState(canEmailParents);

  const plan = useMemo(() => computeRestitutionPlan(accounts, date || suggested), [accounts, date, suggested]);

  // Place libérée sur les livrets plafonnés : le plan de paie la remplira en priorité.
  const freedRoom = useMemo(() => plan.rows
    .filter(r => [AccountType.LEP, AccountType.LIVRET_A, AccountType.LDDS].includes(r.type))
    .map(r => ({ ...r, months: monthPlan && monthPlan > 0 ? Math.ceil(r.amount / monthPlan) : null })), [plan, monthPlan]);

  const done = restitution?.done;
  if (done) {
    const total = done.accounts.reduce((s, a) => s + a.amount, 0);
    const exportCsv = () => {
      let csv = `Relevé de restitution du capital parental,${done.date}\n\nCompte,Capital rendu (€)\n`;
      done.accounts.forEach(a => { csv += `"${a.name.replace(/"/g, '""')}",${a.amount.toFixed(2)}\n`; });
      csv += `Total,${total.toFixed(2)}\n\nAnnée,Intérêts produits par ce capital et offerts (€)\n`;
      done.interestsOffered.forEach(i => { csv += `${i.year},${i.amount.toFixed(2)}\n`; });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url; a.download = `restitution-parents-${done.date}.csv`; a.click();
      URL.revokeObjectURL(url);
    };
    return (
      <div className="bg-emerald-50 dark:bg-emerald-950/30 p-6 rounded-2xl border border-emerald-200 dark:border-emerald-900 space-y-3">
        <h3 className="font-black text-emerald-800 dark:text-emerald-300 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Restitution effectuée le {dayLabel(done.date)}</h3>
        <p className="text-sm text-emerald-900 dark:text-emerald-200">{fmt(total)} rendus à vos parents{done.emailed ? ', récapitulatif envoyé par e-mail' : ''}. Votre part n'a pas bougé.</p>
        <ul className="text-sm space-y-1">
          {done.accounts.map(a => <li key={a.accountId} className="flex justify-between gap-3"><span>{a.name}</span><span className="font-mono font-bold">{fmt(a.amount)}</span></li>)}
        </ul>
        {done.interestsOffered.length > 0 && (
          <p className="text-xs text-emerald-900/80 dark:text-emerald-200/80">
            Intérêts de leur capital qu'ils vous ont offerts : {done.interestsOffered.map(i => `${i.year} : ${fmt(i.amount)}`).join(' · ')}.
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-1">
          <button onClick={exportCsv} className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-900 px-3 py-2 rounded-lg text-sm font-bold text-emerald-800 dark:text-emerald-300"><FileDown className="w-4 h-4" /> Exporter le relevé (CSV)</button>
          <button onClick={onUndo} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-300 hover:underline"><RotateCcw className="w-4 h-4" /> Annuler la restitution</button>
        </div>
      </div>
    );
  }

  if (plan.total <= 0) return null;
  const isPlanned = !!restitution?.plannedDate;
  const early = plan.totalLost >= 1;

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-4">
      <div>
        <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><HandCoins className="w-5 h-5 text-amber-700 dark:text-amber-400" /> Restitution du capital</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">Votre part ne bouge pas : seul l'argent de vos parents est retiré.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Date de retrait prévue</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="block p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100" />
        </label>
        {date !== plan.bestDate && (
          <button onClick={() => setDate(plan.bestDate)} className="text-xs font-bold text-indigo-600 dark:text-indigo-300 hover:underline pb-3">Utiliser la date conseillée ({dayLabel(plan.bestDate)})</button>
        )}
        <button
          onClick={() => onPlan(isPlanned && restitution?.plannedDate === date ? undefined : date)}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-black ${isPlanned && restitution?.plannedDate === date ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
        >
          <CalendarCheck className="w-4 h-4" /> {isPlanned && restitution?.plannedDate === date ? 'Retirer les rappels' : isPlanned ? 'Changer la date' : 'Planifier (rappels)'}
        </button>
      </div>
      {isPlanned && <p className="text-xs text-slate-500 dark:text-slate-400">Rappels prévus : début décembre, puis le {dayLabel(restitution!.plannedDate!)}.</p>}

      <p className={`text-xs font-bold flex items-start gap-1.5 ${early ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
        <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-px" />
        {early
          ? `À cette date, ${fmt(plan.totalLost)} d'intérêts ${plan.interestYear} sont perdus par rapport au ${dayLabel(plan.bestDate)} : les livrets ne rapportent plus rien depuis le dernier 1er ou 16.`
          : `Bonne date : toute l'année ${plan.interestYear} d'intérêts est acquise (créditée au 31 décembre).`}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">
              <th className="text-left py-2">Compte</th>
              <th className="text-right py-2">À rendre</th>
              <th className="text-right py-2">Intérêts {plan.interestYear} offerts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {plan.rows.map(r => (
              <tr key={r.accountId}>
                <td className="py-2 font-bold text-slate-800 dark:text-slate-100">{r.name}</td>
                <td className="py-2 text-right font-mono font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">{fmt(r.amount)}</td>
                <td className="py-2 text-right font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">≈ {formatEUR(r.yearInterest, 0)}</td>
              </tr>
            ))}
            <tr className="font-black">
              <td className="py-2 text-slate-800 dark:text-slate-100">Total</td>
              <td className="py-2 text-right font-mono text-amber-600 dark:text-amber-400 whitespace-nowrap">{fmt(plan.total)}</td>
              <td className="py-2 text-right font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap">≈ {formatEUR(plan.totalInterest, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">Les intérêts produits par leur capital restent à vous, comme convenu : ils sont crédités sur vos livrets au 31 décembre.</p>

      {freedRoom.length > 0 && (
        <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-sm text-indigo-900 dark:text-indigo-200 space-y-1">
          <p className="font-bold">Après la restitution</p>
          {freedRoom.map(r => (
            <p key={r.accountId} className="text-xs">
              {r.name} retrouve {fmt(r.amount)} de place.{hasCustomSplit ? ' Votre répartition personnalisée s\'appliquera : ce livret ne sera rempli que s\'il en fait partie.' : r.months !== null && ` Le plan du jour de paie le remplira en priorité : environ ${r.months} mois à ${fmt(monthPlan!)} par mois.`}
            </p>
          ))}
          <p className="text-[11px] opacity-80">Votre épargne nette ne change pas : c'était leur argent. Leur rendre leur capital n'est pas un don, il n'y a rien à déclarer.</p>
        </div>
      )}

      {!confirming ? (
        <button onClick={() => setConfirming(true)} className="w-full py-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-black">J'ai rendu l'argent : enregistrer la restitution</button>
      ) : (
        <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 space-y-3">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">La part de vos parents ({fmt(plan.total)}) sera retirée de chaque compte. Votre part ne change pas.</p>
          <label className="block">
            <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Date du retrait réel</span>
            <input type="date" value={withdrawDate} onChange={e => setWithdrawDate(e.target.value)} className="block p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100" />
          </label>
          {canEmailParents ? (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={sendMail} onChange={e => setSendMail(e.target.checked)} />
              <Mail className="w-4 h-4" /> Envoyer le récapitulatif à mes parents par e-mail
            </label>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">Pour leur envoyer un récapitulatif, renseignez leur adresse dans Paramètres → Notification aux parents.</p>
          )}
          <div className="flex gap-2">
            <button onClick={() => { onRestitute(withdrawDate, sendMail && canEmailParents); setConfirming(false); }} className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black text-sm">Confirmer la restitution</button>
            <button onClick={() => setConfirming(false)} className="px-4 py-2.5 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-300">Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
};
