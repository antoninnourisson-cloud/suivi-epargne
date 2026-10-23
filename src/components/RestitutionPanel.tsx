// ================================================
// FILE: src/components/RestitutionPanel.tsx
// Restitution du capital parental : date conseillée (le 1er janvier garde toute l'année
// d'intérêts), montants par compte, effet sur le plan de placement, puis enregistrement
// en un clic avec relevé exportable et annulation (confirmée, puis rétablissable).
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount, ParentalRestitution, AccountType } from '../types';
import { computeRestitutionPlan, suggestedRestitutionDate } from '../lib/finance';
import { formatEUR, frenchDay } from '../lib/format';
import { parseISODate, localTodayISO } from '../lib/dates';
import { HandCoins, CalendarCheck, Lightbulb, CheckCircle2, FileDown, RotateCcw, Info } from 'lucide-react';
import { Dialog } from './Dialog';
import { downloadCsv } from '../services/fileDownload';
import { csvAmount } from '../lib/csv';
import { Button, Card, TextField } from './ui';

interface RestitutionPanelProps {
  accounts: SavingsAccount[];
  restitution?: ParentalRestitution;
  monthPlan?: number;          // épargne prévue par mois (rappel de paie / capacité)
  hasCustomSplit?: boolean;
  onPlan: (date: string | undefined) => void;
  onRestitute: (date: string) => void;
  onUndo: () => void;
}

const fmt = (n: number) => formatEUR(n);
const dayLabel = (iso: string) => {
  const d = parseISODate(iso);
  return `${frenchDay(d)} ${d.getFullYear()}`;
};

