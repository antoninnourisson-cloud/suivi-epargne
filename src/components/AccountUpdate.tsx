// src/components/AccountUpdate.tsx
// Écran « Actualiser les soldes » : une ligne compacte par compte, qui se déplie sur la
// saisie (nouveau solde, total affiché par la banque, ou ajustement « + / − x € »).
// Toute la logique des brouillons vit ici (calculs purs dans update/draft) ; les lignes
// (update/AccountUpdateRow) affichent. L'enregistrement passe par la commande
// updateBalances : saisie illisible refusée, arrondi au centime, part propre ≥ 0, intérêts
// et variations de valeur hors épargne.
import React, { useState, useEffect, useRef } from 'react';
import { SavingsAccount } from '../types';
import { Button } from './Button';
import { Card, EmptyState, PageHeader } from './ui';
import { AccountUpdateRow } from './update/AccountUpdateRow';
import {
  DEFAULT_ADJUST, breakdownDraft, clearStoredDrafts, draftToUpdate, loadStoredDrafts, parseDeposits, saveStoredDrafts,
  type Adjust, type Draft, type DraftField,
} from './update/draft';
import { Save, Wallet, CheckCircle } from 'lucide-react';
import { useSaveFeedback } from '../hooks/useSaveFeedback';
import { useToast } from './Toast';
import { parseFrenchNumber } from '../lib/numbers';
import { tracksDeposits, depositsAfterWithdrawal } from '../lib/finance';
import { updateBalances, type CommandPatch } from '../lib/commands';
import { localTodayISO } from '../lib/dates';
import { formatEUR, toInputAmount } from '../lib/format';

interface AccountUpdateProps {
  accounts: SavingsAccount[];
  /** Repli : enregistre les comptes déjà calculés par la commande (sans annulation). */
  onUpdateAccountsComplex: (updates: { account: SavingsAccount, date: string, cashFlow?: number }[]) => void;
  /** Applique le résultat d'une commande (comme `commit` dans App) : active « Annuler » après l'enregistrement. */
  onCommit?: (patch: CommandPatch) => void;
  onCancel?: () => void; // Ajout prop optionnelle pour cohérence
  onAddAccount?: () => void;
  // Horodatage de la dernière écriture Drive CONFIRMÉE : sert à n'annoncer le succès que
  // lorsqu'il est réel (voir useSaveFeedback).
  lastSavedAt?: Date | null;
}

const FIELDS: readonly DraftField[] = ['owned', 'parental', 'date', 'deposits', 'cashFlow', 'bankTotal', 'interest', 'cash'];
const copyField = <K extends DraftField>(to: Draft, from: Draft, k: K) => { to[k] = from[k]; };
/** Brouillon frais d'un compte, sur lequel on reporte les champs saisis (`touched`) d'un ancien. */
const mergeDraft = (fresh: Draft, d: Draft | undefined): Draft => {
  if (!d?.touched?.length) return fresh;
  const merged: Draft = { ...fresh, touched: d.touched };
  for (const f of d.touched) copyField(merged, d, f);
  return merged;
};

