// Cartes simples de l'Accueil : premier lancement, épargne de précaution, prochaines
// échéances, prélèvements des 7 prochains jours. Rendu seul : les calculs viennent de lib.
import React from 'react';
import { CalendarClock, CalendarDays, LifeBuoy, Sprout } from 'lucide-react';
import { Button, Card, MoneyText, SegmentedButton } from '../ui';
import { formatEUR, frenchDay } from '../../lib/format';
import { parseISODate } from '../../lib/dates';
import type { EmergencyFund } from '../../lib/planning';
import type { AgendaEvent } from '../../lib/agenda';
import type { UpcomingDebit } from '../../lib/home';
import type { View } from '../../navigation';

const fmtEUR = (v: number) => formatEUR(v, 0);
const progressTrack = 'h-2 rounded-full bg-surface-container-highest overflow-hidden';

const STEPS = [
  'Ajoutez vos comptes (Livret A, LEP, assurance vie…) avec leur solde.',
  'Indiquez votre salaire et vos charges dans le Pilotage.',
  'Choisissez votre jour de paie : Pécule vous dira quoi placer, et où.',
];

/** Premier lancement (aucun compte) : trois étapes. */
export const WelcomeCard: React.FC<{ onAddAccount?: () => void; onNavigate?: (view: View) => void }> = ({ onAddAccount, onNavigate }) => (
  <section aria-labelledby="welcome-title" className="max-w-xl mx-auto mt-6 rounded-3xl bg-surface-container-low border border-outline-variant p-8 text-center text-on-surface">
    <span className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-primary-container text-on-primary-container flex items-center justify-center">
      <Sprout className="w-7 h-7" aria-hidden="true" />
    </span>
    <h2 id="welcome-title" className="text-[28px] leading-9 font-normal text-on-surface">Bienvenue dans Pécule</h2>
    <p className="text-on-surface-variant mt-2">Trois étapes pour faire pousser votre épargne :</p>
    <ol className="text-left mt-6 space-y-3 text-sm text-on-surface">
      {STEPS.map((step, i) => (
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

export const EmergencyCard: React.FC<{ emergency: EmergencyFund; onSetMonths?: (m: number) => void }> = ({ emergency, onSetMonths }) => (
  <Card title="Épargne de précaution" icon={LifeBuoy} action={
    <p className="text-base font-medium text-on-surface tabular-nums whitespace-nowrap">{fmtEUR(emergency.current)} <span className="text-on-surface-variant font-normal">/ {fmtEUR(emergency.target)}</span></p>
  }>
    <div className={progressTrack} role="progressbar" aria-label="Épargne de précaution" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(emergency.pct)}>
      <div className={`h-full rounded-full ${emergency.reached ? 'bg-gain' : 'bg-primary'}`} style={{ width: `${emergency.pct}%` }} />
    </div>
    <p className="text-sm text-on-surface-variant mt-2">
      {emergency.reached ? 'Atteinte. ' : `Il manque ${fmtEUR(emergency.missing)}. `}
      {emergency.months} mois de dépenses ({fmtEUR(emergency.monthlySpending)} par mois), sur vos livrets et comptes courants, votre part seulement.
      {emergency.cashBuffer ? ` Les ${fmtEUR(emergency.cashBuffer)} gardés sur le compte courant pour les dépenses du mois n'en font pas partie.` : ''}
    </p>
    {onSetMonths && (
      <SegmentedButton
        className="mt-4"
        label="Nombre de mois"
        options={[{ value: '3', label: '3 mois' }, { value: '6', label: '6 mois' }]}
        value={String(emergency.months)}
        onChange={v => onSetMonths(Number(v))}
      />
    )}
  </Card>
);

export const AgendaCard: React.FC<{ events: AgendaEvent[]; onNavigate?: (view: View) => void }> = ({ events, onNavigate }) => (
  <Card title="Prochaines échéances" icon={CalendarDays} action={onNavigate && <Button variant="text" onClick={() => onNavigate('agenda')} className="-my-2">Tout voir</Button>}>
    <ul className="divide-y divide-outline-variant -my-2">
      {events.map(e => (
        <li key={`${e.date}-${e.title}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <span className="min-w-0 truncate text-on-surface font-medium">{e.title}</span>
          <span className="shrink-0 text-on-surface-variant tabular-nums">{frenchDay(parseISODate(e.date), true)}</span>
        </li>
      ))}
    </ul>
  </Card>
);

export const UpcomingDebitsCard: React.FC<{ debits: UpcomingDebit[] }> = ({ debits }) => (
  <Card title="Prélèvements des 7 prochains jours" icon={CalendarClock} action={
    <p className="text-base font-medium text-on-surface tabular-nums whitespace-nowrap"><span className="sr-only">Total : </span>{formatEUR(debits.reduce((sum, x) => sum + x.s.amount, 0))}</p>
  }>
    <ul className="divide-y divide-outline-variant -my-2">
      {debits.map(({ s, date, inDays }) => (
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
);
