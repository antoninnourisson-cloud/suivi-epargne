// Écran « Mes comptes » (Material 3) : liste, filtres par étiquette (total par projet),
// fraîcheur du solde et performance de chaque compte, mouvements, création et modification.
// Les calculs viennent de lib (freshness, performance, accountTypes, finance).
import React, { useMemo, useState } from 'react';
import { AccountMovement, AccountType, FiscalConfig, SavingsAccount } from '../types';
import type { View } from '../navigation';
import { AccountForm } from './AccountForm';
import { MovementSearch } from './MovementSearch';
import { RegulatedRatesEditor } from './RegulatedRatesEditor';
import { AccountMovementList, type DisplayMovement } from './AccountMovementList';
import { AccountTotal } from './AccountTotal';
import { computeMaturityCountdown, computePeeAvailability, describeMaturity } from '../lib/finance';
import { formatEUR, formatRate, formatSignedEUR } from '../lib/format';
import { PlusCircle, Pencil, Trash2, Clock, ChevronDown, Tag, CheckCircle2, TrendingUp, FileText } from 'lucide-react';
import { signedAmount } from '../lib/money';
import { localTodayISO, parseISODate } from '../lib/dates';
import { balanceFreshness, describeCheckAge, offersBalanceCheck } from '../lib/freshness';
import { accountPerformance, isMarketAccount } from '../lib/performance';
import { ACCOUNT_TYPE_LABELS, totalsForTag } from '../lib/accountTypes';
import { Button, Card, Chip, IconButton, MoneyText, PageHeader } from './ui';

interface AccountsViewProps {
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  /** Mise à jour des taux des livrets (à partir de l'état le plus récent). */
  onUpdateAccounts: (update: (prev: SavingsAccount[]) => SavingsAccount[]) => void;
  setView: (v: View) => void;
  editingAccount: SavingsAccount | undefined;
  setEditingAccount: (a: SavingsAccount | undefined) => void;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  handleSaveAccount: (acc: SavingsAccount) => void;
  handleDeleteAccount: (acc: SavingsAccount) => void;
  handleDeleteMovement: (accountId: string, movementId: string) => void;
  handleRenameMovement: (accountId: string, movementId: string, currentLabel: string) => void;
  hasParental: boolean;
  /** « Lire un relevé » depuis la fiche d'un compte (proposé pour ce compte). */
  onReadStatement?: (accountId: string) => void;
}

const monthYear = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const pctText = (fraction: number) => formatRate(Math.round(fraction * 1000) / 10).replace(/^(?=\d)/, '+');

/** Ligne « performance » d'un placement (gain et rendement annuel), ou `null` si rien à dire. */
const PerformanceLine: React.FC<{ account: SavingsAccount }> = ({ account }) => {
  const perf = accountPerformance(account);
  if (!perf) return null;
  if (!perf.measured && account.totalDeposits === undefined) {
    return <p className="mt-1 text-xs text-on-surface-variant">Performance : actualisez la valeur du compte pour la mesurer.</p>;
  }
  const rate = perf.annualized !== null
    ? `${pctText(perf.annualized)} par an depuis ${monthYear(perf.since)}`
    : perf.periodReturn !== null ? `${pctText(perf.periodReturn)} depuis ${monthYear(perf.since)}` : null;
  return (
    <p className="mt-1 text-xs text-on-surface-variant flex items-center gap-1 flex-wrap">
      <TrendingUp className="w-3.5 h-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>Gain <MoneyText value={perf.gain} signed tone="auto" className="font-medium" />{account.totalDeposits === undefined ? ' depuis son ajout' : ''}{rate ? ` · ${rate}` : ''}</span>
    </p>
  );
};

