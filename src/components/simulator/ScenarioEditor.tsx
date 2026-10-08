// Une ligne de scénario du simulateur « Et si… » : champs propres au type (montant, mois,
// durée, date) et bouton pour la retirer. Libellés reliés, saisie des montants à la
// française (NumberInput).
import React, { useState } from 'react';
import { ShoppingBag, PauseCircle, PiggyBank, CalendarClock, X } from 'lucide-react';
import type { Scenario } from '../../lib/simulator';
import { TextField } from '../ui/TextField';
import { NumberInput } from '../NumberInput';
import { parseISODate } from '../../lib/dates';

export const SCENARIO_META: Record<Scenario['kind'], { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  purchase: { label: 'Achat', icon: ShoppingBag },
  pause: { label: 'Pause', icon: PauseCircle },
  monthly: { label: 'Épargne mensuelle', icon: PiggyBank },
  restitution: { label: 'Restitution', icon: CalendarClock },
};

interface ScenarioEditorProps {
  scenario: Scenario;
  horizon: number;
  /** Rang parmi les scénarios du même type (« Achat 2 »). */
  rank?: number;
  minRestitutionDate: string;
  onChange: (s: Scenario) => void;
  onRemove: () => void;
}

const MoneyField: React.FC<{ label: string; value: number; onChange: (n: number) => void; supporting?: string }> = ({ label, value, onChange, supporting }) => (
  <TextField label={label} supporting={supporting}
    render={p => <NumberInput id={p.id} className={p.className} describedBy={p.describedBy} invalid={p.invalid} value={value} onChange={onChange} min={0} suffix="€" />} />
);

const MonthField: React.FC<{ label: string; value: number; onChange: (n: number) => void; max: number }> = ({ label, value, onChange, max }) => (
  <TextField label={label}
    render={p => <NumberInput id={p.id} className={p.className} describedBy={p.describedBy} invalid={p.invalid} value={value} suffix="mois"
      onChange={n => onChange(Math.max(1, Math.min(max, Math.round(n) || 1)))} />} />
);

/** Date de restitution : un champ vidé reste vide avec un message, la simulation garde
 *  la dernière date valide jusqu'à la saisie d'une nouvelle. */
const RestitutionDateField: React.FC<{ value: string; min: string; onChange: (date: string) => void }> = ({ value, min, onChange }) => {
  const [draft, setDraft] = useState(value);
  const empty = draft === '';
  return (
    <TextField label="Date de la restitution" type="date" min={min} value={draft}
      onChange={e => { setDraft(e.target.value); if (e.target.value) onChange(e.target.value); }}
      error={empty ? `Saisissez une date. En attendant, la simulation garde le ${parseISODate(value).toLocaleDateString('fr-FR')}.` : undefined}
      supporting="Le capital des parents produit des intérêts (offerts) jusqu'à cette date." />
  );
};

export const ScenarioEditor: React.FC<ScenarioEditorProps> = ({ scenario: s, horizon, rank, minRestitutionDate, onChange, onRemove }) => {
  const meta = SCENARIO_META[s.kind];
  const Icon = meta.icon;
  const title = `${meta.label}${rank && rank > 1 ? ` ${rank}` : ''}`;
  return (
    <li className="rounded-xl bg-surface-container dark:bg-surface-container-high p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-medium text-on-surface flex items-center gap-2">
          <Icon className="w-4 h-4 text-on-surface-variant" aria-hidden="true" />{title}
        </p>
        <button type="button" onClick={onRemove} aria-label={`Retirer le scénario ${title}`}
          className="w-10 h-10 -m-2 inline-flex items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/8 focus-visible:outline-2 focus-visible:outline-indigo-600">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {s.kind === 'purchase' && <>
          <MoneyField label="Montant de l'achat" value={s.amount} onChange={amount => onChange({ ...s, amount })} />
          <MonthField label="Dans" value={s.month} max={horizon} onChange={month => onChange({ ...s, month })} />
          <p className="sm:col-span-2 text-xs text-on-surface-variant">Pris sur votre part (compte courant, puis livrets), jamais sur celle des parents.</p>
        </>}
        {s.kind === 'pause' && <>
          <MonthField label="À partir de" value={s.month} max={horizon} onChange={month => onChange({ ...s, month })} />
          <MonthField label="Durée" value={s.months} max={horizon} onChange={months => onChange({ ...s, months })} />
          <p className="sm:col-span-2 text-xs text-on-surface-variant">Aucun versement pendant la pause (1 = le mois prochain).</p>
        </>}
        {s.kind === 'monthly' && (
          <MoneyField label="Mis de côté chaque mois" value={s.amount} onChange={amount => onChange({ ...s, amount })} />
        )}
        {s.kind === 'restitution' && (
          <RestitutionDateField value={s.date} min={minRestitutionDate} onChange={date => onChange({ ...s, date })} />
        )}
      </div>
    </li>
  );
};
