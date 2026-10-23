// Plan « solo » : à quoi ressemble votre épargne, année par année, après la restitution
// du capital de vos parents, avec les étapes (précaution atteinte, livrets pleins).
import React, { useMemo, useState } from 'react';
import { Sprout, Flag, Info } from 'lucide-react';
import { FiscalConfig, SavingsAccount } from '../types';
import { buildSoloPlan } from '../lib/planning';
import { withAssumedRates, type ProjectionHypotheses } from '../lib/performance';
import { ProjectionAssumptionsNote } from './ProjectionAssumptionsNote';
import { SavingsSplit } from '../lib/finance';
import { parseFrenchNumber } from '../lib/numbers';
import { formatEUR } from '../lib/format';
import { parseISODate } from '../lib/dates';
import { Card, TextField } from './ui';

interface Props {
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  monthPlan?: number;
  restitutionISO: string;
  split?: SavingsSplit;
  emergencyTarget?: number;
  /** Gardé sur le compte courant pour les dépenses du mois : hors épargne de précaution (EmergencyFund.cashBuffer). */
  cashBuffer?: number;
  /** Rendement supposé des placements sans taux saisi (useDerivedData) ; calculé ici s'il manque. */
  hypotheses?: ProjectionHypotheses;
}

export const SoloPlanCard: React.FC<Props> = ({ accounts, fiscalConfig, monthPlan, restitutionISO, split, emergencyTarget, cashBuffer, hypotheses }) => {
  const [raw, setRaw] = useState(String(Math.round(monthPlan && monthPlan > 0 ? monthPlan : 500)));
  const parsed = parseFrenchNumber(raw);
  const monthly = parsed ?? 0;
  // Même hypothèse de rendement qu'au Rendement et dans « Et si… » pour un placement sans taux saisi.
  const projection = useMemo(() => hypotheses ?? withAssumedRates(accounts), [hypotheses, accounts]);
  const plan = useMemo(
    () => buildSoloPlan(accounts, fiscalConfig, monthly, restitutionISO, { years: 4, split, emergencyTarget, cashBuffer, assumedRates: projection.rates }),
    [accounts, fiscalConfig, monthly, restitutionISO, split, emergencyTarget, cashBuffer, projection.rates],
  );
  const startYear = parseISODate(restitutionISO).getFullYear();

  return (
    <Card title={`Votre plan solo ${startYear}-${startYear + 3}`} icon={Sprout}>
      <div className="space-y-5">
        <p className="text-sm text-on-surface-variant -mt-2">Après la restitution, vous repartez de {formatEUR(plan.startTotal, 0)} : votre part seulement. Les livrets retrouvent de la place sous leurs plafonds.</p>
        <TextField
          label="Épargne par mois"
          suffix="€"
          inputMode="decimal"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          error={raw.trim() !== '' && parsed === null ? 'Montant non reconnu (exemple : 500 ou 450,50) : le plan est calculé avec 0 €.' : undefined}
          className="max-w-xs"
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Épargne au 31 décembre de chaque année</caption>
            <thead>
              <tr className="border-b border-outline-variant text-xs font-medium text-on-surface-variant">
                <th scope="col" className="py-2 pr-3 text-left">Fin</th>
                <th scope="col" className="py-2 pr-3 text-right">Total</th>
                <th scope="col" className="py-2 text-left">Détail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {plan.years.map(y => (
                <tr key={y.year}>
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium text-on-surface align-top">{y.year}</th>
                  <td className="py-2.5 pr-3 text-right font-medium text-on-surface whitespace-nowrap align-top">{formatEUR(y.total, 0)}</td>
                  <td className="py-2.5 text-xs text-on-surface-variant align-top">{y.byAccount.map(b => `${b.name} ${formatEUR(b.amount, 0)}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {plan.milestones.length > 0 && (
          <ul className="space-y-1.5">
            {plan.milestones.map(m => (
              <li key={`${m.date}-${m.label}`} className="text-sm text-on-surface flex items-start gap-2">
                <Flag className="w-4 h-4 shrink-0 mt-0.5 text-tertiary" aria-hidden="true" />
                <span><span className="font-medium">{parseISODate(m.date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</span> : {m.label}</span>
              </li>
            ))}
          </ul>
        )}
        {plan.unplaced >= 1 && (
          <p className="text-sm rounded-xl p-3 bg-tertiary-container text-on-tertiary-container">
            {formatEUR(plan.unplaced, 0)} versés ne trouvent pas de place (livrets pleins, ni assurance vie ni PEA) : ils restent sur le compte courant, sans intérêts, et sont comptés dans les totaux.
          </p>
        )}
        <ProjectionAssumptionsNote assumptions={projection.assumptions} />
        <p className="text-xs text-on-surface-variant flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span>Taux d'aujourd'hui supposés constants, intérêts nets d'impôt et de prélèvements sociaux en cas de retrait. Votre répartition personnalisée est utilisée si vous en avez une, sinon le plan « meilleur taux d'abord ».</span>
        </p>
      </div>
    </Card>
  );
};
