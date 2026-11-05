// « J'ai besoin d'argent : où le prendre ? » (phase 8, rituel 2), chargé à la demande depuis
// le bouton « Mouvement » et Comptes › Mouvements. Deux temps, téléphone d'abord :
//  1. le montant et le jour du besoin (aujourd'hui par défaut) ;
//  2. la proposition (lib/needMoney) : « Prendre 800 € sur le Livret A », le moins cher
//     d'abord, chaque ligne avec son coût en euros (intérêts perdus d'ici la fin de l'année,
//     impôt d'un placement, ou « rien »), le meilleur jour pour un livret, la phrase de
//     précaution et ce qui manque si votre épargne ne suffit pas. Lignes modifiables (compte,
//     montant). Aujourd'hui : « Enregistrer » vire chaque montant sur le compte courant, en une
//     fois (un seul « Annuler ») ; plus tard : « Prévoir le retrait » crée la tâche de l'Accueil.
import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarClock, Info, Lightbulb, Plus, Trash2, Wallet, X } from 'lucide-react';
import type { FiscalConfig, GlobalAppData, PlannedWithdrawal, PlannedWithdrawalLine, SavingsAccount } from '../../types';
import type { EmergencyFund } from '../../lib/planning';
import { bestWithdrawalDay, needSources, planNeed, plannedDay, precautionAfter, withdrawalCost, type WithdrawalCost } from '../../lib/needMoney';
import { hasParentalCapital } from '../../lib/parentalMode';
import { payAccountOf } from '../../lib/payDistribution';
import { localTodayISO, parseISODate } from '../../lib/dates';
import { parseFrenchNumber } from '../../lib/numbers';
import { EPS, round2 } from '../../lib/money';
import { elideLe, formatEUR, frenchDay, toInputAmount } from '../../lib/format';
import { Modal } from '../Modal';
import { Button, IconButton, TextField, fieldClass } from '../ui';

export interface NeedMoneySheetProps {
  accounts: SavingsAccount[];
  config: GlobalAppData['config'];
  fiscalConfig: FiscalConfig;
  /** Jauge de précaution de l'Accueil (useDerivedData) : absente sans dépenses connues. */
  emergency: EmergencyFund | null;
  onClose: () => void;
  /** Besoin d'aujourd'hui : les retraits enregistrés en une fois ; refus renvoyé, sinon `null`. */
  onRecord: (lines: PlannedWithdrawalLine[], date: string) => string | null;
  /** Besoin futur : le retrait prévu (tâche de l'Accueil le jour venu). */
  onPlan: (plan: PlannedWithdrawal) => void;
}

interface Row { id: string; accountId: string; amount: string }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const parseAmount = (text: string): number | null => {
  const v = parseFrenchNumber(text);
  return v !== null && v >= 0 ? round2(v) : null;
};
const dayOf = (iso: string) => frenchDay(parseISODate(iso));

/** Coût d'une ligne, en mots et en euros. */
const costText = (c: WithdrawalCost): string => {
  const parts: string[] = [];
  if (c.lostInterest >= 0.5) parts.push(`environ ${formatEUR(c.lostInterest, 0)} d'intérêts perdus d'ici la fin de l'année`);
  if (c.tax >= 0.5) parts.push(`environ ${formatEUR(c.tax, 0)} d'impôt et de prélèvements sociaux`);
  if (!c.taxKnown) parts.push("l'impôt n'est pas connu : renseignez les versements cumulés du compte");
  return parts.length > 0 ? `Coût : ${parts.join(', ')}.` : 'Coût : rien.';
};

