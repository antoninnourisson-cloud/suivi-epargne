// « Les taux ont changé » (phase 8, rituel 3), chargé à la demande depuis la tâche de l'Accueil
// (taux relevés par la veille fiscale) ou le lien « Un taux a changé ? » d'Actualiser.
// Téléphone d'abord :
//  - une ligne par groupe de livrets réglementés relevé par la veille : taux actuel, nouveau
//    taux (corrigeable) et date d'effet, avec les comptes concernés et la source ;
//  - « Vos autres comptes » : livrets bancaires et assurance vie (fonds euros), avec leur taux
//    actuel ; un champ vide ou inchangé ne change rien. Même date d'effet que les livrets
//    réglementés, sauf si vous la changez (aujourd'hui sans proposition) ;
//  - « Appliquer » fait tout en une commande (un seul « Annuler »), « Ignorer ces taux »
//    écarte les propositions. Rien ne change sans un clic.
import React, { useState } from 'react';
import { Check, ExternalLink, Percent, X } from 'lucide-react';
import type { SavingsAccount } from '../../types';
import { REGULATED_RATE_GROUPS } from '../../lib/finance';
import { otherRateAccounts, type RateProposalInfo } from '../../lib/rateChanges';
import type { RateChangesInput } from '../../lib/commands';
import { localTodayISO } from '../../lib/dates';
import { parseFrenchNumber } from '../../lib/numbers';
import { formatRate } from '../../lib/format';
import { Modal } from '../Modal';
import { Button, IconButton, TextField } from '../ui';

