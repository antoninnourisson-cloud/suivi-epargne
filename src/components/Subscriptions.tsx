// ================================================
// FILE: src/components/Subscriptions.tsx
// Abonnements prélevés sur un compte (texte libre, en général le compte courant). Ils ne
// touchent jamais aux soldes de l'app : ils servent aux rappels avant prélèvement
// (notification la veille sous 100 €, une semaine avant au-delà — voir findDueSubscriptions).
// ================================================
import React, { useMemo, useRef, useState } from 'react';
import { Subscription, SubscriptionFrequency } from '../types';
import { CalendarClock, Plus, Trash2, AlertCircle, Pause, Play, Pencil, X, ListChecks, Check } from 'lucide-react';
import { parseFrenchNumber } from '../lib/numbers';
import { formatISODay, localTodayISO, daysBetween } from '../lib/dates';
import { nextSubscriptionDate, subscriptionMonthlyCost, subscriptionLeadDays, SUBSCRIPTION_BIG_AMOUNT, isMonthlyCharge } from '../lib/finance';
import { isBackendEnabled } from '../services/backendService';
import { formatEUR, frenchDay } from '../lib/format';
import { useUndoableRemove } from './Toast';
import { focusAfterRemoval } from './focusAfterRemoval';
import { reviewSubscriptions } from '../lib/planning';
import { Button, Card, IconButton, ListItem, MoneyText, PageHeader, StatTile, TextField } from './ui';

interface SubscriptionsProps {
  subscriptions: Subscription[];
  onUpdate: React.Dispatch<React.SetStateAction<Subscription[]>>;
  monthlyPay?: number;
}