export const AccountUpdate: React.FC<AccountUpdateProps> = ({ accounts, onUpdateAccountsComplex, onCommit, lastSavedAt, onAddAccount }) => {
  const today = localTodayISO();
  const { status: saveStatus, markPending } = useSaveFeedback(lastSavedAt);
  const addToast = useToast();
  // État le plus récent pour l'annulation (le toast survit à ce rendu).
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const draftFrom = (account: SavingsAccount): Draft => ({
    owned: toInputAmount(account.ownedAmount),
    parental: toInputAmount(account.parentalCapital),
    date: today,
    deposits: account.totalDeposits !== undefined ? toInputAmount(account.totalDeposits) : '',
    cashFlow: 0,
  });
  // Saisie restaurée : l'écran a été quitté (autre onglet de l'app, verrouillage) avant
  // l'enregistrement. Voir update/draft (sessionStorage).
  const [restoredIds, setRestoredIds] = useState<string[]>(() => {
    const stored = loadStoredDrafts();
    return accounts.filter(a => stored[a.id]?.touched?.length).map(a => a.id);
  });
  const [updates, setUpdatesRaw] = useState<Record<string, Draft>>(() => {
    const stored = loadStoredDrafts();
    return Object.fromEntries(accounts.map(a => [a.id, mergeDraft(draftFrom(a), stored[a.id])]));
  });
  useEffect(() => { saveStoredDrafts(updates); }, [updates]);
  // Toute modification passe par ici : on retient CHAMP PAR CHAMP ce que l'utilisateur a
  // saisi. Les champs non touchés suivent les comptes en direct (changer seulement la date
  // n'empêche plus un ajout rapide d'être pris en compte).
  const setUpdates = (fn: (prev: Record<string, Draft>) => Record<string, Draft>) =>
    setUpdatesRaw(prev => {
      const next = fn(prev);
      for (const id of Object.keys(next)) {
        if (next[id] === prev[id]) continue;
        const changed = FIELDS.filter(f => next[id][f] !== prev[id]?.[f]);
        next[id] = { ...next[id], touched: [...new Set([...(prev[id]?.touched || []), ...changed])] };
      }
      return next;
    });
  useEffect(() => {
    setUpdatesRaw(prev => Object.fromEntries(accounts.map(a => [a.id, mergeDraft(draftFrom(a), prev[a.id])])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  // Lignes dépliées (plusieurs à la fois possibles). Avec un seul compte, il est ouvert ;
  // une saisie restaurée l'est aussi.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(accounts.length === 1 ? [accounts[0].id] : restoredIds));
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  const patchDraft = (id: string, patch: Partial<Draft>) => {
    setSaveError(null);
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };
  const handleOwnedChange = (id: string, val: string) => patchDraft(id, { owned: val, bankTotal: undefined });
  const handleParentalChange = (id: string, val: string) => patchDraft(id, { parental: val, bankTotal: undefined });
  const handleDepositsChange = (id: string, val: string) => patchDraft(id, { deposits: val });
  const handleDateChange = (id: string, val: string) => patchDraft(id, { date: val });
  const handleInterestChange = (id: string, val: string | undefined) => patchDraft(id, { interest: val });
  const handleCashChange = (id: string, val: string | undefined) => patchDraft(id, { cash: val });

  // --- AJUSTEMENT RAPIDE : « +/- x € sur ma part / celle des parents » ---
  // Évite de recalculer soi-même le nouveau solde : l'écart est appliqué au montant en
  // cours de saisie (et donc cumulable), puis enregistré avec le reste via « Tout
  // enregistrer ». Le récapitulatif de la ligne montre le résultat avant validation.
  const [adjusts, setAdjusts] = useState<Record<string, Adjust>>({});
  const [adjustErrors, setAdjustErrors] = useState<Record<string, string | null>>({});
  const adjustFor = (id: string): Adjust => adjusts[id] ?? DEFAULT_ADJUST;
  const patchAdjust = (id: string, patch: Partial<Adjust>) => {
    // Fusion sur l'état le plus RÉCENT (`prev`), pas sur celui du rendu courant : deux
    // clics rapprochés (« − » puis « Parents ») s'écrasaient sinon l'un l'autre.
    setAdjusts(prev => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_ADJUST), ...patch } }));
    setAdjustErrors(prev => ({ ...prev, [id]: null }));
  };

  const applyAdjust = (id: string) => {
    const a = adjustFor(id);
    const amount = parseFrenchNumber(a.amount);
    if (amount === null || amount <= 0) { setAdjustErrors(prev => ({ ...prev, [id]: 'Saisissez un montant supérieur à 0.' })); return; }
    const current = parseFrenchNumber(updates[id][a.target]);
    if (current === null) { setAdjustErrors(prev => ({ ...prev, [id]: 'Corrigez d\'abord le montant saisi plus haut.' })); return; }
    const next = Math.round((current + a.sign * amount) * 100) / 100;
    if (next < 0) {
      setAdjustErrors(prev => ({ ...prev, [id]: `Impossible : ${a.target === 'owned' ? 'votre part' : 'la part des parents'} deviendrait négative (${formatEUR(next)}).` }));
      return;
    }
    const account = accounts.find(acc => acc.id === id);
    const draft = updates[id];
    const deposits = parseDeposits(draft.deposits);
    const tracksCash = !!account && tracksDeposits(account.type) && typeof deposits === 'number' && a.isCash && a.target === 'owned';
    const valueBefore = (parseFrenchNumber(draft.owned) ?? 0) + (parseFrenchNumber(draft.parental) ?? 0);
    setUpdates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [a.target]: toInputAmount(next),
        ...(tracksCash ? {
          cashFlow: prev[id].cashFlow + a.sign * amount,
          cash: undefined,
          deposits: toInputAmount(Math.round((a.sign > 0 ? deposits + amount : depositsAfterWithdrawal(deposits, valueBefore, amount)) * 100) / 100),
        } : {}),
      },
    }));
    patchAdjust(id, { amount: '' });
  };

  const breakdowns = Object.fromEntries(accounts.map(account => [account.id, breakdownDraft(account, updates[account.id] ?? draftFrom(account))]));
  const changedCount = accounts.filter(account => breakdowns[account.id].changed).length;

  // Saisie directe du total affiché par la banque : la part propre en est déduite, le
  // capital parental (qui ne bouge pas) restant tel quel.
  const handleBankTotalChange = (id: string, val: string) => {
    setSaveError(null);
    setUpdates(prev => {
      const u = prev[id];
      const total = parseFrenchNumber(val);
      const parental = parseFrenchNumber(u.parental) ?? 0;
      // Total inférieur à la part des parents : saisie incohérente, la part propre n'est
      // pas touchée (message sous le champ).
      const owned = total === null || total < parental ? u.owned : toInputAmount(Math.round((total - parental) * 100) / 100);
      return { ...prev, [id]: { ...u, bankTotal: val, owned } };
    });
  };

  /** Tout revient aux soldes enregistrés ; la saisie conservée est effacée. */
  const resetDrafts = () => {
    setUpdatesRaw(Object.fromEntries(accounts.map(a => [a.id, draftFrom(a)])));
    setRestoredIds([]);
    clearStoredDrafts();
  };

  const handleSaveAll = () => {
    const rows = accounts
      .map(account => ({ account, draft: updates[account.id] ?? draftFrom(account), b: breakdowns[account.id] }))
      .filter(r => r.b.changed);
    const invalid = rows.find(r => Object.keys(r.b.errors).length > 0);
    if (invalid) {
      setSaveError(`${invalid.account.name} : ${Object.values(invalid.b.errors)[0]}`);
      setExpanded(prev => new Set(prev).add(invalid.account.id));
      return;
    }
    const r = updateBalances({ accounts }, { updates: rows.map(x => draftToUpdate(x.account, x.draft, x.b)) });
    if (!r.ok) { setSaveError(r.error); return; }
    setSaveError(null);
    markPending();
    if (onCommit) {
      onCommit(r.next);
      addToast?.({ message: r.message, kind: 'success', action: { label: 'Annuler', onClick: () => onCommit(r.undo({ accounts: accountsRef.current })) } });
    } else {
      // Comptes déjà calculés (mouvements compris) : le hook les reprend tels quels.
      const next = r.next.accounts || [];
      onUpdateAccountsComplex(r.changedIds.map(id => ({
        account: next.find(a => a.id === id)!,
        date: rows.find(x => x.account.id === id)?.draft.date ?? today,
      })));
    }
    // Brouillons remis à zéro : un second « Enregistrer » ne rejoue pas les versements
    // (le flux d'argent `cashFlow` aurait été compté deux fois).
    setUpdatesRaw(prev => Object.fromEntries(Object.entries(prev).map(([id, d]) => [id, { ...d, cashFlow: 0, interest: undefined, cash: undefined, touched: [] }])));
    setRestoredIds([]);
    clearStoredDrafts();
  };

  if (accounts.length === 0) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Actualiser les soldes" />
        <Card>
          <EmptyState
            icon={Wallet}
            title="Ajoutez d'abord un compte"
            action={onAddAccount && <Button onClick={onAddAccount}>Ajouter un compte</Button>}
          >
            Ici, vous mettrez à jour vos soldes d'après vos relevés.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const changedLabel = `${changedCount} compte${changedCount > 1 ? 's' : ''} modifié${changedCount > 1 ? 's' : ''}${restoredIds.length > 0 ? ' (saisie restaurée)' : ''}`;
  const saved = saveStatus === 'saved' && (
    <span role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
      <CheckCircle className="w-4 h-4" aria-hidden="true" /> Enregistré sur Drive
    </span>
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Actualiser les soldes"
        subtitle="Indiquez vos nouveaux soldes et la date du constat. Vos graphiques s'adapteront automatiquement."
        actions={<>
          {saved}
          <Button onClick={handleSaveAll} isLoading={saveStatus === 'pending'} disabled={changedCount === 0}>
            <Save className="w-4 h-4" aria-hidden="true" /> Tout enregistrer
          </Button>
        </>}
      />

      {saveError && (
        <p role="alert" className="mb-4 rounded-xl bg-error-container text-on-error-container p-3 text-sm font-medium">{saveError}</p>
      )}

      <Card padding="none" className="overflow-hidden">
        <ul className="divide-y divide-outline-variant" aria-label="Comptes à actualiser">
          {accounts.map(account => (
            <AccountUpdateRow
              key={account.id}
              account={account}
              draft={updates[account.id] ?? draftFrom(account)}
              breakdown={breakdowns[account.id]}
              adjust={adjustFor(account.id)}
              adjustError={adjustErrors[account.id]}
              today={today}
              expanded={expanded.has(account.id)}
              onToggle={() => toggle(account.id)}
              onOwnedChange={val => handleOwnedChange(account.id, val)}
              onParentalChange={val => handleParentalChange(account.id, val)}
              onBankTotalChange={val => handleBankTotalChange(account.id, val)}
              onDepositsChange={val => handleDepositsChange(account.id, val)}
              onDateChange={val => handleDateChange(account.id, val)}
              onInterestChange={val => handleInterestChange(account.id, val)}
              onCashChange={val => handleCashChange(account.id, val)}
              onPatchAdjust={patch => patchAdjust(account.id, patch)}
              onApplyAdjust={() => applyAdjust(account.id)}
            />
          ))}
        </ul>
      </Card>

      {changedCount > 0 && (
        <div className="fixed left-4 right-4 bottom-20 md:bottom-6 md:left-auto md:right-8 md:w-[28rem] z-30 flex items-center justify-between gap-2 p-3 pl-5 rounded-2xl bg-inverse-surface text-inverse-on-surface shadow-lg">
          <span className="text-sm font-medium">{changedLabel}</span>
          <span className="flex items-center gap-1 shrink-0">
            <Button variant="text" onClick={resetDrafts} className="text-inverse-primary! px-3">Abandonner</Button>
            <Button onClick={handleSaveAll} isLoading={saveStatus === 'pending'} className="bg-inverse-primary! text-indigo-900! hover:bg-indigo-200!">
              <Save className="w-4 h-4" aria-hidden="true" /> Enregistrer
            </Button>
          </span>
        </div>
      )}
      {changedCount > 0 && <div className="h-24" aria-hidden />}
    </div>
  );
};
