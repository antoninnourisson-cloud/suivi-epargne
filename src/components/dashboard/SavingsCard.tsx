// Carte « Épargne de novembre » de l'Accueil : LE chiffre du mois en cours. Une seule fenêtre
// (le mois d'épargne en cours, de paie en paie, sinon le mois civil) pour la jauge, le seuil
// « bon mois » et le taux d'épargne ; une seule jauge avec deux repères (objectif du Pilotage,
// seuil « bon mois »). Paie attendue mais pas encore déclarée : « J'ai reçu ma paie » ouvre le
// rituel. Les calculs sont dans lib/home (payPeriodSavings, savingsGauge).
import React, { useState } from 'react';
import { CalendarCheck, Percent, PiggyBank, Wallet } from 'lucide-react';
import { Button, Card } from '../ui';
import { formatEUR, formatSignedEUR, frenchDay } from '../../lib/format';
import { parseISODate } from '../../lib/dates';
import type { PayPeriodSavings, SavingsGauge } from '../../lib/home';
import { deMonth } from '../motivation/text';

const fmtEUR = (v: number) => formatEUR(v, 0);
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const monthName = (month: string, withYear: boolean) =>
  parseISODate(`${month}-01`).toLocaleDateString('fr-FR', withYear ? { month: 'long', year: 'numeric' } : { month: 'long' });
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const days = (n: number) => `${n} jour${n > 1 ? 's' : ''}`;
// Hachures du mois en cours : il n'est pas fini (comme sur la courbe de l'Accueil).
const CURRENT_HATCH = 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(255,255,255,.4) 3px 5px)';

interface SavingsCardProps {
  gauge: SavingsGauge;
  period: PayPeriodSavings;
  monthlyPay: number;
  /** Ouvre le rituel « J'ai reçu ma paie » (bouton affiché tant que la paie attendue n'est pas déclarée). */
  onPayReceived?: () => void;
}

/** Phrase sous la jauge : ce qui reste pour l'objectif, puis pour le « bon mois ». */
const gaugeSentences = (g: SavingsGauge, saved: number): string[] => {
  const left = `${days(g.daysLeft)} avant ${g.until}`;
  const out: string[] = [];
  if (saved < 0) out.push(`Vous avez plus retiré que versé (${formatSignedEUR(saved, 0)}).`);
  if (g.hasPlan) {
    out.push(g.done ? 'Objectif atteint.' : `Reste ${fmtEUR(g.plan - Math.max(0, saved))} pour l'objectif de ${fmtEUR(g.plan)}, ${left}.`);
  }
  if (g.threshold > 0) {
    out.push(g.good
      ? `Bon mois acquis : ${fmtEUR(g.threshold)} dépassés.`
      : `Bon mois dès ${fmtEUR(g.threshold)} : encore ${fmtEUR(g.threshold - Math.max(0, saved))}${g.hasPlan ? '' : `, ${left}`}.`);
  }
  return out;
};