export const NeedMoneySheet: React.FC<NeedMoneySheetProps> = ({ accounts, config, fiscalConfig, emergency, onClose, onRecord, onPlan }) => {
  const today = localTodayISO();
  const [step, setStep] = useState<1 | 2>(1);
  const [amountText, setAmountText] = useState('');
  const [needDate, setNeedDate] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [missing, setMissing] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const amount = parseAmount(amountText);
  const dateOk = ISO_DAY.test(needDate) && needDate >= today;
  const step1Ok = amount !== null && amount > 0 && dateOk;
  const future = needDate > today;
  const asOf = parseISODate(today);
  const sources = useMemo(() => needSources(accounts, fiscalConfig, asOf), [accounts, fiscalConfig, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const dest = payAccountOf({ accounts, config });
  const withParents = hasParentalCapital(accounts);

  const propose = () => {
    if (!step1Ok) return;
    const plan = planNeed(accounts, fiscalConfig, amount!, today, needDate);
    setRows(plan.lines.map((l, i) => ({ id: `r${i}`, accountId: l.accountId, amount: toInputAmount(l.amount) })));
    setMissing(plan.missing);
    setError(null);
    setStep(2);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  // Lignes saisies : montant lu, compte, coût au jour conseillé.
  const parsed = rows.map(r => ({ row: r, account: accounts.find(a => a.id === r.accountId), value: parseAmount(r.amount) }));
  const lines: PlannedWithdrawalLine[] = parsed.filter(p => p.account && p.value !== null && p.value > 0).map(p => ({ accountId: p.row.accountId, amount: p.value! }));
  const day = plannedDay(lines, accounts, today, needDate);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const rowsOk = parsed.every(p => p.value !== null && (!p.account || p.value <= p.account.ownedAmount + EPS)) && lines.length > 0;
  const precaution = precautionAfter(accounts, lines, emergency);
  // Conseil des quinzaines : ce que le jour conseillé fait garder, face à un retrait aujourd'hui.
  const quinzaineGain = future && day < needDate
    ? lines.reduce((s, l) => {
      const a = accounts.find(x => x.id === l.accountId)!;
      if (bestWithdrawalDay(a, l.amount, today, needDate) !== day) return s;
      return s + withdrawalCost(a, l.amount, fiscalConfig, today).lostInterest - withdrawalCost(a, l.amount, fiscalConfig, day).lostInterest;
    }, 0)
    : 0;

  const patchRow = (id: string, patch: Partial<Row>) => { setError(null); setRows(list => list.map(r => (r.id === id ? { ...r, ...patch } : r))); };
  const addRow = () => {
    const free = sources.find(a => !rows.some(r => r.accountId === a.id)) ?? sources[0];
    if (free) setRows(list => [...list, { id: `r${Date.now()}`, accountId: free.id, amount: '' }]);
  };

  const submit = () => {
    if (!rowsOk) return;
    if (!future) {
      const refused = onRecord(lines, today);
      if (refused) { setError(refused); return; }
    } else {
      onPlan({ id: crypto.randomUUID(), date: day, needDate, lines });
    }
    onClose();
  };

  const heading = (text: string) => (
    <div className="flex items-start justify-between gap-2 mb-4">
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-normal text-on-surface outline-none">{text}</h2>
      <IconButton icon={X} label="Fermer" onClick={onClose} className="-mr-3 -mt-2" />
    </div>
  );

  return (
    <Modal open onClose={onClose} label="J'ai besoin d'argent" variant="page" closeOnScrim={false} className="sm:max-w-xl p-4 sm:p-6">
      {step === 1 && (
        <>
          {heading("J'ai besoin d'argent")}
          <p className="text-sm text-on-surface-variant mb-5">Pécule cherche où le prendre en coûtant le moins : vos livrets d'abord, puis seulement si besoin l'assurance vie et le PEA.{withParents && " La part de vos parents n'est jamais touchée."}</p>
          <div className="space-y-5">
            <TextField label="Montant dont j'ai besoin" inputMode="decimal" value={amountText} onChange={e => setAmountText(e.target.value)} suffix="€" placeholder="800"
              error={amountText.trim() !== '' && amount === null ? 'Montant non reconnu (exemple : 1 234,56)' : undefined} />
            <TextField label="Pour le" type="date" value={needDate} min={today} onChange={e => setNeedDate(e.target.value)}
              error={needDate !== '' && !dateOk ? "Choisissez aujourd'hui ou un jour à venir." : undefined}
              supporting={dateOk && future ? 'Pécule vous rappellera le retrait sur l\'Accueil, au meilleur jour.' : undefined} />
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="text" onClick={onClose} className="max-sm:h-12">Annuler</Button>
            <Button onClick={propose} disabled={!step1Ok} className="max-sm:h-12">Voir où le prendre</Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {heading(`Où prendre ${formatEUR(amount ?? 0)}`)}
          {rows.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Aucun livret, assurance vie ou PEA de plus de 5 ans n'a d'argent à vous : rien à proposer.</p>
          ) : (
            <ul className="divide-y divide-outline-variant" aria-label="Retraits proposés">
              {parsed.map(({ row, account, value }, i) => {
                const tooMuch = !!account && value !== null && value > account.ownedAmount + EPS;
                const cost = account && value !== null && value > 0 && !tooMuch ? withdrawalCost(account, value, fiscalConfig, future ? day : today) : null;
                return (
                  <li key={row.id} className="py-3">
                    <p className="text-sm font-medium text-on-surface">
                      {account && value ? `Prendre ${formatEUR(value)} sur ${elideLe(account.name)}` : 'Ligne à compléter'}
                    </p>
                    <div className="mt-2 grid grid-cols-[1fr_auto] gap-2 items-start">
                      <select aria-label={`Compte de la ligne ${i + 1}`} value={row.accountId} onChange={e => patchRow(row.id, { accountId: e.target.value })} className={`${fieldClass} h-12!`}>
                        {sources.map(a => <option key={a.id} value={a.id}>{a.name} ({formatEUR(a.ownedAmount, 0)} à vous)</option>)}
                      </select>
                      <div className="relative w-32">
                        <input aria-label={`Montant de la ligne ${i + 1}`} inputMode="decimal" value={row.amount} onChange={e => patchRow(row.id, { amount: e.target.value })}
                          aria-invalid={tooMuch || value === null ? true : undefined} className={`${fieldClass} h-12! pr-8 tabular-nums`} />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant" aria-hidden="true">€</span>
                      </div>
                    </div>
                    <p className={`mt-1 text-xs ${tooMuch || value === null ? 'text-error' : 'text-on-surface-variant'}`}>
                      {value === null ? 'Montant non reconnu (exemple : 1 234,56)'
                        : tooMuch ? `Votre part sur ce compte est de ${formatEUR(account!.ownedAmount)}.`
                          : cost ? costText(cost) : ''}
                    </p>
                    {rows.length > 1 && (
                      <Button variant="text" size="sm" onClick={() => setRows(list => list.filter(r => r.id !== row.id))} className="-ml-3 mt-1">
                        <Trash2 className="w-4 h-4" aria-hidden="true" /> Retirer cette ligne
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {sources.length > rows.length && (
            <Button variant="text" size="sm" onClick={addRow} className="-ml-3 mt-1"><Plus className="w-4 h-4" aria-hidden="true" /> Autre compte</Button>
          )}

          <div className="mt-4 space-y-3 text-sm">
            {missing > EPS && (
              <p role="status" className="rounded-xl p-3 bg-error-container text-on-error-container">
                Votre épargne disponible ne suffit pas : il manque {formatEUR(missing)}. {withParents ? "La part de vos parents et l'épargne bloquée" : "L'épargne bloquée"} (retraite, PEL, épargne salariale…) {withParents ? 'ne sont pas proposées' : "n'est pas proposée"}.
              </p>
            )}
            {lines.length > 0 && amount !== null && Math.abs(total - amount) >= 0.005 && missing <= EPS && (
              <p className="text-on-surface-variant">Ces lignes font {formatEUR(total)}, pour un besoin de {formatEUR(amount)}.</p>
            )}
            {quinzaineGain >= 0.5 && (
              <p className="rounded-xl p-3 flex items-start gap-2 bg-tertiary-container text-on-tertiary-container">
                <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Le meilleur jour : le {dayOf(day)}. Retiré ce jour-là plutôt qu'aujourd'hui, l'argent garde environ {formatEUR(quinzaineGain, 0)} d'intérêts : un livret compte par quinzaine, du 1er au 15 et du 16 à la fin du mois.</span>
              </p>
            )}
            {precaution && (
              <p role="status" className="rounded-xl p-3 flex items-start gap-2 bg-surface-container text-on-surface">
                <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Votre épargne de précaution passera à {formatEUR(precaution.after, 0)}, sous son objectif de {formatEUR(precaution.target, 0)}.</span>
              </p>
            )}
            {lines.length > 0 && (
              <p className="text-on-surface-variant">
                {dest ? `Chaque montant sera viré sur ${dest.name}.` : 'Pas de compte courant : chaque montant sera noté comme un retrait.'}
                {future && ` Pécule vous le rappellera sur l'Accueil le ${dayOf(day)}, pour votre besoin du ${dayOf(needDate)}.`}
              </p>
            )}
          </div>

          {error && <p role="alert" className="mt-4 bg-error-container text-on-error-container p-3 rounded-xl text-sm font-medium">{error}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="text" onClick={() => setStep(1)} className="mr-auto -ml-3 max-sm:h-12"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Retour</Button>
            <Button onClick={submit} disabled={!rowsOk} className="max-sm:h-12">
              {future
                ? <><CalendarClock className="w-4 h-4" aria-hidden="true" /> Prévoir le retrait</>
                : <><Wallet className="w-4 h-4" aria-hidden="true" /> Enregistrer</>}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
};
