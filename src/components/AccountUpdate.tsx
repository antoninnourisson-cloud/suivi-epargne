// src/components/AccountUpdate.tsx
// Écran « Actualiser les soldes » : une ligne compacte par compte, qui se déplie sur la
// saisie (nouveau solde, total affiché par la banque, ou ajustement « + / − x € »).
// Toute la logique des brouillons vit ici ; les lignes (update/AccountUpdateRow) affichent.
import React, { useState, useEffect } from 'react';
import { SavingsAccount } from '../types';
import { Button } from './Button';
import { Card, EmptyState, PageHeader } from './ui';
import { AccountUpdateRow } from './update/AccountUpdateRow';
import { DEFAULT_ADJUST, type Adjust, type Draft, type DraftField } from './update/draft';
import { Save, Wallet, CheckCircle } from 'lucide-react';
import { useSaveFeedback } from '../hooks/useSaveFeedback';
import { safeNumber, parseFrenchNumber } from '../lib/numbers';
import { tracksDeposits, depositsAfterWithdrawal } from '../lib/finance';
import { localTodayISO } from '../lib/dates';
import { formatEUR, toInputAmount } from '../lib/format';

interface AccountUpdateProps {
  accounts: SavingsAccount[];
  onUpdateAccountsComplex: (updates: { account: SavingsAccount, date: string, cashFlow?: number }[]) => void;
  onCancel?: () => void; // Ajout prop optionnelle pour cohérence
  onAddAccount?: () => void;
  // Horodatage de la dernière écriture Drive CONFIRMÉE : sert à n'annoncer le succès que
  // lorsqu'il est réel (voir useSaveFeedback).
  lastSavedAt?: Date | null;
}

const FIELDS: readonly DraftField[] = ['owned', 'parental', 'date', 'deposits', 'cashFlow', 'bankTotal'];
const copyField = <K extends DraftField>(to: Draft, from: Draft, k: K) => { to[k] = from[k]; };
const parseDeposits = (val: string): number | undefined | null =>
  val.trim() === '' ? undefined : parseFrenchNumber(val);