export interface RateChangesSheetProps {
  accounts: SavingsAccount[];
  /** Taux relevés par la veille fiscale (vide : ouverture à la main, autres comptes seulement). */
  proposals: RateProposalInfo[];
  /** Tout appliquer en une fois ; refus renvoyé, sinon `null`. */
  onApply: (input: RateChangesInput) => string | null;
  /** « Ignorer ces taux » (seulement avec des propositions). */
  onIgnore?: () => void;
  onClose: () => void;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RATE = 20;
/** Taux saisi : `undefined` si vide, `null` si illisible. */
const readRate = (text: string): number | null | undefined => {
  if (text.trim() === '') return undefined;
  const v = parseFrenchNumber(text.replace('%', ''));
  return v !== null && v >= 0 && v <= MAX_RATE ? v : null;
};
const inputRate = (n: number) => String(n).replace('.', ',');
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const RATE_ERROR = 'Taux non reconnu (exemple : 1,5)';

export const RateChangesSheet: React.FC<RateChangesSheetProps> = ({ accounts, proposals, onApply, onIgnore, onClose }) => {
  const today = localTodayISO();
  const [groups, setGroups] = useState<Record<string, { rate: string; date: string }>>(() =>
    Object.fromEntries(proposals.map(p => [p.group, { rate: inputRate(p.value), date: p.effectiveDate }])));
  const [others, setOthers] = useState<Record<string, string>>({});
  // Date des autres comptes : celle du premier taux réglementé tant qu'elle n'est pas changée.
  const [ownDate, setOwnDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const otherAccounts = otherRateAccounts(accounts);
  const followDate = proposals.length > 0 ? groups[proposals[0].group]?.date ?? today : today;
  const otherDate = ownDate ?? followDate;
  const title = proposals.length > 0 ? 'Les taux ont changé' : 'Un taux a changé ?';

  const groupRows = proposals.map(p => {
    const d = groups[p.group];
    const names = accounts.filter(a => REGULATED_RATE_GROUPS.find(g => g.key === p.group)?.types.includes(a.type)).map(a => a.name);
    return { p, d, rate: readRate(d.rate), dateOk: ISO_DAY.test(d.date), names };
  });
  const otherRows = otherAccounts.map(a => {
    const text = others[a.id] ?? '';
    const rate = readRate(text);
    const changed = typeof rate === 'number' && Math.abs(rate - (a.interestRate || 0)) > 1e-9;
    return { a, text, rate, changed };
  });
  const changedOthers = otherRows.filter(r => r.changed);
  const otherDateOk = ISO_DAY.test(otherDate);
  const valid = groupRows.every(r => typeof r.rate === 'number' && r.dateOk)
    && otherRows.every(r => r.rate !== null)
    && (changedOthers.length === 0 || otherDateOk);
  const somethingToDo = groupRows.length > 0 || changedOthers.length > 0;

  const edit = (key: string, field: 'rate' | 'date', value: string) => { setError(null); setGroups(g => ({ ...g, [key]: { ...g[key], [field]: value } })); };

  const apply = () => {
    if (!valid || !somethingToDo) return;
    const refused = onApply({
      groups: groupRows.map(r => ({ key: r.p.group, rate: r.rate as number, date: r.d.date })),
      accounts: changedOthers.map(r => ({ accountId: r.a.id, rate: r.rate as number, date: otherDate })),
    });
    if (refused) { setError(refused); return; }
    onClose();
  };

  return (
    <Modal open onClose={onClose} label={title} variant="page" closeOnScrim={false} className="sm:max-w-xl p-4 sm:p-6">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h2 className="text-xl font-normal text-on-surface">{title}</h2>
        <IconButton icon={X} label="Fermer" onClick={onClose} className="-mr-3 -mt-2" />
      </div>
      <p className="text-sm text-on-surface-variant mb-4">
        {proposals.length > 0
          ? 'La veille fiscale a relevé de nouveaux taux officiels. Vérifiez-les (et corrigez-les si besoin) : rien ne change avant « Appliquer ».'
          : 'Votre banque ou votre assureur a changé un taux ? Corrigez-le ici, avec sa date d\'effet. Les intérêts sont recalculés avec l\'ancien taux avant cette date et le nouveau après.'}
      </p>

      {groupRows.length > 0 && (
        <ul className="space-y-3" aria-label="Taux réglementés">
          {groupRows.map(({ p, d, rate, dateOk, names }) => (
            <li key={p.group} className="p-4 rounded-xl bg-surface-container-low border border-outline-variant">
              <p className="font-medium text-sm text-on-surface flex items-center gap-1.5"><Percent className="w-4 h-4 text-primary" aria-hidden="true" /> {p.groupLabel}</p>
              <p className="text-xs text-on-surface-variant mt-0.5">Actuel : {formatRate(p.current)} · {names.join(', ')}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <TextField label="Nouveau taux" aria-label={`Nouveau taux, ${p.groupLabel}`} suffix="%" inputMode="decimal" value={d.rate}
                  error={rate === null || rate === undefined ? RATE_ERROR : undefined} onChange={e => edit(p.group, 'rate', e.target.value)} />
                <TextField label="À partir du" aria-label={`À partir du, ${p.groupLabel}`} type="date" value={d.date}
                  error={dateOk ? undefined : 'Date à choisir'} onChange={e => edit(p.group, 'date', e.target.value)} />
              </div>
              {p.source && (
                <a href={p.source} target="_blank" rel="noopener noreferrer" className="mt-2 text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline">
                  Source : {hostOf(p.source)} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="rate-others-title" className={groupRows.length > 0 ? 'mt-6' : ''}>
        <h3 id="rate-others-title" className="text-base font-medium text-on-surface">Vos autres comptes</h3>
        {otherRows.length === 0 ? (
          <p className="text-sm text-on-surface-variant mt-1">Aucun livret bancaire ni assurance vie : rien d'autre à corriger.</p>
        ) : (
          <>
            <p className="text-sm text-on-surface-variant mt-1">Livrets bancaires et assurance vie (fonds euros) : leur taux est fixé par la banque ou l'assureur. Une ligne laissée vide ne change rien.</p>
            <ul className="mt-2 divide-y divide-outline-variant" aria-label="Vos autres comptes">
              {otherRows.map(({ a, text, rate }) => (
                <li key={a.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate">{a.name}</p>
                    <p className="text-xs text-on-surface-variant">Actuel : {formatRate(a.interestRate || 0)}</p>
                    {rate === null && <p role="alert" className="text-xs font-medium text-error">{RATE_ERROR}</p>}
                  </div>
                  <TextField className="w-32 shrink-0" label="Nouveau taux" aria-label={`Nouveau taux, ${a.name}`} suffix="%" inputMode="decimal" value={text}
                    placeholder={inputRate(a.interestRate || 0)} aria-invalid={rate === null ? true : undefined}
                    onChange={e => { setError(null); setOthers(o => ({ ...o, [a.id]: e.target.value })); }} />
                </li>
              ))}
            </ul>
            <TextField className="mt-2" label="À partir du" aria-label="À partir du, autres comptes" type="date" value={otherDate}
              onChange={e => { setError(null); setOwnDate(e.target.value); }}
              error={changedOthers.length > 0 && !otherDateOk ? 'Date à choisir' : undefined}
              supporting={ownDate === null && proposals.length > 0 ? `Même date que ${proposals[0].groupLabel}.` : undefined} />
          </>
        )}
      </section>

      {error && <p role="alert" className="mt-4 bg-error-container text-on-error-container p-3 rounded-xl text-sm font-medium">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {proposals.length > 0 && onIgnore && (
          <Button variant="text" onClick={() => { onIgnore(); onClose(); }} className="mr-auto -ml-3 max-sm:h-12">Ignorer ces taux</Button>
        )}
        <Button onClick={apply} disabled={!valid || !somethingToDo} className="max-sm:h-12">
          <Check className="w-4 h-4" aria-hidden="true" /> Appliquer
        </Button>
      </div>
    </Modal>
  );
};
