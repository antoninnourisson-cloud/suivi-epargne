// ================================================
// FILE: src/components/Subscriptions.tsx
// Abonnements prélevés sur un compte (texte libre, en général le compte courant). Ils ne
// touchent jamais aux soldes de l'app : ils servent aux rappels avant prélèvement
// (notification la veille sous 100 €, une semaine avant au-delà — voir findDueSubscriptions).
// ================================================
import React, { useMemo, useState } from 'react';
import { Subscription, SubscriptionFrequency } from '../types';
import { CalendarClock, Plus, Trash2, AlertCircle, Pause, Play, Pencil, X, BellRing, ListChecks } from 'lucide-react';
import { parseFrenchNumber } from '../lib/numbers';
import { formatISODay, localTodayISO, daysBetween } from '../lib/dates';
import { nextSubscriptionDate, subscriptionMonthlyCost, subscriptionLeadDays, SUBSCRIPTION_BIG_AMOUNT, isMonthlyCharge } from '../lib/finance';
import { isBackendEnabled } from '../services/backendService';
import { formatEUR } from '../lib/format';
import { useUndoableRemove } from './Toast';
import { reviewSubscriptions } from '../lib/planning';
import { frenchDay } from '../lib/format';

interface SubscriptionsProps {
  subscriptions: Subscription[];
  onUpdate: React.Dispatch<React.SetStateAction<Subscription[]>>;
  monthlyPay?: number;
}

const fmt = (n: number) => formatEUR(n);

const FREQUENCY_LABEL: Record<SubscriptionFrequency, string> = {
  weekly: 'Hebdomadaire',
  monthly: 'Mensuel',
  quarterly: 'Trimestriel',
  semiannual: 'Semestriel',
  yearly: 'Annuel',
};

const EMPTY = { name: '', amount: '', debitAccount: '', frequency: 'monthly' as SubscriptionFrequency, anchorDate: localTodayISO(), noticeDays: '' };

