// ================================================
// FILE: src/components/Subscriptions.tsx
// Abonnements prélevés sur un compte (texte libre, en général le compte courant). Ils ne
// touchent jamais aux soldes de l'app : ils servent aux rappels avant prélèvement
// (notification la veille sous 100 €, une semaine avant au-delà — voir findDueSubscriptions).
// ================================================
import React, { useMemo, useState } from 'react';
import { Subscription, SubscriptionFrequency } from '../types';
import { CalendarClock, Plus, Trash2, AlertCircle, Pause, Play, Pencil, X, BellRing } from 'lucide-react';
import { parseFrenchNumber } from '../lib/numbers';
import { formatISODay, localTodayISO, daysBetween } from '../lib/dates';
import { nextSubscriptionDate, subscriptionMonthlyCost, subscriptionLeadDays, SUBSCRIPTION_BIG_AMOUNT } from '../lib/finance';
import { isBackendEnabled } from '../services/backendService';

interface SubscriptionsProps {
  subscriptions: Subscription[];
  onUpdate: (next: Subscription[]) => void;
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);

const FREQUENCY_LABEL: Record<SubscriptionFrequency, string> = {
  weekly: 'Hebdomadaire',
  monthly: 'Mensuel',
  quarterly: 'Trimestriel',
  semiannual: 'Semestriel',
  yearly: 'Annuel',
};

const EMPTY = { name: '', amount: '', debitAccount: '', frequency: 'monthly' as SubscriptionFrequency, anchorDate: localTodayISO() };

export const Subscriptions: React.FC<SubscriptionsProps> = ({ subscriptions, onUpdate }) => {
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
  const monthly = active.reduce((sum, s) => sum + subscriptionMonthlyCost(s), 0);
  // Comptes déjà saisis, proposés à la saisie pour éviter « BP » / « Banque Pop » / « bp ».
  const knownAccounts = Array.from(new Set(subscriptions.map(s => s.debitAccount).filter(Boolean)));

  const set = (patch: Partial<typeof EMPTY>) => { setForm(f => ({ ...f, ...patch })); setError(null); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { setError('Donne un nom à l\'abonnement.'); return; }
    const amount = parseFrenchNumber(form.amount);
    if (amount === null || amount <= 0) { setError('Saisis un montant supérieur à 0.'); return; }
    if (!form.anchorDate) { setError('Indique la date d\'un prélèvement.'); return; }
    const entry: Omit<Subscription, 'id' | 'active'> = {
      name, amount, debitAccount: form.debitAccount.trim(), frequency: form.frequency, anchorDate: form.anchorDate,
    };
    if (editingId) {
      onUpdate(subscriptions.map(s => s.id === editingId ? { ...s, ...entry } : s));
    } else {
      onUpdate([...subscriptions, { ...entry, id: crypto.randomUUID(), active: true }]);
    }
    setForm({ ...EMPTY, debitAccount: form.debitAccount });
    setEditingId(null);
  };

  const edit = (s: Subscription) => {
    setEditingId(s.id);
    setForm({ name: s.name, amount: String(s.amount), debitAccount: s.debitAccount, frequency: s.frequency, anchorDate: s.anchorDate });
    setError(null);
  };
  const cancelEdit = () => { setEditingId(null); setForm(EMPTY); setError(null); };
  const toggle = (id: string) => onUpdate(subscriptions.map(s => s.id === id ? { ...s, active: !s.active } : s));
  const remove = (id: string) => { onUpdate(subscriptions.filter(s => s.id !== id)); if (editingId === id) cancelEdit(); };

  const inputClass = 'w-full p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg font-bold';
  const when = (inDays: number) => inDays === 0 ? "aujourd'hui" : inDays === 1 ? 'demain' : `dans ${inDays} jours`;

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><CalendarClock className="w-6 h-6 text-indigo-600" /> Abonnements</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
          <BellRing className="w-4 h-4 flex-shrink-0 mt-0.5 text-indigo-500" />
          <span>
            Rappel la veille du prélèvement, ou une semaine avant à partir de {fmt(SUBSCRIPTION_BIG_AMOUNT)}.
            {isBackendEnabled() ? ' Les notifications doivent être activées sur l\'appareil (Paramètres).' : ' Les rappels nécessitent le serveur de notifications.'}
            {' '}Tes soldes ne sont jamais modifiés.
          </span>
        </p>
        {active.length > 0 && (
          <div className="flex flex-wrap gap-6 mt-4">
            <div>
              <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Par mois</p>
              <p className="text-xl font-black text-slate-800 dark:text-slate-100">{fmt(monthly)}</p>
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Par an</p>
              <p className="text-xl font-black text-slate-800 dark:text-slate-100">{fmt(monthly * 12)}</p>
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
                  {s.name} · <span className="text-rose-600">{fmt(s.amount)}</span>
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 font-bold">
                  {FREQUENCY_LABEL[s.frequency]}
                  {s.debitAccount && <> · {s.debitAccount}</>}
                  {s.active
                    ? <> · prochain le {next.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} ({when(inDays)}) · rappel {subscriptionLeadDays(s.amount) === 1 ? 'la veille' : '7 jours avant'}</>
                    : ' · en pause'}
                </p>
              </div>
              <button type="button" onClick={() => edit(s)} aria-label={`Modifier ${s.name}`} className="p-2.5 text-slate-400 hover:text-indigo-600 rounded-lg"><Pencil className="w-4 h-4" /></button>
              <button type="button" onClick={() => toggle(s.id)} aria-label={s.active ? 'Mettre en pause' : 'Réactiver'} className="p-2.5 text-slate-400 hover:text-indigo-600 rounded-lg">
                {s.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button type="button" onClick={() => remove(s.id)} aria-label={`Supprimer ${s.name}`} className="p-2.5 text-slate-400 hover:text-rose-500 rounded-lg"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-3 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">{editingId ? 'Modifier l\'abonnement' : 'Nouvel abonnement'}</p>
          {editingId && <button type="button" onClick={cancelEdit} className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"><X className="w-3 h-3" /> Annuler</button>}
        </div>
        <input type="text" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Nom (ex : Netflix, assurance auto)" className={inputClass} />
        <div className="grid grid-cols-2 gap-2">
          <input type="text" inputMode="decimal" value={form.amount} onChange={e => set({ amount: e.target.value })} placeholder="Montant (€)" className={inputClass} />
          <select value={form.frequency} onChange={e => set({ frequency: e.target.value as SubscriptionFrequency })} className={inputClass} aria-label="Régularité">
            {(Object.keys(FREQUENCY_LABEL) as SubscriptionFrequency[]).map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Date d'un prélèvement</span>
            <input type="date" value={form.anchorDate} onChange={e => set({ anchorDate: e.target.value })} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase">Compte prélevé</span>
            <input type="text" list="subscription-accounts" value={form.debitAccount} onChange={e => set({ debitAccount: e.target.value })} placeholder="Ex : compte courant BP" className={inputClass} />
            <datalist id="subscription-accounts">{knownAccounts.map(a => <option key={a} value={a} />)}</datalist>
          </label>
        </div>
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