const fmt = (n: number) => formatEUR(n);
const frDate = (iso: string) => iso.split('-').reverse().join('/');
const NAME_FIELD_ID = 'subscription-name';

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
  const listRef = useRef<HTMLUListElement>(null);
  // Le focus va sur l'abonnement voisin, sinon sur le champ « Nom de l'abonnement » (WCAG 2.4.3).
  const remove = (id: string) => {
    const sub = subscriptions.find(s => s.id === id);
    if (!sub) return;
    removeWithUndo(subscriptions, sub, onUpdate, `Abonnement « ${sub.name} » supprimé`);
    if (editingId === id) cancelEdit();
    focusAfterRemoval(() => listRef.current, rows.findIndex(r => r.s.id === id), () => document.getElementById(NAME_FIELD_ID));
  };

  const when = (inDays: number) => inDays === 0 ? "aujourd'hui" : inDays === 1 ? 'demain' : `dans ${inDays} jours`;
  const parsedAmount = parseFrenchNumber(form.amount);

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <PageHeader
        title="Abonnements"
        subtitle={<>
          Rappel la veille du prélèvement, ou une semaine avant à partir de {fmt(SUBSCRIPTION_BIG_AMOUNT)}.
          {isBackendEnabled() ? ' Les notifications doivent être activées sur l\'appareil (Paramètres).' : ' Les rappels nécessitent le serveur de notifications.'}
          {' '}Vos soldes ne sont jamais modifiés.
        </>}
      />

      {active.length > 0 && (
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <StatTile label="Mensuels" value={<>{fmt(monthly)}<span className="text-base text-on-surface-variant"> /mois</span></>} hint="Comptés dans les charges fixes du Pilotage" />
            {occasionalPerYear > 0 && (
              <StatTile label="Annuels et autres" value={<>{fmt(occasionalPerYear)}<span className="text-base text-on-surface-variant"> /an</span></>} hint="Payés à l'échéance, rappel avant" />
            )}
            <StatTile label="Total sur un an" value={fmt(monthly * 12 + occasionalPerYear)} />
          </div>
        </Card>
      )}

      {rows.length > 0 && (
        <Card padding="none" title="Vos abonnements" icon={CalendarClock} className="pb-1">
          <ul ref={listRef} className="divide-y divide-outline-variant">
            {rows.map(({ s, next, inDays }) => (
              <ListItem
                key={s.id}
                className="px-4 sm:px-6"
                headline={<>{s.name}{!s.active && <span className="ml-2 inline-flex items-center h-6 px-2 rounded-sm text-xs font-medium bg-surface-container-highest text-on-surface-variant align-middle">En pause</span>}</>}
                supporting={<>
                  {FREQUENCY_LABEL[s.frequency]}
                  {s.debitAccount && <> · {s.debitAccount}</>}
                  {s.active && <> · prochain le <span className="whitespace-nowrap">{frenchDay(next)}</span> ({when(inDays)}) · rappel {subscriptionLeadDays(s.amount) === 1 ? 'la veille' : '7 jours avant'}</>}
                </>}
                trailing={<MoneyText value={-s.amount} signed tone={s.active ? 'auto' : 'neutral'} className={s.active ? '' : 'text-on-surface-variant'} />}
                actions={<>
                  <IconButton icon={Pencil} label={`Modifier ${s.name}`} onClick={() => edit(s)} data-focus-after-removal />
                  <IconButton icon={s.active ? Pause : Play} label={s.active ? `Mettre en pause ${s.name}` : `Réactiver ${s.name}`} onClick={() => toggle(s.id)} />
                  <IconButton icon={Trash2} tone="danger" label={`Supprimer ${s.name}`} onClick={() => remove(s.id)} />
                </>}
              />
            ))}
          </ul>
        </Card>
      )}

      {review.length > 0 && (
        <Card title="Revue des abonnements" icon={ListChecks}>
          <p className="-mt-2 text-sm text-on-surface-variant">Du plus cher au moins cher sur un an. Tous les six mois, confirmez ceux qui vous servent encore.</p>
          <ul className="mt-3 divide-y divide-outline-variant">
            {review.map(r => (
              <ListItem
                key={r.sub.id}
                headline={<>{r.sub.name} · <span className="whitespace-nowrap">{fmt(r.yearly)} par an</span>{r.shareOfPay !== undefined && <span className="font-normal text-on-surface-variant"> ({r.shareOfPay.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}{' '}% de la paie)</span>}</>}
                supporting={(r.priceIncrease || r.cancelBy) ? <>
                  {r.priceIncrease && <span className="block font-medium text-error">Hausse : {fmt(r.priceIncrease.from)} → {fmt(r.priceIncrease.to)} depuis le {frDate(r.priceIncrease.date)}</span>}
                  {r.cancelBy && <span className="block">Pour ne pas renouveler : résiliez avant le <b className="font-medium text-on-surface">{frDate(r.cancelBy)}</b>.</span>}
                </> : undefined}
                trailing={r.reviewDue ? undefined : <span className="inline-flex items-center gap-1 text-xs font-medium text-primary"><Check className="w-4 h-4" aria-hidden="true" /> Vérifié</span>}
                actions={r.reviewDue ? (
                  <Button variant="tonal" className="max-sm:h-12" onClick={() => onUpdate(subscriptions.map(x => x.id === r.sub.id ? { ...x, reviewedAt: localTodayISO() } : x))}>Toujours utile</Button>
                ) : undefined}
              />
            ))}
          </ul>
        </Card>
      )}

      <Card
        title={editingId ? 'Modifier l\'abonnement' : 'Nouvel abonnement'}
        action={editingId ? <Button variant="text" className="max-sm:h-12" onClick={cancelEdit}><X className="w-4 h-4" aria-hidden="true" /> Annuler</Button> : undefined}
      >
        <form onSubmit={submit} className="space-y-4">
          <TextField id={NAME_FIELD_ID} label="Nom de l'abonnement" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Netflix, assurance auto…" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField label="Montant" suffix="€" inputMode="decimal" value={form.amount} onChange={e => set({ amount: e.target.value })} placeholder="0,00" />
            <TextField
              label="Régularité"
              render={p => (
                <select id={p.id} className={p.className} value={form.frequency} onChange={e => set({ frequency: e.target.value as SubscriptionFrequency })}>
                  {(Object.keys(FREQUENCY_LABEL) as SubscriptionFrequency[]).map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
                </select>
              )}
            />
            <TextField
              label="Date d'un prélèvement" type="date" value={form.anchorDate} onChange={e => set({ anchorDate: e.target.value })}
              supporting={form.anchorDate && parsedAmount !== null
                ? `Prochain prélèvement : ${frDate(formatISODay(nextSubscriptionDate({ frequency: form.frequency, anchorDate: form.anchorDate }, today)))}`
                : undefined}
            />
            <TextField label="Compte prélevé" list="subscription-accounts" value={form.debitAccount} onChange={e => set({ debitAccount: e.target.value })} placeholder="Ex : compte courant BP" />
            <datalist id="subscription-accounts">{knownAccounts.map(a => <option key={a} value={a} />)}</datalist>
          </div>
          {!isMonthlyCharge({ frequency: form.frequency }) && (
            <TextField label="Préavis de résiliation (jours, facultatif)" inputMode="numeric" value={form.noticeDays} onChange={e => set({ noticeDays: e.target.value })} placeholder="30" />
          )}
          {error && (
            <p role="alert" className="text-sm font-medium text-error flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> {error}</p>
          )}
          <Button type="submit" className="w-full h-12!">
            <Plus className="w-4 h-4" aria-hidden="true" /> {editingId ? 'Enregistrer' : 'Ajouter l\'abonnement'}
          </Button>
        </form>
      </Card>
    </div>
  );
};
