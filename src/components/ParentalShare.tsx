// ================================================
// FILE: src/components/ParentalShare.tsx
// Part parentale : votre capital et celui de vos parents, compte par compte, puis la
// restitution. Couleur des parents : rôle « tertiary », comme au Pilotage et à l'Accueil.
// ================================================
import React, { useMemo } from 'react';
import { SavingsAccount, ParentalRestitution } from '../types';
import { RestitutionPanel } from './RestitutionPanel';
import { Users, User, Wallet } from 'lucide-react';
import { AccountTotal } from './AccountTotal';
import { Button, Card, EmptyState, MoneyText, PageHeader, StatTile } from './ui';

interface ParentalShareProps {
  accounts: SavingsAccount[];
  restitution?: ParentalRestitution;
  monthPlan?: number;
  hasCustomSplit?: boolean;
  onPlanRestitution: (date: string | undefined) => void;
  onRestitute: (date: string) => void;
  onUndoRestitution: () => void;
  soloPlanSlot?: React.ReactNode;
  /** État vide : ouvre Mes comptes, où l'on indique la part des parents compte par compte. */
  onOpenAccounts?: () => void;
}

/** Barre « moi / parents » : la répartition est aussi écrite à côté (la couleur ne porte pas seule l'information). */
const SplitBar: React.FC<{ ownedPct: number; className?: string }> = ({ ownedPct, className = 'h-3' }) => (
  <div className={`w-full rounded-full overflow-hidden flex gap-0.5 bg-surface-container-highest ${className}`} aria-hidden="true">
    {ownedPct > 0 && <div className="h-full bg-primary rounded-full" style={{ width: `${ownedPct}%` }} />}
    {ownedPct < 100 && <div className="h-full bg-tertiary rounded-full flex-1" />}
  </div>
);

export const ParentalShare: React.FC<ParentalShareProps> = ({ accounts, restitution, monthPlan, hasCustomSplit, onPlanRestitution, onRestitute, onUndoRestitution, soloPlanSlot, onOpenAccounts }) => {
  const { totalOwned, totalParental, rows } = useMemo(() => {
    const rows = accounts
      .filter(a => a.parentalCapital > 0 || a.ownedAmount > 0)
      .map(a => ({ id: a.id, name: a.name, type: a.type, owned: a.ownedAmount, parental: a.parentalCapital, total: a.totalAmount }))
      .sort((x, y) => y.parental - x.parental);
    return {
      totalOwned: accounts.reduce((s, a) => s + a.ownedAmount, 0),
      totalParental: accounts.reduce((s, a) => s + a.parentalCapital, 0),
      rows,
    };
  }, [accounts]);

  const grand = totalOwned + totalParental;
  // Après restitution il n'y a plus de part parentale : on ne garde que le relevé.
  const noParental = totalParental <= 0;
  const ownedPct = grand > 0 ? (totalOwned / grand) * 100 : 0;

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <PageHeader title="Part parentale" subtitle="Distinguez votre capital réel de l'argent géré pour vos parents." />

      <RestitutionPanel
        accounts={accounts}
        restitution={restitution}
        monthPlan={monthPlan}
        hasCustomSplit={hasCustomSplit}
        onPlan={onPlanRestitution}
        onRestitute={onRestitute}
        onUndo={onUndoRestitution}
      />

      {soloPlanSlot}

      {noParental && !restitution?.done && (
        <Card variant="filled" padding="none">
          <EmptyState
            icon={Users}
            title="Aucun capital de vos parents sur vos comptes"
            action={onOpenAccounts && <Button variant="tonal" onClick={onOpenAccounts}><Wallet className="w-4 h-4" aria-hidden="true" /> Ouvrir Mes comptes</Button>}
          >
            Si une partie d'un compte appartient à vos parents, indiquez-la dans Mes comptes, compte par compte : elle sera suivie ici et jamais comptée comme votre épargne.
          </EmptyState>
        </Card>
      )}

      {!noParental && <>
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <StatTile
              label={<span className="inline-flex items-center gap-2"><User className="w-4 h-4 text-primary" aria-hidden="true" /> Mon capital</span>}
              value={<MoneyText value={totalOwned} className="text-primary" />}
              hint={`${ownedPct.toFixed(0)} % du total géré`}
            />
            <StatTile
              label={<span className="inline-flex items-center gap-2"><Users className="w-4 h-4 text-tertiary" aria-hidden="true" /> Capital parents</span>}
              value={<MoneyText value={totalParental} className="text-tertiary" />}
              hint={`${(100 - ownedPct).toFixed(0)} % du total géré`}
            />
          </div>
          <SplitBar ownedPct={ownedPct} className="h-3 mt-5" />
          <p className="text-xs text-on-surface-variant mt-2">Total géré : <MoneyText value={grand} /></p>
        </Card>

        <Card title="Compte par compte" padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">Votre part et celle de vos parents, compte par compte</caption>
              <thead>
                <tr className="border-y border-outline-variant">
                  <th scope="col" className="px-5 sm:px-6 py-2 text-left text-xs font-medium text-on-surface-variant">Compte</th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-on-surface-variant">Moi</th>
                  <th scope="col" className="px-5 sm:px-3 py-2 text-right text-xs font-medium text-on-surface-variant">Parents</th>
                  <th scope="col" className="hidden md:table-cell pl-3 pr-6 py-2 text-left text-xs font-medium text-on-surface-variant w-1/3">Répartition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {rows.map(r => {
                  const pct = r.total > 0 ? (r.owned / r.total) * 100 : 0;
                  return (
                    <tr key={r.id}>
                      <th scope="row" className="px-5 sm:px-6 py-3 text-left align-top font-normal">
                        <div className="font-medium text-on-surface">{r.name}</div>
                        <div className="text-xs text-on-surface-variant">{r.type}</div>
                      </th>
                      <td className="px-3 py-3 text-right align-top">
                        <MoneyText value={r.owned} className="text-primary font-medium" />
                        <AccountTotal account={{ ownedAmount: r.owned, parentalCapital: r.parental }} />
                      </td>
                      <td className="px-5 sm:px-3 py-3 text-right align-top"><MoneyText value={r.parental} className="text-tertiary font-medium" /></td>
                      <td className="hidden md:table-cell pl-3 pr-6 py-3 align-middle">
                        <SplitBar ownedPct={pct} className="h-2.5" />
                        <span className="sr-only">{pct.toFixed(0)} % à vous</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </>}
    </div>
  );
};
