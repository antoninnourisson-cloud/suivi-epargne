// ================================================
// FILE: src/components/SplitProjectionCard.tsx
// Projection de l'épargne selon la répartition : 100 % Livret A, votre répartition (ou
// 50/50), 100 % Assurance Vie, avec les taux NETS (impôt et prélèvements sociaux d'un
// retrait déduits, voir netAnnualRate) et les plafonds des livrets. Part de votre part
// propre actuelle ; ce qui ne trouve pas de place reste compté sur le compte courant.
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount, AccountType, FiscalConfig } from '../types';
import { projectSavings, netAnnualRate } from '../lib/projection';
import { formatEUR, formatRate } from '../lib/format';
import { parseFrenchNumber } from '../lib/numbers';
import { LineChart } from 'lucide-react';
import { Card, SegmentedButton, TextField } from './ui';

interface Props {
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  monthPlan?: number;
  savingsSplit?: { accountId: string; pct: number }[];
  restitutionInMonths?: number;
  /** Rendement supposé des placements sans taux saisi (identifiant → % par an) : intérêts seulement. */
  assumedRates?: Readonly<Record<string, number>>;
}

type Years = '5' | '10' | '20';
const DURATIONS: { value: Years; label: string }[] = [
  { value: '5', label: '5 ans' },
  { value: '10', label: '10 ans' },
  { value: '20', label: '20 ans' },
];

export const SplitProjectionCard: React.FC<Props> = ({ accounts, fiscalConfig, monthPlan, savingsSplit, restitutionInMonths, assumedRates }) => {
  const la = accounts.find(a => a.type === AccountType.LIVRET_A);
  const av = accounts.find(a => a.type === AccountType.ASSURANCE_VIE);
  const [monthlyRaw, setMonthlyRaw] = useState(String(Math.round(monthPlan && monthPlan > 0 ? monthPlan : 1000)));
  const [duration, setDuration] = useState<Years>('10');
  const years = Number(duration);
  const monthly = parseFrenchNumber(monthlyRaw) ?? 0;

  const scenarios = useMemo(() => {
    if (!la || !av || monthly <= 0) return [];
    const custom = savingsSplit && savingsSplit.length > 0;
    // Espace fine insécable avant « % » : « 100 % » ne se coupe jamais en fin de ligne.
    const list: { label: string; split: { accountId: string; pct: number }[] }[] = [
      { label: `100 % ${la.name}`, split: [{ accountId: la.id, pct: 100 }] },
      { label: custom ? 'Votre répartition' : `50 % ${la.name} · 50 % ${av.name}`, split: custom ? savingsSplit! : [{ accountId: la.id, pct: 50 }, { accountId: av.id, pct: 50 }] },
      { label: `100 % ${av.name}`, split: [{ accountId: av.id, pct: 100 }] },
    ];
    return list.map(sc => ({ ...sc, result: projectSavings(accounts, fiscalConfig, monthly, years, sc.split, restitutionInMonths, new Date(), assumedRates) }));
  }, [accounts, fiscalConfig, la, av, monthly, years, savingsSplit, restitutionInMonths, assumedRates]);

  if (!la || !av) return null;
  const best = Math.max(...scenarios.map(s => s.result.total), 0);

  return (
    <Card title="Projection selon la répartition" icon={LineChart}>
      <p className="-mt-2 text-sm text-on-surface-variant">
        Taux nets : {la.name} {formatRate(netAnnualRate(la, fiscalConfig))} · {av.name} {formatRate(Math.round(netAnnualRate(assumedRates?.[av.id] !== undefined ? { ...av, interestRate: assumedRates[av.id], managementFee: undefined } : av, fiscalConfig) * 100) / 100)} (après impôt et prélèvements sociaux d'un retrait, selon l'ancienneté du contrat).
        Taux supposés constants, à partir de votre part actuelle{restitutionInMonths !== undefined ? ' ; la restitution du capital de vos parents est prise en compte' : ''}.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <TextField label="Épargne par mois" suffix="€" inputMode="decimal" value={monthlyRaw} onChange={e => setMonthlyRaw(e.target.value)} className="w-full sm:w-44" />
        <SegmentedButton
          label="Durée" options={DURATIONS} value={duration} onChange={setDuration}
          className="max-sm:w-full [&>button]:whitespace-nowrap max-sm:[&>button]:flex-1 max-sm:[&>button]:h-12 max-sm:[&>button]:px-1 max-sm:[&>button]:gap-1"
        />
      </div>
      <ul className="mt-4 space-y-2" aria-label={`Trois répartitions sur ${years} ans`}>
        {scenarios.map(sc => {
          const isBest = sc.result.total === best;
          return (
            <li key={sc.label} className={`p-3 rounded-xl ${isBest ? 'bg-secondary-container text-on-secondary-container' : 'border border-outline-variant'}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium">
                  {sc.label}
                  {isBest && <span className="ml-2 whitespace-nowrap text-xs font-normal">(le plus élevé)</span>}
                </p>
                <p className="text-base font-medium tabular-nums whitespace-nowrap">{formatEUR(sc.result.total, 0)}</p>
              </div>
              <p className={`text-xs ${isBest ? '' : 'text-on-surface-variant'}`}>
                dont {formatEUR(sc.result.interest, 0)} d'intérêts nets · {sc.result.byAccount.map(b => `${b.name} ${formatEUR(b.amount, 0)}`).join(' · ')}
              </p>
              {sc.result.unplaced >= 1 && (
                <p className="mt-2 text-xs rounded-lg p-2 bg-tertiary-container text-on-tertiary-container">
                  {formatEUR(sc.result.unplaced, 0)} versés ne trouvent pas de place (livrets pleins) : ils restent sur le compte courant, sans intérêts.
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-on-surface-variant">
        Le Livret A est disponible à tout moment et sans impôt. L'Assurance Vie l'est aussi, mais un retrait est imposé sur la part de gains (moins après 8 ans) : la différence de rendement se paie en souplesse.
      </p>
    </Card>
  );
};