export const AccountsView: React.FC<AccountsViewProps> = ({
  accounts, fiscalConfig, onUpdateAccounts, setView, editingAccount, setEditingAccount, showForm, setShowForm,
  handleSaveAccount, handleDeleteAccount, handleDeleteMovement, handleRenameMovement, hasParental, onReadStatement,
}) => {
  const [groupSmallMovements, setGroupSmallMovements] = useState(true);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  // Regroupe les mouvements < 1€ (bruit typique des PEE) en une ligne synthétique.
  const buildDisplayMovements = (movements: AccountMovement[]): DisplayMovement[] => {
    const sorted = [...movements].sort((a, b) => b.date.localeCompare(a.date));
    if (!groupSmallMovements) return sorted;
    const small = sorted.filter(m => Math.abs(m.amount) < 1);
    const large = sorted.filter(m => Math.abs(m.amount) >= 1);
    if (small.length <= 1) return sorted;
    const total = small.reduce((s, m) => s + (signedAmount(m)), 0);
    const synthetic: DisplayMovement = {
      id: '__grouped_small__',
      date: small[0].date,
      amount: Math.abs(total),
      label: `${small.length} mouvements < 1 € (total ${formatSignedEUR(total, 2)})`,
      type: total >= 0 ? 'IN' : 'OUT',
      grouped: true,
    };
    return [...large, synthetic].sort((a, b) => b.date.localeCompare(a.date));
  };

  const allTags = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach(a => (a.tags || []).forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    if (!activeTagFilter) return accounts;
    return accounts.filter(a => (a.tags || []).includes(activeTagFilter));
  }, [accounts, activeTagFilter]);
  const tagTotal = activeTagFilter ? totalsForTag(accounts, activeTagFilter) : null;

  const openForm = (acc?: SavingsAccount) => { setEditingAccount(acc); setShowForm(true); };
  // « Confirmer le solde » : le solde affiché est bien celui de la banque, aujourd'hui.
  const markChecked = (acc: SavingsAccount) => handleSaveAccount({ ...acc, balanceCheckedAt: localTodayISO() });

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <PageHeader
        title="Mes comptes"
        subtitle={<>{accounts.length} compte{accounts.length > 1 ? 's' : ''} · <button type="button" onClick={() => setView('journal')} className="underline underline-offset-2 text-primary hover:no-underline">voir le journal</button></>}
        actions={!showForm ? <Button onClick={() => openForm(undefined)}><PlusCircle className="w-4 h-4" aria-hidden="true" /> Ajouter un compte</Button> : undefined}
      />
      {!showForm && <MovementSearch accounts={accounts} />}
      {!showForm && accounts.some(a => [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP].includes(a.type)) && (
        <details className="rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-surface-container-low group">
          <summary className="list-none cursor-pointer px-5 min-h-12 flex items-center justify-between text-sm font-medium text-on-surface">
            Mettre à jour les taux des livrets
            <ChevronDown className="w-4 h-4 text-on-surface-variant transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="px-5 pb-5"><RegulatedRatesEditor accounts={accounts} onApply={onUpdateAccounts} /></div>
        </details>
      )}
      {showForm ? (
        <AccountForm
          onSave={handleSaveAccount}
          initialData={editingAccount}
          onCancel={() => { setShowForm(false); setEditingAccount(undefined); }}
          fiscalConfig={fiscalConfig}
          showParental={hasParental || !!editingAccount?.parentalCapital}
        />
      ) : (
        <>
          {allTags.length > 0 && (
            <div className="space-y-2">
              <div role="group" aria-label="Filtrer par étiquette" className="flex flex-wrap items-center gap-2">
                <Tag className="w-4 h-4 text-on-surface-variant" aria-hidden="true" />
                <Chip selected={!activeTagFilter} onClick={() => setActiveTagFilter(null)} className="max-sm:h-12">Tous</Chip>
                {allTags.map(t => (
                  <Chip key={t} selected={activeTagFilter === t} onClick={() => setActiveTagFilter(t === activeTagFilter ? null : t)} className="max-sm:h-12">{t}</Chip>
                ))}
              </div>
              <p aria-live="polite" className="text-sm text-on-surface">
                {tagTotal && activeTagFilter && (
                  <>Total « {activeTagFilter} » : <MoneyText value={tagTotal.owned} className="font-medium" /> de votre part{tagTotal.parental > 0.005 && <> (et <MoneyText value={tagTotal.parental} /> de vos parents)</>}, sur {tagTotal.count} compte{tagTotal.count > 1 ? 's' : ''}.</>
                )}
              </p>
            </div>
          )}
          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm md:min-w-136">
                <caption className="sr-only">Vos comptes</caption>
                <thead className="bg-surface-container border-b border-outline-variant">
                  <tr>
                    <th scope="col" className="px-4 md:px-6 py-3 text-xs font-medium text-on-surface-variant">Compte</th>
                    <th scope="col" className="px-4 md:px-6 py-3 text-xs font-medium text-on-surface-variant text-right">Ma part</th>
                    {/* Mode solo : plus de colonne des parents. */}
                    {hasParental && <th scope="col" className="hidden md:table-cell px-6 py-3 text-xs font-medium text-on-surface-variant text-right">Parents</th>}
                    <th scope="col" className="hidden md:table-cell px-6 py-3 text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {filteredAccounts.map(acc => {
                    const open = editingAccount?.id === acc.id && !showForm;
                    const fresh = balanceFreshness(acc);
                    return (
                      <React.Fragment key={acc.id}>
                        <tr className="hover:bg-on-surface/4 group transition-colors">
                          <td className="px-4 md:px-6 py-4 align-top">
                            <button type="button" onClick={() => setEditingAccount(open ? undefined : acc)} aria-expanded={open}
                              className="min-h-12 md:min-h-0 font-medium text-on-surface flex items-center gap-1 text-left hover:text-primary">
                              {acc.name} <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" /><span className="sr-only">: voir les mouvements</span>
                            </button>
                            <div className="text-xs text-on-surface-variant">{[acc.institution, ACCOUNT_TYPE_LABELS[acc.type]].filter(Boolean).join(' · ')}</div>
                            {acc.tags && acc.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {acc.tags.map(t => <span key={t} className="text-xs bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-sm font-medium">{t}</span>)}
                              </div>
                            )}
                            {(() => {
                              // PEE : déjà sans impôt sur le revenu, mais chaque versement est
                              // bloqué 5 ans : on annonce le prochain déblocage.
                              if (acc.type === AccountType.PEE) {
                                const pee = computePeeAvailability(acc, fiscalConfig);
                                const release = pee.nextRelease;
                                if (!release) {
                                  // Dates de versement inconnues : on ne devine aucune date.
                                  if (!pee.undated || pee.blocked < 0.5) return null;
                                  return (
                                    <div className="mt-1 text-xs font-medium text-primary flex items-center gap-1">
                                      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                      Date de déblocage inconnue
                                    </div>
                                  );
                                }
                                return (
                                  <div className="mt-1 text-xs font-medium text-primary flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                    {release.last ? 'Disponible' : `${formatEUR(release.amount, 0)} disponibles`} dans {release.monthsRemaining} mois
                                  </div>
                                );
                              }
                              // Compte à rebours de maturité fiscale (PEA/AV) : même calcul que
                              // Rendement, pour ne jamais annoncer un régime différent d'un écran à
                              // l'autre. Les prélèvements sociaux restent dus : on le dit.
                              const maturity = computeMaturityCountdown(acc, fiscalConfig);
                              if (!maturity) return null;
                              const text = describeMaturity(acc, maturity, fiscalConfig);
                              return (
                                <div className="mt-1 text-xs">
                                  <div className="font-medium text-primary flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                    {text.short}
                                  </div>
                                  <div className="text-on-surface-variant">{text.detail}</div>
                                </div>
                              );
                            })()}
                            {isMarketAccount(acc) && <PerformanceLine account={acc} />}
                            {fresh.limit !== null && (
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
                                <span className={fresh.stale ? 'font-medium text-tertiary' : 'text-on-surface-variant'}>Solde {describeCheckAge(fresh.days)}</span>
                                {offersBalanceCheck(acc.type, fresh) && (
                                  <Button type="button" variant="text" size="sm" onClick={() => markChecked(acc)} className="-ml-3 max-md:h-12!">
                                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Confirmer le solde<span className="sr-only"> de {acc.name} : il est à jour aujourd'hui</span>
                                  </Button>
                                )}
                              </div>
                            )}
                            {/* Téléphone : part des parents et total banque sur leur propre ligne
                                (un montant n'est jamais coupé), boutons en dessous à droite. Le
                                total banque quitte la colonne « Ma part », trop étroite à 320 px. */}
                            <div className="md:hidden mt-2 flex flex-wrap items-center gap-1">
                              {acc.parentalCapital > 0 && (
                                <div className="basis-full min-w-0 text-xs">
                                  <span className="font-medium text-parents whitespace-nowrap">Parents : {formatEUR(acc.parentalCapital)}</span>
                                  <AccountTotal account={acc} className="sm:hidden" />
                                </div>
                              )}
                              <span className="flex-1" />
                              <IconButton icon={Pencil} label={`Modifier ${acc.name}`} onClick={e => { e.stopPropagation(); openForm(acc); }} />
                              <IconButton icon={Trash2} tone="danger" label={`Supprimer ${acc.name}`} onClick={e => { e.stopPropagation(); handleDeleteAccount(acc); }} />
                            </div>
                          </td>
                          <td className="px-4 md:px-6 py-4 text-right align-top"><div className="text-base font-medium text-on-surface whitespace-nowrap tabular-nums">{formatEUR(acc.ownedAmount)}</div><AccountTotal account={acc} className="max-sm:hidden" /></td>
                          {hasParental && <td className="hidden md:table-cell px-6 py-4 text-right align-top font-medium text-parents tabular-nums">{formatEUR(acc.parentalCapital)}</td>}
                          <td className="hidden md:table-cell px-4 py-2 text-right align-top">
                            <div className="flex justify-end md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                              <IconButton icon={Pencil} label={`Modifier ${acc.name}`} onClick={e => { e.stopPropagation(); openForm(acc); }} />
                              <IconButton icon={Trash2} tone="danger" label={`Supprimer ${acc.name}`} onClick={e => { e.stopPropagation(); handleDeleteAccount(acc); }} />
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-surface-container animate-in slide-in-from-top-2">
                            <td colSpan={hasParental ? 4 : 3} className="p-4">
                              <div className="space-y-2">
                                {onReadStatement && (
                                  <Button variant="tonal" onClick={() => onReadStatement(acc.id)} aria-label={`Lire un relevé de ${acc.name}`}>
                                    <FileText className="w-4 h-4" aria-hidden="true" /> Lire un relevé
                                  </Button>
                                )}
                                <label className="flex items-center gap-3 min-h-12 text-sm text-on-surface cursor-pointer">
                                  <input type="checkbox" checked={groupSmallMovements} onChange={e => setGroupSmallMovements(e.target.checked)} className="w-5 h-5 accent-primary" />
                                  Regrouper les mouvements de moins de 1 €
                                </label>
                                <AccountMovementList
                                  key={acc.id}
                                  movements={buildDisplayMovements(acc.movements)}
                                  onRename={(id, label) => handleRenameMovement(acc.id, id, label)}
                                  onDelete={id => handleDeleteMovement(acc.id, id)}
                                />
                                {acc.movements.length === 0 && <p className="text-center text-on-surface-variant italic py-4">Aucun mouvement enregistré.</p>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