export const RestitutionPanel: React.FC<RestitutionPanelProps> = ({ accounts, restitution, monthPlan, hasCustomSplit, onPlan, onRestitute, onUndo }) => {
  const suggested = suggestedRestitutionDate();
  const [date, setDate] = useState(restitution?.plannedDate || suggested);
  const [confirming, setConfirming] = useState(false);
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  // Date du retrait réel : la date prévue si elle est passée (enregistrement après coup),
  // sinon aujourd'hui.
  const [withdrawDate, setWithdrawDate] = useState(() => {
    const today = localTodayISO();
    const planned = restitution?.plannedDate;
    return planned && planned <= today ? planned : today;
  });

  const plan = useMemo(() => computeRestitutionPlan(accounts, date || suggested), [accounts, date, suggested]);

  // Place libérée sur les livrets plafonnés : le plan de paie la remplira en priorité.
  const freedRoom = useMemo(() => plan.rows
    .filter(r => [AccountType.LEP, AccountType.LIVRET_A, AccountType.LDDS].includes(r.type))
    .map(r => ({ ...r, months: monthPlan && monthPlan > 0 ? Math.ceil(r.amount / monthPlan) : null })), [plan, monthPlan]);

  const done = restitution?.done;
  if (done) {
    const total = done.accounts.reduce((s, a) => s + a.amount, 0);
    const restored = done.accounts.filter(a => a.amount > 0);
    // Un seul compte : on le nomme (ex. « … sur le compte « Livret A » »).
    const restoredWhere = restored.length > 1 ? `${restored.length} comptes` : restored[0] ? `le compte « ${restored[0].name} »` : 'le compte';
    // Relevé pour les parents, au format d'Excel en français (voir lib/csv).
    const exportCsv = () => downloadCsv(`restitution-parents-${done.date}.csv`, [
      ['Relevé de restitution du capital parental', done.date],
      [],
      ['Compte', 'Capital rendu (€)'],
      ...done.accounts.map(a => [a.name, csvAmount(a.amount)]),
      ['Total', csvAmount(total)],
      [],
      ['Année', 'Intérêts produits par ce capital et offerts (€)'],
      ...done.interestsOffered.map(i => [i.year, csvAmount(i.amount)]),
    ]);
    return (
      <Card title={`Restitution effectuée le ${dayLabel(done.date)}`} icon={CheckCircle2}>
        <div className="space-y-3">
          <p className="text-sm text-on-surface">{fmt(total)} rendus à vos parents. Votre part n'a pas bougé.</p>
          <ul className="text-sm divide-y divide-outline-variant border-y border-outline-variant">
            {done.accounts.map(a => (
              <li key={a.accountId} className="flex justify-between gap-3 py-2">
                <span className="text-on-surface">{a.name}</span>
                <span className="font-medium tabular-nums whitespace-nowrap text-on-surface">{fmt(a.amount)}</span>
              </li>
            ))}
          </ul>
          {done.interestsOffered.length > 0 && (
            <p className="text-xs text-on-surface-variant">
              Intérêts de leur capital qu'ils vous ont offerts : {done.interestsOffered.map(i => `${i.year} : ${fmt(i.amount)}`).join(' · ')}.
            </p>
          )}
          <div className="pt-1">
            <Button variant="tonal" onClick={exportCsv}><FileDown className="w-4 h-4" aria-hidden="true" /> Exporter le relevé (CSV)</Button>
          </div>
          {/* Annulation : à l'écart de l'export, et toujours confirmée (elle remet le capital
              des parents sur les comptes et efface le relevé). */}
          <div className="mt-2 pt-3 border-t border-outline-variant flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-on-surface-variant">Enregistrée par erreur ?</p>
            <Button variant="text" onClick={() => setConfirmingUndo(true)}><RotateCcw className="w-4 h-4" aria-hidden="true" /> Annuler la restitution</Button>
          </div>
        </div>
        <Dialog
          state={{
            open: confirmingUndo,
            kind: 'confirm',
            danger: true,
            title: 'Annuler la restitution ?',
            message: `${fmt(total)} de capital de vos parents seront remis sur ${restoredWhere}, et le relevé du ${dayLabel(done.date)} sera effacé. Votre part ne change pas. Vous pourrez rétablir la restitution juste après.`,
            confirmLabel: 'Remettre leur capital',
            cancelLabel: 'Garder la restitution',
            onConfirm: onUndo,
          }}
          onClose={() => setConfirmingUndo(false)}
        />
      </Card>
    );
  }

  if (plan.total <= 0) return null;
  const isPlanned = !!restitution?.plannedDate;
  const plannedHere = isPlanned && restitution?.plannedDate === date;
  const early = plan.totalLost >= 1;

  return (
    <Card title="Restitution du capital" icon={HandCoins}>
      <div className="space-y-5">
        <p className="text-sm text-on-surface-variant -mt-2">Votre part ne bouge pas : seul l'argent de vos parents est retiré.</p>

        <div className="flex flex-wrap items-end gap-3">
          <TextField label="Date de retrait prévue" type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full sm:w-56" />
          <Button variant={plannedHere ? 'tonal' : 'filled'} onClick={() => onPlan(plannedHere ? undefined : date)} className="h-14 max-sm:w-full">
            <CalendarCheck className="w-4 h-4" aria-hidden="true" /> {plannedHere ? 'Retirer les rappels' : isPlanned ? 'Changer la date' : 'Planifier (rappels)'}
          </Button>
          {date !== plan.bestDate && (
            <Button variant="text" onClick={() => setDate(plan.bestDate)} className="h-14 max-sm:h-12">Utiliser la date conseillée ({dayLabel(plan.bestDate)})</Button>
          )}
        </div>
        {isPlanned && <p className="text-xs text-on-surface-variant -mt-2">Rappels prévus : début décembre, puis le {dayLabel(restitution!.plannedDate!)}.</p>}

        <p className={`text-sm rounded-xl p-3 flex items-start gap-2 ${early ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-primary-container text-on-primary-container'}`}>
          <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          {early
            ? `À cette date, ${fmt(plan.totalLost)} d'intérêts ${plan.interestYear} sont perdus par rapport au ${dayLabel(plan.bestDate)} : les livrets ne rapportent plus rien depuis le dernier 1er ou 16.`
            : `Bonne date : toute l'année ${plan.interestYear} d'intérêts est acquise (créditée au 31 décembre).`}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Capital à rendre à vos parents, compte par compte</caption>
            <thead>
              <tr className="border-b border-outline-variant text-xs font-medium text-on-surface-variant">
                <th scope="col" className="text-left py-2 pr-3">Compte</th>
                <th scope="col" className="text-right py-2 px-3">À rendre</th>
                <th scope="col" className="text-right py-2 pl-3">Intérêts {plan.interestYear} offerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {plan.rows.map(r => (
                <tr key={r.accountId}>
                  <td className="py-2.5 pr-3 font-medium text-on-surface">{r.name}</td>
                  <td className="py-2.5 px-3 text-right font-medium text-tertiary whitespace-nowrap">{fmt(r.amount)}</td>
                  <td className="py-2.5 pl-3 text-right text-on-surface-variant whitespace-nowrap">≈ {formatEUR(r.yearInterest, 0)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-2.5 pr-3 text-on-surface">Total</td>
                <td className="py-2.5 px-3 text-right text-tertiary whitespace-nowrap">{fmt(plan.total)}</td>
                <td className="py-2.5 pl-3 text-right text-on-surface whitespace-nowrap">≈ {formatEUR(plan.totalInterest, 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-on-surface-variant -mt-2">Les intérêts produits par leur capital restent à vous, comme convenu : ils sont crédités sur vos livrets au 31 décembre.</p>

        {freedRoom.length > 0 && (
          <div className="p-4 rounded-xl bg-surface-container text-sm text-on-surface space-y-1.5">
            <p className="font-medium">Après la restitution</p>
            {freedRoom.map(r => (
              <p key={r.accountId} className="text-sm text-on-surface-variant">
                {r.name} retrouve {fmt(r.amount)} de place.{hasCustomSplit ? ' Votre répartition personnalisée s\'appliquera : ce livret ne sera rempli que s\'il en fait partie.' : r.months !== null && ` Le plan du jour de paie le remplira en priorité : environ ${r.months} mois à ${fmt(monthPlan!)} par mois.`}
              </p>
            ))}
            <p className="text-xs text-on-surface-variant flex items-start gap-1.5 pt-1"><Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" /> Votre épargne nette ne change pas : c'était leur argent. Leur rendre leur capital n'est pas un don, il n'y a rien à déclarer.</p>
          </div>
        )}

        {!confirming ? (
          <Button onClick={() => setConfirming(true)} className="w-full max-sm:h-12">J'ai rendu l'argent : enregistrer la restitution</Button>
        ) : (
          <div className="p-4 rounded-xl bg-tertiary-container text-on-tertiary-container space-y-4">
            <p className="text-sm font-medium">La part de vos parents ({fmt(plan.total)}) sera retirée de chaque compte. Votre part ne change pas.</p>
            <TextField label="Date du retrait réel" type="date" value={withdrawDate} onChange={e => setWithdrawDate(e.target.value)} className="w-full sm:w-56 [&_label]:text-on-tertiary-container [&_input]:text-on-tertiary-container [&_input]:border-on-tertiary-container/60" />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="text" onClick={() => setConfirming(false)} className="text-on-tertiary-container! enabled:hover:bg-on-tertiary-container/8! max-sm:h-12">Annuler</Button>
              <Button onClick={() => { onRestitute(withdrawDate); setConfirming(false); }} className="max-sm:h-12">Confirmer la restitution</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
