// ================================================
// FILE: src/components/Journal.tsx
// Journal des modifications : tous les mouvements (votre part, part des parents,
// valorisations, soldes initiaux), changements de taux et restitution, du plus récent au
// plus ancien. Un mouvement se supprime (avec annulation), le dernier changement de taux
// d'un compte s'annule.
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount, ParentalRestitution } from '../types';
import { formatEUR, formatRate } from '../lib/format';
import { parseISODate, formatISODay as formatISODayLocal } from '../lib/dates';
import { ChevronDown, History, Trash2, Undo2 } from 'lucide-react';
import { isRestitutionMovement, findCancellingGroups, CancellingGroup } from '../lib/accountOps';
import { isInitialBalance } from '../lib/finance';
import { signedAmount } from '../lib/money';
import { hasParentalHistory } from '../lib/parentalMode';
import { Button, Card, Chip, EmptyState, IconButton, ListItem, MoneyText, PageHeader, TextField } from './ui';

type Filter = 'all' | 'own' | 'parental' | 'valuation' | 'rates';

interface Entry {
  key: string;
  date: string;
  account?: SavingsAccount;
  kind: 'own' | 'parental' | 'valuation' | 'initial' | 'rate' | 'restitution' | 'adjustment';
  title: string;
  amount?: number; // signé
  movementId?: string;
  rateEntryDate?: string;
  canRevertRate?: boolean;
}

interface Props {
  accounts: SavingsAccount[];
  restitution?: ParentalRestitution;
  onDeleteMovement: (accountId: string, movementId: string) => void;
  onRevertRate: (accountId: string, entryDate: string) => void;
  onRemoveCancelling: (groups: CancellingGroup[]) => void;
  trackingStartDate?: string;
  onSetTrackingStart: (date: string | undefined) => void;
  onToggleAdjustment: (accountId: string, movementId: string) => void;
}

// Pastilles de nature : parents en « tertiary » (ocre), comme sur l'Accueil et le Pilotage.
const BADGE: Record<Entry['kind'], { label: string; cls: string }> = {
  own: { label: 'Votre part', cls: 'bg-secondary-container text-on-secondary-container' },
  parental: { label: 'Parents', cls: 'bg-tertiary-container text-on-tertiary-container' },
  valuation: { label: 'Valorisation', cls: 'border border-outline-variant text-on-surface-variant' },
  adjustment: { label: "Correction (pas de l'épargne)", cls: 'bg-surface-container-highest text-on-surface-variant' },
  initial: { label: 'Solde initial', cls: 'bg-surface-container-highest text-on-surface-variant' },
  rate: { label: 'Taux', cls: 'border border-outline-variant text-on-surface-variant' },
  restitution: { label: 'Restitution', cls: 'bg-tertiary-container text-on-tertiary-container' },
};

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'own', label: 'Votre part' },
  { value: 'parental', label: 'Parents' },
  { value: 'valuation', label: 'Valorisation' },
  { value: 'rates', label: 'Taux' },
];

/** Puces de 32 px, mais zone tactile de 48 px (Material 3) ; rangées espacées d'autant. */
const CHIP_TARGET = 'relative after:absolute after:inset-x-0 after:-inset-y-2';

const DAY = new Intl.DateTimeFormat('fr-FR');
const day = (iso: string) => DAY.format(parseISODate(iso));

const PAGE = 150;