export const AccountUpdate: React.FC<AccountUpdateProps> = ({ accounts, onUpdateAccountsComplex, lastSavedAt, onAddAccount }) => {
  const today = localTodayISO();
  const { status: saveStatus, markPending } = useSaveFeedback(lastSavedAt);

  const draftFrom = (account: SavingsAccount): Draft => ({
    owned: toInputAmount(account.ownedAmount),
    parental: toInputAmount(account.parentalCapital),
    date: today,
    deposits: account.totalDeposits !== undefined ? toInputAmount(account.totalDeposits) : '',
    cashFlow: 0,
  });
  const [updates, setUpdatesRaw] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(accounts.map(a => [a.id, draftFrom(a)])));
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
    setUpdatesRaw(prev => Object.fromEntries(accounts.map(a => {
      const fresh = draftFrom(a);
      const d = prev[a.id];
      if (!d?.touched?.length) return [a.id, fresh];
      const merged: Draft = { ...fresh, touched: d.touched };
      for (const f of d.touched) copyField(merged, d, f);
      return [a.id, merged];
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  // Lignes dépliées (plusieurs à la fois possibles). Avec un seul compte, il est ouvert.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(accounts.length === 1 ? [accounts[0].id] : []));
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleOwnedChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], owned: val, bankTotal: undefined } }));
  };

  const handleParentalChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], parental: val, bankTotal: undefined } }));
  };

  const handleDepositsChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], deposits: val } }));
  };

  const handleDateChange = (id: string, val: string) => {
    setUpdates(prev => ({ ...prev, [id]: { ...prev[id], date: val } }));
  };

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
    const amount = safeNumber(a.amount, 0);
    if (amount <= 0) { setAdjustErrors(prev => ({ ...prev, [id]: 'Saisissez un montant supérieur à 0.' })); return; }
    const current = safeNumber(updates[id][a.target], 0);
    const next = Math.round((current + a.sign * amount) * 100) / 100;
    if (next < 0) {
      setAdjustErrors(prev => ({ ...prev, [id]: `Impossible : ${a.target === 'owned' ? 'votre part' : 'la part des parents'} deviendrait négative (${formatEUR(next)}).` }));
      return;
    }
    const account = accounts.find(acc => acc.id === id);
    const draft = updates[id];
    const deposits = parseDeposits(draft.deposits);
    const tracksCash = !!account && tracksDeposits(account.type) && typeof deposits === 'number' && a.isCash && a.target === 'owned';
    const valueBefore = safeNumber(draft.owned, 0) + safeNumber(draft.parental, 0);
    setUpdates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [a.target]: toInputAmount(next),
        ...(tracksCash ? {
          cashFlow: prev[id].cashFlow + a.sign * amount,
          deposits: toInputAmount(Math.round((a.sign > 0 ? deposits + amount : depositsAfterWithdrawal(deposits, valueBefore, amount)) * 100) / 100),
        } : {}),
      },
    }));
    patchAdjust(id, { amount: '' });
  };

  const soloMode = !accounts.some(a => a.parentalCapital > 0);

  const changedCount = accounts.filter(account => {
    const u = updates[account.id] ?? draftFrom(account);
    if (!u) return false;
    const deposits = parseDeposits(u.deposits);
    return Math.abs(safeNumber(u.owned, 0) - account.ownedAmount) > 0.004
      || Math.abs(safeNumber(u.parental, 0) - account.parentalCapital) > 0.004
      || (tracksDeposits(account.type) && deposits !== null && deposits !== account.totalDeposits);
  }).length;

  // Saisie directe du total affiché par la banque : la part propre en est déduite, le
  // capital parental (qui ne bouge pas) restant tel quel.
  const handleBankTotalChange = (id: string, val: string) => {
    setUpdates(prev => {
      const u = prev[id];
      const total = parseFrenchNumber(val);
      const parental = safeNumber(u.parental, 0);
      // Total inférieur à la part des parents : saisie incohérente, la part propre n'est
      // pas touchée (message sous le champ).
      const owned = total === null || total < parental ? u.owned : toInputAmount(Math.round((total - parental) * 100) / 100);
      return { ...prev, [id]: { ...u, bankTotal: val, owned } };
    });
  };

  const handleSaveAll = () => {
    const payloads = accounts.map(account => {
      const u = updates[account.id] ?? draftFrom(account);
      const newOwned = safeNumber(u.owned, 0);
      const newParental = safeNumber(u.parental, 0);
      const deposits = parseDeposits(u.deposits);
      const updatedAccount: SavingsAccount = {
        ...account,
        ownedAmount: newOwned,
        parentalCapital: newParental,
        totalAmount: newOwned + newParental,
        // Saisie illisible : on garde la valeur connue plutôt que de l'effacer.
        totalDeposits: tracksDeposits(account.type)
          ? (deposits === null ? account.totalDeposits : deposits !== undefined && deposits >= 0 ? deposits : undefined)
          : account.totalDeposits,
      };
      return { account: updatedAccount, date: u.date, cashFlow: u.cashFlow || undefined };
    });

    markPending();
    onUpdateAccountsComplex(payloads);
    // Brouillons remis à zéro : un second « Enregistrer » ne rejoue pas les versements
    // (le flux d'argent `cashFlow` aurait été compté deux fois).
    setUpdatesRaw(prev => Object.fromEntries(Object.entries(prev).map(([id, d]) => [id, { ...d, cashFlow: 0, touched: [] }])));
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

  const changedLabel = `${changedCount} compte${changedCount > 1 ? 's' : ''} modifié${changedCount > 1 ? 's' : ''}`;
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

      <Card padding="none" className="overflow-hidden">
        <ul className="divide-y divide-outline-variant" aria-label="Comptes à actualiser">
          {accounts.map(account => (
            <AccountUpdateRow
              key={account.id}
              account={account}
              draft={updates[account.id] ?? draftFrom(account)}
              adjust={adjustFor(account.id)}
              adjustError={adjustErrors[account.id]}
              soloMode={soloMode}
              today={today}
              expanded={expanded.has(account.id)}
              onToggle={() => toggle(account.id)}
              onOwnedChange={val => handleOwnedChange(account.id, val)}
              onParentalChange={val => handleParentalChange(account.id, val)}
              onBankTotalChange={val => handleBankTotalChange(account.id, val)}
              onDepositsChange={val => handleDepositsChange(account.id, val)}
              onDateChange={val => handleDateChange(account.id, val)}
              onPatchAdjust={patch => patchAdjust(account.id, patch)}
              onApplyAdjust={() => applyAdjust(account.id)}
            />
          ))}
        </ul>
      </Card>

      {changedCount > 0 && (
        <div className="fixed left-4 right-4 bottom-20 md:bottom-6 md:left-auto md:right-8 md:w-96 z-30 flex items-center justify-between gap-3 p-3 pl-5 rounded-2xl bg-inverse-surface text-inverse-on-surface shadow-lg">
          <span className="text-sm font-medium">{changedLabel}</span>
          <Button onClick={handleSaveAll} isLoading={saveStatus === 'pending'} className="bg-inverse-primary! text-indigo-900! hover:bg-indigo-200!">
            <Save className="w-4 h-4" aria-hidden="true" /> Enregistrer
          </Button>
        </div>
      )}
      {changedCount > 0 && <div className="h-24" aria-hidden />}
    </div>
  );
};