export const Subscriptions: React.FC<SubscriptionsProps> = ({ subscriptions, onUpdate, monthlyPay = 0 }) => {
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const rows = useMemo(() =>
    subscriptions
      .map(s => {
        const next = nextSubscriptionDate(s, today);
        return { s, next, inDays: daysBetween(today, next) };
      })
      .sort((a, b) => Number(b.s.active) - Number(a.s.active) || a.next.getTime() - b.next.getTime()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscriptions]);

  const active = subscriptions.filter(s => s.active);
  const review = useMemo(() => reviewSubscriptions(subscriptions, monthlyPay), [subscriptions, monthlyPay]);
  // Même règle que le Pilotage : seuls les mensuels (et hebdomadaires) pèsent chaque mois ;
  // les autres sont payés quand ils tombent.
  const monthly = active.filter(isMonthlyCharge).reduce((sum, s) => sum + subscriptionMonthlyCost(s), 0);
  const occasionalPerYear = active.filter(s => !isMonthlyCharge(s)).reduce((sum, s) => sum + subscriptionMonthlyCost(s) * 12, 0);
  // Comptes déjà saisis, proposés à la saisie pour éviter « BP » / « Banque Pop » / « bp ».
  const knownAccounts = Array.from(new Set(subscriptions.map(s => s.debitAccount).filter(Boolean)));

  const set = (patch: Partial<typeof EMPTY>) => { setForm(f => ({ ...f, ...patch })); setError(null); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { setError('Donnez un nom à l\'abonnement.'); return; }
    const amount = parseFrenchNumber(form.amount);
    if (amount === null || amount <= 0) { setError('Saisissez un montant supérieur à 0.'); return; }
    if (!form.anchorDate) { setError('Indiquez la date d\'un prélèvement.'); return; }
    const notice = parseFrenchNumber(form.noticeDays);
    const entry: Omit<Subscription, 'id' | 'active'> = {
      name, amount, debitAccount: form.debitAccount.trim(), frequency: form.frequency, anchorDate: form.anchorDate,
      noticeDays: !isMonthlyCharge({ frequency: form.frequency }) && notice !== null && notice > 0 ? Math.round(notice) : undefined,
    };
    if (editingId) {
      // Prix changé : l'ancien est gardé (repère les hausses dans la revue).
      onUpdate(subscriptions.map(s => s.id === editingId ? {
        ...s, ...entry,
        priceHistory: Math.abs(s.amount - amount) > 0.004 ? [...(s.priceHistory || []), { date: localTodayISO(), amount: s.amount }] : s.priceHistory,
      } : s));
    } else {
      onUpdate([...subscriptions, { ...entry, id: crypto.randomUUID(), active: true }]);
    }
    setForm({ ...EMPTY, debitAccount: form.debitAccount });
    setEditingId(null);
  };

  const edit = (s: Subscription) => {
    setEditingId(s.id);
    setForm({ name: s.name, amount: String(s.amount), debitAccount: s.debitAccount, frequency: s.frequency, anchorDate: s.anchorDate, noticeDays: s.noticeDays ? String(s.noticeDays) : '' });
    setError(null);
  };
  const cancelEdit = () => { setEditingId(null); setForm(EMPTY); setError(null); };
  const toggle = (id: string) => onUpdate(subscriptions.map(s => s.id === id ? { ...s, active: !s.active } : s));
  const removeWithUndo = useUndoableRemove();
  const remove = (id: string) => {
    const sub = subscriptions.find(s => s.id === id);
    if (!sub) return;
    removeWithUndo(subscriptions, sub, onUpdate, `Abonnement « ${sub.name} » supprimé`);
    if (editingId === id) cancelEdit();
  };

  const inputClass = 'w-full p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg font-bold';
  const when = (inDays: number) => inDays === 0 ? "aujourd'hui" : inDays === 1 ? 'demain' : `dans ${inDays} jours`;

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><CalendarClock className="w-6 h-6 text-indigo-600" /> Abonnements</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
          <BellRing className="w-4 h-4 shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400" />
          <span>
            Rappel la veille du prélèvement, ou une semaine avant à partir de {fmt(SUBSCRIPTION_BIG_AMOUNT)}.
            {isBackendEnabled() ? ' Les notifications doivent être activées sur l\'appareil (Paramètres).' : ' Les rappels nécessitent le serveur de notifications.'}
            {' '}Vos soldes ne sont jamais modifiés.
          </span>
        </p>
        {active.length > 0 && (
          <div className="flex flex-wrap gap-6 mt-4">
            <div>
              <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Mensuels</p>
              <p className="text-xl font-black text-slate-800 dark:text-slate-100">{fmt(monthly)}<span className="text-sm font-bold text-slate-500 dark:text-slate-400"> /mois</span></p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">comptés dans les charges fixes du Pilotage</p>
            </div>
            {occasionalPerYear > 0 && (
              <div>
                <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Annuels et autres</p>
                <p className="text-xl font-black text-slate-800 dark:text-slate-100">{fmt(occasionalPerYear)}<span className="text-sm font-bold text-slate-500 dark:text-slate-400"> /an</span></p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">payés à l'échéance, rappel avant</p>
              </div>
            )}
            <div>
              <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Total sur un an</p>
              <p className="text-xl font-black text-slate-800 dark:text-slate-100">{fmt(monthly * 12 + occasionalPerYear)}</p>
            </div>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map(({ s, next, inDays }) => (
            <li key={s.id} className={`flex items-center gap-3 p-3 rounded-xl border bg-white dark:bg-slate-800 ${s.active ? 'border-slate-200 dark:border-slate-700' : 'border-dashed border-slate-300 dark:border-slate-700 opacity-60'}`}>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">
                  {s.name} · <span className="text-rose-700">{fmt(s.amount)}</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                  {FREQUENCY_LABEL[s.frequency]}
                  {s.debitAccount && <> · {s.debitAccount}</>}
                  {s.active
                    ? <> · prochain le {frenchDay(next)} ({when(inDays)}) · rappel {subscriptionLeadDays(s.amount) === 1 ? 'la veille' : '7 jours avant'}</>
                    : ' · en pause'}
                </p>
              </div>
              <button type="button" onClick={() => edit(s)} aria-label={`Modifier ${s.name}`} className="p-2.5 text-slate-500 dark:text-slate-400 hover:text-indigo-600 rounded-lg"><Pencil className="w-4 h-4" /></button>
              <button type="button" onClick={() => toggle(s.id)} aria-label={s.active ? 'Mettre en pause' : 'Réactiver'} className="p-2.5 text-slate-500 dark:text-slate-400 hover:text-indigo-600 rounded-lg">
                {s.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button type="button" onClick={() => remove(s.id)} aria-label={`Supprimer ${s.name}`} className="p-2.5 text-slate-500 dark:text-slate-400 hover:text-rose-500 rounded-lg"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}

      {review.length > 0 && (
        <section aria-labelledby="subs-review-title" className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
          <h3 id="subs-review-title" className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><ListChecks className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Revue des abonnements</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">Du plus cher au moins cher sur un an. Tous les six mois, confirmez ceux qui vous servent encore.</p>
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
            {review.map(r => (
              <li key={r.sub.id} className="py-2.5 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-48">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{r.sub.name} · {fmt(r.yearly)} par an{r.shareOfPay !== undefined && <span className="font-normal text-slate-600 dark:text-slate-300"> ({r.shareOfPay.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % de la paie)</span>}</p>
                  {r.priceIncrease && <p className="text-xs font-bold text-rose-700 dark:text-rose-300">Hausse : {fmt(r.priceIncrease.from)} → {fmt(r.priceIncrease.to)} depuis le {r.priceIncrease.date.split('-').reverse().join('/')}</p>}
                  {r.cancelBy && <p className="text-xs text-slate-600 dark:text-slate-300">Pour ne pas renouveler : résiliez avant le <b>{r.cancelBy.split('-').reverse().join('/')}</b>.</p>}
                </div>
                {r.reviewDue
                  ? <button type="button" onClick={() => onUpdate(subscriptions.map(x => x.id === r.sub.id ? { ...x, reviewedAt: localTodayISO() } : x))} className="text-xs font-black px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">Toujours utile</button>
                  : <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Vérifié</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={submit} className="space-y-3 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">{editingId ? 'Modifier l\'abonnement' : 'Nouvel abonnement'}</p>
          {editingId && <button type="button" onClick={cancelEdit} className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"><X className="w-3 h-3" /> Annuler</button>}
        </div>
        <input type="text" aria-label="Nom de l'abonnement" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Netflix, assurance auto…" className={inputClass} />
        <div className="grid grid-cols-2 gap-2">
          <input type="text" inputMode="decimal" aria-label="Montant en euros" value={form.amount} onChange={e => set({ amount: e.target.value })} placeholder="Montant (€)" className={inputClass} />
          <select value={form.frequency} onChange={e => set({ frequency: e.target.value as SubscriptionFrequency })} className={inputClass} aria-label="Régularité">
            {(Object.keys(FREQUENCY_LABEL) as SubscriptionFrequency[]).map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Date d'un prélèvement</span>
            <input type="date" value={form.anchorDate} onChange={e => set({ anchorDate: e.target.value })} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Compte prélevé</span>
            <input type="text" list="subscription-accounts" value={form.debitAccount} onChange={e => set({ debitAccount: e.target.value })} placeholder="Ex : compte courant BP" className={inputClass} />
            <datalist id="subscription-accounts">{knownAccounts.map(a => <option key={a} value={a} />)}</datalist>
          </label>
        </div>
        {!isMonthlyCharge({ frequency: form.frequency }) && (
          <label className="block">
            <span className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase">Préavis de résiliation (jours, facultatif)</span>
            <input type="text" inputMode="numeric" value={form.noticeDays} onChange={e => set({ noticeDays: e.target.value })} placeholder="30" className={inputClass} />
          </label>
        )}
        {form.anchorDate && parseFrenchNumber(form.amount) !== null && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Prochain prélèvement : {formatISODay(nextSubscriptionDate({ frequency: form.frequency, anchorDate: form.anchorDate }, today)).split('-').reverse().join('/')}
          </p>
        )}
        {error && (
          <p className="text-sm font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</p>
        )}
        <button type="submit" className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> {editingId ? 'Enregistrer' : 'Ajouter l\'abonnement'}
        </button>
      </form>
    </div>
  );
};