export const Journal: React.FC<Props> = ({ accounts, restitution, onDeleteMovement, onRevertRate, onRemoveCancelling, trackingStartDate, onSetTrackingStart, onToggleAdjustment }) => {
  // Les parents n'apparaissent (filtre, sous-titre) que s'ils ont compté : capital, mouvements ou restitution.
  const withParents = useMemo(() => hasParentalHistory(accounts, restitution), [accounts, restitution]);
  const [filter, setFilter] = useState<Filter>('all');
  const [accountId, setAccountId] = useState<string>('');
  const [limit, setLimit] = useState(PAGE);
  const [showCleanup, setShowCleanup] = useState(false);
  const [trackingDraft, setTrackingDraft] = useState(() => trackingStartDate || formatISODayLocal(new Date()));
  // Date changée ailleurs (« Annuler » du message, autre appareil) : le champ la reprend.
  const [shownStart, setShownStart] = useState(trackingStartDate);
  if (shownStart !== trackingStartDate) {
    setShownStart(trackingStartDate);
    setTrackingDraft(trackingStartDate || formatISODayLocal(new Date()));
  }
  const cancelling = useMemo(() => findCancellingGroups(accounts), [accounts]);
  const cancellingCount = cancelling.reduce((n, g) => n + g.movements.length, 0);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const a of accounts) {
      for (const m of a.movements) {
        const kind: Entry['kind'] = m.kind === 'parental' ? 'parental' : m.kind === 'valuation' ? 'valuation' : m.kind === 'adjustment' ? 'adjustment' : isInitialBalance(m) ? 'initial' : 'own';
        // Les mouvements de restitution s'annulent depuis Part parentale (sinon le relevé
        // de restitution resterait affiché alors que le capital serait rétabli).
        const isRestitution = isRestitutionMovement(m);
        out.push({ key: `m-${a.id}-${m.id}`, date: m.date, account: a, kind, title: m.label, amount: signedAmount(m), movementId: isRestitution ? undefined : m.id });
      }
      // Historique des taux : une entrée { date, rate } = « rate » courait jusqu'à « date ».
      const hist = [...(a.rateHistory || [])].sort((x, y) => x.date.localeCompare(y.date));
      hist.forEach((h, i) => {
        const next = i + 1 < hist.length ? hist[i + 1].rate : a.interestRate ?? 0;
        out.push({
          key: `r-${a.id}-${h.date}`, date: h.date, account: a, kind: 'rate',
          title: `Taux : ${formatRate(h.rate)} → ${formatRate(next)}`,
          rateEntryDate: h.date, canRevertRate: i === hist.length - 1,
        });
      });
    }
    if (restitution?.done) {
      const total = restitution.done.accounts.reduce((s, x) => s + x.amount, 0);
      out.push({ key: 'restitution', date: restitution.done.date, kind: 'restitution', title: 'Restitution du capital de vos parents', amount: -total });
    }
    return out.sort((x, y) => y.date.localeCompare(x.date) || x.key.localeCompare(y.key));
  }, [accounts, restitution]);

  const shown = entries.filter(e =>
    (!accountId || e.account?.id === accountId) &&
    (filter === 'all'
      || (filter === 'own' && (e.kind === 'own' || e.kind === 'initial' || e.kind === 'adjustment'))
      || (filter === 'parental' && (e.kind === 'parental' || e.kind === 'restitution'))
      || (filter === 'valuation' && e.kind === 'valuation')
      || (filter === 'rates' && e.kind === 'rate')));

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <PageHeader
        title="Journal"
        subtitle={`Tout ce qui a changé sur vos comptes : versements et retraits, ${withParents ? 'part des parents, ' : ''}variations de valeur, taux. Chaque mouvement peut être supprimé, avec annulation possible.`}
      />

      <details className="group rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-surface-container-low" open={!!trackingStartDate}>
        <summary className="list-none cursor-pointer min-h-12 px-4 py-3 flex items-center justify-between gap-3 text-sm font-medium text-on-surface [&::-webkit-details-marker]:hidden">
          {trackingStartDate ? `Suivi de l'épargne reparti du ${day(trackingStartDate)}` : "Repartir de zéro pour le suivi de l'épargne"}
          <ChevronDown className="w-5 h-5 shrink-0 text-on-surface-variant transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="px-4 pb-4 space-y-3 text-sm text-on-surface-variant">
          <p>Seuls les mouvements à partir de cette date comptent dans « Placé depuis la paie », le taux d'épargne et les bilans. Vos soldes, leur historique et les intérêts ne changent pas, et rien n'est effacé.</p>
          <div className="flex flex-wrap items-end gap-3">
            <TextField label="Point de départ du suivi" type="date" value={trackingDraft} onChange={e => setTrackingDraft(e.target.value)} className="w-full sm:w-60" />
            <Button variant="tonal" className="max-sm:h-12" onClick={() => { if (trackingDraft) onSetTrackingStart(trackingDraft); }}>
              {trackingStartDate ? 'Changer la date' : 'Repartir de cette date'}
            </Button>
            {trackingStartDate && <Button variant="text" className="max-sm:h-12" onClick={() => onSetTrackingStart(undefined)}>Retirer le point de départ</Button>}
          </div>
          <p className="text-xs">Pour un seul mouvement qui n'était pas de l'épargne (correction, intérêts, argent en transit), utilisez plutôt « Pas de l'épargne » sur sa ligne.</p>
        </div>
      </details>

      {cancellingCount > 0 && (
        <section className="p-4 rounded-2xl bg-tertiary-container text-on-tertiary-container space-y-3">
          <p className="text-sm font-medium">
            {cancellingCount} mouvements s'annulent entre eux (même compte, même jour) : sans effet sur vos soldes, sans doute des tests.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outlined" className="max-sm:h-12" aria-expanded={showCleanup} onClick={() => setShowCleanup(v => !v)}>{showCleanup ? 'Masquer' : 'Voir'}</Button>
            <Button variant="filled" className="max-sm:h-12" onClick={() => onRemoveCancelling(cancelling)}>Les supprimer</Button>
          </div>
          {showCleanup && (
            <ul className="text-sm space-y-1">
              {cancelling.map(g => (
                <li key={g.accountId + g.date}>
                  <b className="font-medium">{day(g.date)} · {g.accountName}</b> : {g.movements.map(m => `${m.label} (${m.type === 'IN' ? '+' : '−'}${formatEUR(m.amount)})`).join(', ')}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div role="group" aria-label="Filtrer par type" className="flex flex-wrap gap-x-2 gap-y-4 py-2">
          {FILTERS.filter(f => withParents || f.value !== 'parental').map(f => (
            <Chip key={f.value} selected={filter === f.value} className={CHIP_TARGET} onClick={() => { setFilter(f.value); setLimit(PAGE); }}>{f.label}</Chip>
          ))}
        </div>
        <TextField
          label="Compte" className="w-full sm:w-64"
          render={p => (
            <select id={p.id} className={p.className} value={accountId} onChange={e => { setAccountId(e.target.value); setLimit(PAGE); }}>
              <option value="">Tous les comptes</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        />
      </div>
      <p className="text-sm text-on-surface-variant" aria-live="polite">{shown.length} entrée{shown.length > 1 ? 's' : ''}</p>

      <Card padding="none">
        {shown.length === 0 ? (
          <EmptyState icon={History} title="Rien à afficher">
            {entries.length === 0 ? 'Vos mouvements apparaîtront ici dès le premier dépôt.' : 'Aucune entrée ne correspond à ces filtres.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {shown.slice(0, limit).map(e => {
              const acc = e.account;
              const canToggle = !!(e.movementId && acc && (e.kind === 'own' || e.kind === 'adjustment'));
              const canDelete = !!(e.movementId && acc);
              const canRevert = e.kind === 'rate' && !!e.canRevertRate && !!acc;
              return (
                <ListItem
                  key={e.key}
                  className="px-4 sm:px-6"
                  headline={e.title}
                  supporting={
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <time dateTime={e.date}>{day(e.date)}</time>
                      <span className={`inline-flex items-center h-6 px-2 rounded-sm text-xs font-medium ${BADGE[e.kind].cls}`}>{BADGE[e.kind].label}</span>
                      {acc && <span>{acc.name}</span>}
                    </span>
                  }
                  trailing={e.amount !== undefined ? <MoneyText value={e.amount} signed tone="auto" /> : undefined}
                  actions={(canToggle || canDelete || canRevert) ? <>
                    {canToggle && (
                      <Button variant="text" className="max-sm:h-12 px-3! text-on-surface-variant!" onClick={() => onToggleAdjustment(acc!.id, e.movementId!)}
                        title={e.kind === 'adjustment' ? "Compter de nouveau comme de l'épargne" : "Ce n'est pas de l'épargne (correction) : reste dans les soldes, sort de « Placé » et des bilans"}>
                        {e.kind === 'adjustment' ? 'Compter comme épargne' : "Pas de l'épargne"}
                      </Button>
                    )}
                    {canDelete && <IconButton icon={Trash2} tone="danger" label={`Supprimer « ${e.title} »`} onClick={() => onDeleteMovement(acc!.id, e.movementId!)} />}
                    {canRevert && <IconButton icon={Undo2} label="Annuler ce changement de taux" title="Revenir au taux précédent" onClick={() => onRevertRate(acc!.id, e.rateEntryDate!)} />}
                  </> : undefined}
                />
              );
            })}
          </ul>
        )}
      </Card>
      {shown.length > limit && (
        <Button variant="outlined" className="w-full max-sm:h-12" onClick={() => setLimit(l => l + PAGE)}>Afficher plus ({shown.length - limit} restantes)</Button>
      )}
    </div>
  );
};