export const SavingsCard: React.FC<SavingsCardProps> = ({ gauge, period, monthlyPay, onPayReceived }) => {
  const [rateMonth, setRateMonth] = useState<string | null>(null);
  const { title, max, pct, tick, done, good } = gauge;
  const { saved, history, avgRate, avgCount, byPay } = period;
  const maxRate = Math.max(1, ...history.map(m => Math.abs(m.rate)));
  const selected = history.find(m => m.month === rateMonth);
  const unit = byPay ? 'paie' : 'mois';
  // De paie en paie, chaque barre est un mois d'épargne (« Épargne de novembre »).
  const label = (month: string, withYear: boolean) => (byPay ? `Épargne ${deMonth(monthName(month, withYear))}` : capitalize(monthName(month, withYear)));
  const askPay = byPay && !period.declared && !!onPayReceived;
  const valueText = [
    `${fmtEUR(saved)} placés`,
    gauge.hasPlan && `objectif ${fmtEUR(gauge.plan)}`,
    gauge.threshold > 0 && `bon mois dès ${fmtEUR(gauge.threshold)}`,
  ].filter(Boolean).join(', ');
  return (
    <Card title={title} icon={PiggyBank} action={
      <p className="text-base font-medium text-on-surface tabular-nums whitespace-nowrap">
        {saved < 0 ? formatSignedEUR(saved, 0) : fmtEUR(saved)}
        {max > 0 && <span className="text-on-surface-variant font-normal"> / {fmtEUR(max)}</span>}
      </p>
    }>
      {gauge.since && <p className="-mt-3 mb-3 text-sm text-on-surface-variant">{gauge.since}</p>}
      {askPay && (
        <div className="mb-4 p-3 rounded-xl bg-surface-container flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-sm text-on-surface-variant flex items-center gap-1.5 min-w-0">
            <Wallet className="w-4 h-4 shrink-0" aria-hidden="true" />
            Paie attendue le {frenchDay(parseISODate(period.start))} : reçue ?
          </p>
          <Button variant="tonal" size="sm" onClick={onPayReceived}>J'ai reçu ma paie</Button>
        </div>
      )}
      {max > 0 && (
        <>
          <div className="relative">
            <div className="h-2 rounded-full bg-surface-container-highest overflow-hidden" role="progressbar" aria-label={title}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={valueText}>
              <div className={`h-full rounded-full ${done || (good && !gauge.hasPlan) ? 'bg-gain' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
            </div>
            {/* Repère du plus petit des deux montants (le plus grand est le bout de la barre). */}
            {tick && <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 rounded-full bg-on-surface" style={{ left: `calc(${tick.pct}% - 1px)` }} />}
          </div>
          <ul className="mt-3 space-y-1 text-sm text-on-surface-variant">
            {gaugeSentences(gauge, saved).map(s => <li key={s}>{s}</li>)}
          </ul>
          {tick && (
            <p className="mt-1 text-xs text-on-surface-variant flex items-center gap-1.5">
              <CalendarCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              Le trait sur la jauge marque {tick.kind === 'threshold' ? 'le seuil « bon mois »' : "l'objectif"} ({fmtEUR(tick.amount)}).
            </p>
          )}
        </>
      )}
      {monthlyPay > 0 && (
        <div className={max > 0 ? 'mt-5 pt-4 border-t border-outline-variant' : ''}>
          {/* Titre puis chiffres, l'un sous l'autre : la carte occupe une demi-largeur sur
              ordinateur, et une ligne partagée coupait « 31 % » seul à la ligne. */}
          <div className="flex flex-col gap-1 mb-3">
            <p className="text-sm font-medium text-on-surface flex items-center gap-1.5 whitespace-nowrap"><Percent className="w-4 h-4 text-primary" aria-hidden="true" /> Taux d'épargne</p>
            <p className="text-sm text-on-surface-variant">
              {byPay ? 'Cette paie' : 'Ce mois-ci'} <span className="font-medium text-on-surface tabular-nums whitespace-nowrap">{Math.round(period.rate ?? 0)} %</span>
              {avgRate !== null && <> · moyenne sur {avgCount > 1 ? `${avgCount} ${unit === 'paie' ? 'paies' : 'mois'}` : `1 ${unit}`} <span className="font-medium text-on-surface tabular-nums whitespace-nowrap">{Math.round(avgRate)} %</span></>}
            </p>
          </div>
          <div className="flex items-end gap-1 h-20">
            {history.map((m, i) => {
              const h = Math.max(2, (Math.abs(m.rate) / maxRate) * 100);
              const current = i === history.length - 1;
              return (
                <button type="button" key={m.month} onClick={() => setRateMonth(rateMonth === m.month ? null : m.month)} aria-pressed={rateMonth === m.month}
                  aria-label={`${label(m.month, true)}${current ? ' (en cours)' : ''} : ${Math.round(m.rate)} %, ${fmtEUR(m.saved)}${m.rate < 0 ? ', retrait net' : ''}`}
                  className="flex-1 flex flex-col items-center justify-end h-full gap-1 rounded-xs">
                  <div className={`w-full rounded-t-xs ${m.rate < 0 ? 'bg-loss' : 'bg-primary'} ${rateMonth === m.month ? 'ring-2 ring-tertiary ring-offset-1 ring-offset-surface-container-lowest' : ''}`}
                    style={{ height: `${h}%`, backgroundImage: current ? CURRENT_HATCH : undefined, opacity: current ? 0.7 : undefined }} />
                  <span className={`text-xs font-medium ${current ? 'text-on-surface underline' : 'text-on-surface-variant'}`}>{MONTH_INITIALS[Number(m.month.slice(5)) - 1]}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-on-surface-variant mt-2 min-h-5" aria-live="polite">
            {selected
              ? `${label(selected.month, false)} : ${Math.round(selected.rate)} % de la paie, ${formatSignedEUR(selected.saved, 0)}.`
              : `Touchez une barre pour le détail. Part de votre paie nette (${fmtEUR(monthlyPay)}) mise de côté, ${byPay ? 'de paie en paie' : 'mois par mois'} ; ${byPay ? 'paie' : 'mois'} en cours hachuré${byPay ? 'e' : ''}, retraits en rouge.`}
          </p>
        </div>
      )}
    </Card>
  );
};
