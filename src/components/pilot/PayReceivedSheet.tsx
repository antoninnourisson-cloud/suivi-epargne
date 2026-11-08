// ================================================
// FILE: src/components/pilot/PayReceivedSheet.tsx
// Le rituel « J'ai reçu ma paie » : une feuille en trois temps, chargée à la demande.
//  0. Bilan du mois d'épargne précédent (la carte « Point de paie »), s'il n'est pas validé :
//     « Continuer » le valide.
//  1. Votre paie : montant reçu (net payé de la fiche du mois si elle est importée, sinon la
//     paie estimée), date, prime éventuelle, mois d'épargne (règle du 15, « Changer »),
//     l'import de la fiche de paie sur place (mêmes composants et mêmes contrôles que l'écran
//     Fiches de paie : la fiche y apparaît ensuite), et le bloc « Compte courant » : le solde
//     lu maintenant, paie comprise (prérempli d'après le solde connu s'il est récent), d'où
//     Pécule déduit ce qui restait avant la paie ; « Je ne sais pas » : compté 0.
//  2. « Que faire de votre paie » (lib/payDistribution) : paie + reste du compte courant à
//     répartir, la barre, puis les lignes dans l'ordre des virements (virements fixes,
//     épargne par compte, épargne projets) ; le plaisir, ce qui reste sur le compte courant,
//     est la ligne d'équilibre, sans case. Montants et comptes se corrigent (« Rétablir les
//     montants conseillés »), « + Autre compte » ; « Tout marquer fait » ou
//     « Enregistrer » (seulement les cases cochées) passent par UNE commande (recordPay), avec
//     un seul « Annuler ». « Tout est fait » enregistre aussi le solde du compte courant.
// « Modifier la paie » rouvre la même feuille sur la paie déclarée (étapes 1 et 2) : les
// lignes déjà faites restent faites, le plan reste figé s'il l'est.
// « Autre argent reçu » (versement en plus) : sa nature se choisit en premier (Remboursement,
// Vente, Cadeau, Autre, lib/extraNature). Un remboursement reste sur le compte courant (rien
// placé par défaut, « + Autre compte » reste possible) ; le reste est placé. Pour un cadeau,
// « Pour une occasion ? » dit en une phrase s'il faut le déclarer (impots.gouv.fr, don manuel).
// ================================================
import React from 'react';
import { ArrowLeft, CalendarDays, CheckCheck, ExternalLink, FileText, Info, KeyRound, PenLine, Plus, Trash2, Wallet, X } from 'lucide-react';
import type { ExtraNature, PayChecklistLine } from '../../types';
import { EXTRA_NATURES, EXTRA_NATURE_EXAMPLE, EXTRA_NATURE_LABEL, EXTRA_NATURE_TITLE } from '../../lib/extraNature';
import { savingsMonthOf, shiftMonth } from '../../lib/payCalendar';
import { elideDe, formatEUR, formatMonth, toInputAmount } from '../../lib/format';
import { placementReason, type PayBarKey } from '../../lib/pilotView';
import { Modal } from '../Modal';
import { Button, IconButton, MoneyText, TextField, fieldClass } from '../ui';
import { PartSwatch, PayBar } from './PayBar';
import { PayReviewCard } from '../motivation/PayReviewCard';
import { PayslipDraftCard, PayslipPickButtons } from '../payslips/PayslipImportParts';
import { usePayReceivedForm, parseAmount, dayLabel, monthLabel, type AddedRow, type SheetProps } from './usePayReceivedForm';

export type { PayRitualProps } from './usePayReceivedForm';

/** Page officielle du don manuel (déclaration en ligne d'un don d'argent). */
const GIFT_DECLARATION_URL = 'https://www.impots.gouv.fr/particulier/don-manuel';
/** Titre de l'étape 2 d'un versement en plus, selon sa nature. */
const EXTRA_PLAN_TITLE: Record<ExtraNature, string> = {
  refund: 'Que faire de ce remboursement', sale: 'Que faire de cette vente', gift: 'Que faire de ce cadeau', other: 'Que faire de ce versement',
};
/** « Cadeau reçu le 4 novembre » : légende du résumé de l'étape 2. */
const EXTRA_RECEIVED: Record<ExtraNature, string> = {
  refund: 'Remboursement reçu', sale: 'Vente encaissée', gift: 'Cadeau reçu', other: 'Versement reçu',
};

export const PayReceivedSheet: React.FC<SheetProps> = (props) => {
  const { geminiApiKey, pickerApiKey, onDeletePay, onValidateReview, onOpenKeys, onClose } = props;
  const {
    today, existing, ids, review, step, setStep, receivedOn, setReceivedOn, monthChoice, setMonthChoice,
    changingMonth, setChangingMonth, dateOk, month, suggestion, kindChoice, setKindChoice, kind, natureChoice, setNatureChoice,
    nature, occasion, setOccasion, payslip, slipPeriod, amountText, setAmountText, bonusOpen, setBonusOpen, bonusText,
    setBonusText, amount, bonusRaw, bonusTooHigh, expected, balanceShown, setBalanceText, includesPay, setIncludesPay, seen,
    balanceInvalid, balance, before, balanceHelp, step1Ok, imp, slipNet, slipGap, dist, doneBefore, frozen, lines, rowOf,
    patchRow, setAdded, added, transferDate, setTransferDate, error, savingAccounts, suggestions, allocation, gapSentence,
    fixedLines, savingLines, projectLine, fixedSum, savingSum, projectsSum, available, leisureLive, bar, modified,
    resetAmounts, headingRef, goToPlan, submit, monthName, stepCount, stepIndex, savingsNote, prefill,
  } = usePayReceivedForm(props);

  const groupHeading = (key: PayBarKey, label: string, amount: number, note?: string) => (
    <div className="mt-6 border-b border-outline-variant pb-2">
      <h3 id={`${ids}-g-${key}`} className="flex items-baseline justify-between gap-3 text-sm font-medium text-on-surface">
        <span className="flex items-center gap-2 min-w-0"><PartSwatch part={key} />{label}</span>
        <MoneyText value={amount} />
      </h3>
      {note && <p className="mt-0.5 ml-5 text-xs text-on-surface-variant">{note}</p>}
    </div>
  );

  const renderLine = (l: PayChecklistLine) => {
    const before = doneBefore[l.key];
    const row = rowOf(l);
    const invalid = !before && parseAmount(row.amount) === null;
    const checkId = `${ids}-c-${l.key}`;
    const statusId = `${ids}-s-${l.key}`;
    const placement = l.kind === 'saving' ? dist.steps.find(st => !st.alert && st.accountId === l.accountId) : undefined;
    const reason = placement && !frozen ? placementReason(placement, dist.customSplit) : undefined;
    return (
      <li key={l.key} className="py-2">
        <div className="flex items-start gap-3">
          <input
            id={checkId}
            type="checkbox"
            checked={!!before || row.checked}
            disabled={!!before}
            onChange={e => patchRow(l, { checked: e.target.checked })}
            aria-describedby={statusId}
            className="mt-3 w-5 h-5 shrink-0 accent-primary cursor-pointer disabled:cursor-not-allowed"
          />
          <div className="flex-1 min-w-0">
            <label htmlFor={checkId} className="block min-h-12 py-2.5 text-sm font-medium text-on-surface cursor-pointer break-words">
              {l.label}
              {reason && <span className="block text-xs font-normal text-on-surface-variant mt-0.5">{reason}</span>}
            </label>
            <p id={statusId} className={`text-xs ${before ? 'text-primary' : invalid ? 'text-error' : 'text-on-surface-variant'}`}>
              {before
                ? <>Déjà fait : <MoneyText value={before.amount} /></>
                : invalid ? 'Montant non reconnu (exemple : 1 234,56)'
                  : <>Conseillé : <MoneyText value={l.amount} />{l.key === 't:projects' && !frozen && allocation.plannedProjects - l.amount >= 0.005 && <> (prévu <MoneyText value={allocation.plannedProjects} />)</>}</>}
            </p>
            {!before && l.kind === 'saving' && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                {savingAccounts.length > 1 && (
                  <label className="flex items-center gap-2 text-sm text-on-surface-variant">
                    sur
                    <select
                      value={row.accountId ?? ''}
                      onChange={e => patchRow(l, { accountId: e.target.value })}
                      aria-label={`Compte crédité pour ${l.label}`}
                      className="h-12 sm:h-10 px-2 rounded-xs bg-transparent border border-outline text-sm text-on-surface"
                    >
                      {savingAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="inline-flex items-center gap-2 min-h-12 sm:min-h-8 text-xs text-on-surface-variant cursor-pointer">
                  <input type="checkbox" checked={row.already} onChange={e => patchRow(l, { already: e.target.checked })} className="w-4 h-4 accent-primary" />
                  Déjà enregistré (ne pas l'ajouter une seconde fois)
                </label>
              </div>
            )}
          </div>
          {!before && (
            <label className="flex items-center gap-1 shrink-0 pt-1">
              <span className="sr-only">Montant fait pour {l.label}</span>
              <input
                type="text"
                inputMode="decimal"
                value={row.amount}
                onChange={e => patchRow(l, { amount: e.target.value })}
                aria-invalid={invalid || undefined}
                className="w-24 h-12 sm:h-10 px-2 text-right text-sm tabular-nums font-medium rounded-xs bg-transparent border border-outline text-on-surface hover:border-on-surface focus:border-primary focus:border-2 outline-none aria-[invalid=true]:border-error aria-[invalid=true]:border-2"
              />
              <span className="text-sm text-on-surface-variant" aria-hidden="true">€</span>
            </label>
          )}
        </div>
      </li>
    );
  };

  const heading = (text: string) => (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-on-surface-variant">Étape {stepIndex} sur {stepCount}</p>
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-normal text-on-surface outline-none">{text}</h2>
      </div>
      <IconButton icon={X} label="Fermer sans enregistrer" onClick={onClose} className="-mr-2 -mt-1" />
    </div>
  );

  return (
    <Modal open onClose={onClose} label={existing ? (existing.kind === 'extra' ? "Modifier l'argent reçu" : 'Modifier la paie') : kind === 'extra' ? 'Argent reçu' : "J'ai reçu ma paie"} variant="page" closeOnScrim={false} className="sm:max-w-2xl p-4 sm:p-6">
      {step === 0 && review && (
        <>
          {heading(`Bilan ${elideDe(formatMonth(review.key))}`)}
          <p className="text-sm text-on-surface-variant mb-4">Avant de répartir la nouvelle paie : ce que le mois qui s'achève a donné.</p>
          <PayReviewCard review={review} onValidate={() => { onValidateReview(review.key); setStep(1); }} validateLabel="Continuer" title="Résultat du mois" />
        </>
      )}

      {step === 1 && (
        <>
          {heading(kind === 'extra' ? (nature ? EXTRA_NATURE_TITLE[nature] : 'Argent reçu') : existing ? 'Modifier la paie' : 'Votre paie')}
          <div className="space-y-5">
            {kind === 'extra' && (
              <fieldset className="rounded-2xl border border-outline-variant p-4">
                <legend className="px-1 text-sm font-medium text-on-surface">Quel argent avez-vous reçu ?</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                  {EXTRA_NATURES.map(n => (
                    <label key={n} className="flex items-start gap-3 min-h-12 py-2 text-sm text-on-surface cursor-pointer">
                      <input type="radio" name={`${ids}-nature`} value={n} checked={natureChoice === n} onChange={() => setNatureChoice(n)} className="mt-0.5 w-5 h-5 shrink-0 accent-primary" />
                      <span>
                        <span className="block font-medium">{EXTRA_NATURE_LABEL[n]}</span>
                        <span className="block text-xs text-on-surface-variant">{EXTRA_NATURE_EXAMPLE[n]}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {nature && (
                  <p role="status" className="mt-2 text-sm text-on-surface flex items-start gap-2">
                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-on-surface-variant" aria-hidden="true" />
                    {nature === 'refund'
                      ? "Conseil : il reste sur le compte courant, c'est de l'argent plaisir. Vous pouvez quand même en placer une partie."
                      : "Conseil : tout va à l'épargne, réparti comme d'habitude entre vos livrets. Corrigeable ligne par ligne."}
                  </p>
                )}
              </fieldset>
            )}

            {nature === 'gift' && (
              <fieldset className="rounded-2xl border border-outline-variant p-4">
                <legend className="px-1 text-sm font-medium text-on-surface">Pour une occasion (anniversaire, fêtes, mariage) ?</legend>
                <div className="flex flex-wrap gap-x-6">
                  {([[true, 'Oui'], [false, 'Non']] as const).map(([v, label]) => (
                    <label key={label} className="flex items-center gap-3 min-h-12 text-sm text-on-surface cursor-pointer">
                      <input type="radio" name={`${ids}-occasion`} checked={occasion === v} onChange={() => setOccasion(v)} className="w-5 h-5 accent-primary" />
                      {label}
                    </label>
                  ))}
                </div>
                {occasion !== undefined && (
                  <p role="status" className="mt-1 text-sm text-on-surface">
                    {occasion
                      ? "C'est un présent d'usage : rien à déclarer s'il reste raisonnable par rapport aux moyens de la personne qui donne."
                      : <>Un don d'argent se déclare en ligne par la personne qui le reçoit, même sans impôt à payer.{' '}
                          <a href={GIFT_DECLARATION_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2 hover:no-underline">
                            Don manuel sur impots.gouv.fr <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span>
                          </a></>}
                  </p>
                )}
              </fieldset>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextField
                label="Montant reçu"
                suffix="€"
                inputMode="decimal"
                className="tabular-nums"
                value={amountText}
                onChange={e => setAmountText(e.target.value)}
                error={amount === null && amountText.trim() !== '' ? 'Montant non reconnu (exemple : 2 512,40).' : undefined}
                supporting={kind === 'extra' ? 'Le montant arrivé sur votre compte courant.' : <>Net arrivé sur votre compte, prime comprise. Paie estimée : <MoneyText value={expected} decimals={0} />.</>}
              />
              <TextField
                label="Reçue le"
                type="date"
                value={receivedOn}
                onChange={e => setReceivedOn(e.target.value)}
                error={!dateOk ? 'Date non reconnue.' : undefined}
              />
            </div>

            {kind !== 'extra' && (
              <div>
                <Button variant="text" size="sm" onClick={() => setBonusOpen(o => !o)} aria-expanded={bonusOpen} aria-controls={`${ids}-bonus`} className="-ml-3">
                  {bonusOpen ? 'Masquer la prime' : 'Dont prime ou exceptionnel'}
                </Button>
                <div id={`${ids}-bonus`} hidden={!bonusOpen} className="mt-2 max-w-xs">
                  <TextField
                    label="Dont prime ou exceptionnel"
                    suffix="€"
                    inputMode="decimal"
                    className="tabular-nums"
                    value={bonusText}
                    onChange={e => setBonusText(e.target.value)}
                    error={bonusRaw === null ? 'Montant non reconnu.' : bonusTooHigh ? 'La prime ne peut pas dépasser le montant reçu.' : undefined}
                    supporting="Placée en entier, en plus de l'épargne habituelle."
                  />
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-surface-container p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-on-surface">
                  <CalendarDays className="inline w-4 h-4 mr-1.5 -mt-0.5 text-on-surface-variant" aria-hidden="true" />
                  Épargne {elideDe(monthName)}
                </p>
                <Button variant="text" size="sm" onClick={() => setChangingMonth(c => !c)} aria-expanded={changingMonth} aria-controls={`${ids}-month`}>Changer</Button>
              </div>
              <p className="mt-1 text-xs text-on-surface-variant">
                {monthChoice ? 'Choisi par vous pour cette paie.' : 'Une paie reçue à partir du 15 finance l\'épargne du mois suivant, avant le 15 celle du mois même.'}
              </p>
              <div id={`${ids}-month`} hidden={!changingMonth} className="mt-3 max-w-xs">
                <label htmlFor={`${ids}-month-select`} className="block text-sm font-medium text-on-surface-variant mb-1.5">Mois d'épargne</label>
                <select
                  id={`${ids}-month-select`}
                  value={month}
                  onChange={e => setMonthChoice(e.target.value === savingsMonthOf(receivedOn) ? undefined : e.target.value)}
                  className={fieldClass}
                >
                  {[-1, 0, 1].map(d => shiftMonth(dateOk ? savingsMonthOf(receivedOn) : month, d)).map(k => (
                    <option key={k} value={k}>{monthLabel(k, today).replace(/^./, c => c.toUpperCase())}</option>
                  ))}
                </select>
              </div>
            </div>

            {!existing && suggestion === 'extra' && (
              <fieldset className="rounded-2xl border border-outline-variant p-4">
                <legend className="px-1 text-sm font-medium text-on-surface">Une paie est déjà déclarée pour l'épargne {elideDe(monthName)}</legend>
                {([['extra', 'Versement en plus (remboursement, vente, cadeau, prime à part)'], ['regular', 'Paie régulière (elle remplace la précédente comme début du mois)']] as const).map(([v, label]) => (
                  <label key={v} className="flex items-start gap-3 min-h-12 py-2 text-sm text-on-surface cursor-pointer">
                    <input type="radio" name={`${ids}-kind`} value={v} checked={(kindChoice ?? 'extra') === v} onChange={() => setKindChoice(v)} className="mt-0.5 w-5 h-5 accent-primary" />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}

            {kind !== 'extra' && (
              <section aria-labelledby={`${ids}-current`} className="rounded-2xl border border-outline-variant p-4">
                <h3 id={`${ids}-current`} className="text-sm font-medium text-on-surface flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> Compte courant{prefill.account ? ` · ${prefill.account.name}` : ''}
                </h3>
                <div className="mt-3 max-w-xs">
                  <TextField
                    label="Solde maintenant, paie comprise"
                    suffix="€"
                    inputMode="decimal"
                    className="tabular-nums"
                    value={balanceShown}
                    onChange={e => setBalanceText(e.target.value)}
                    error={balanceInvalid ? 'Montant non reconnu (exemple : 430,50 ou −50).' : undefined}
                    supporting={balanceHelp}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <label className="inline-flex items-center gap-2 min-h-12 sm:min-h-10 text-sm text-on-surface cursor-pointer">
                    <input type="checkbox" checked={includesPay} onChange={e => setIncludesPay(e.target.checked)} className="w-5 h-5 accent-primary" />
                    Ma paie apparaît déjà dans ce solde
                  </label>
                  {seen !== undefined && (
                    <Button variant="text" size="sm" onClick={() => setBalanceText('')} className="-ml-3 sm:ml-0">Je ne sais pas</Button>
                  )}
                </div>
                <p role="status" className="mt-1 text-sm text-on-surface">
                  {seen === undefined || balanceInvalid ? null
                    : balance.before >= 0.005 ? <>Il restait <MoneyText value={balance.before} /> du mois dernier.</>
                      : balance.before <= -0.005 ? <>Découvert de <MoneyText value={-balance.before} /> avant la paie.</>
                        : 'Rien ne restait du mois dernier.'}
                </p>
              </section>
            )}

            {kind !== 'extra' && (
              <section aria-labelledby={`${ids}-slip`} className="rounded-2xl border border-outline-variant p-4">
                <h3 id={`${ids}-slip`} className="text-sm font-medium text-on-surface flex items-center gap-2">
                  <FileText className="w-4 h-4 text-on-surface-variant" aria-hidden="true" /> Fiche de paie {elideDe(formatMonth(slipPeriod))}
                </h3>
                {payslip ? (
                  <p role="status" className="mt-2 text-sm text-on-surface-variant">
                    {slipNet !== undefined
                      ? <>Net payé : <MoneyText value={slipNet} className="text-on-surface font-medium" />{slipGap !== undefined && Math.abs(slipGap) >= 0.5 && <>, <MoneyText value={Math.abs(slipGap)} decimals={0} /> de {slipGap > 0 ? 'plus' : 'moins'} que prévu</>}.</>
                      : 'Fiche enregistrée, sans net payé.'}
                    {slipNet !== undefined && amount !== null && Math.abs(slipNet - amount) >= 0.005 && (
                      <Button variant="text" size="sm" onClick={() => setAmountText(toInputAmount(slipNet))} className="ml-1">Reprendre ce montant</Button>
                    )}
                  </p>
                ) : imp.draft ? (
                  <div className="mt-3"><PayslipDraftCard imp={imp} keysNoteId={`${ids}-keys`} variant="outlined" /></div>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-on-surface-variant">Facultatif : importez-la pour partir du net payé exact. Elle rejoint vos fiches de paie.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <PayslipPickButtons imp={imp} keysNoteId={`${ids}-keys`} />
                      <Button variant="text" onClick={imp.startManual} className="max-sm:h-12"><PenLine className="w-4 h-4" aria-hidden="true" /> Saisir à la main</Button>
                    </div>
                    {(!geminiApiKey || !pickerApiKey) && (
                      <p id={`${ids}-keys`} className="mt-2 text-xs text-on-surface-variant flex items-start gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>
                          {!pickerApiKey ? 'Sans clé Google Picker, choisissez la fiche sur l\'appareil. ' : ''}
                          {!geminiApiKey ? 'Sans clé Gemini, saisissez ses montants à la main, ou passez cette étape. ' : ''}
                          {onOpenKeys && <button type="button" onClick={onOpenKeys} className="underline text-primary">Clés et services</button>}
                        </span>
                      </p>
                    )}
                  </>
                )}
              </section>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            {existing && (
              <Button variant="text" onClick={() => { onClose(); onDeletePay(existing.id); }} className="mr-auto -ml-3 text-error! max-sm:h-12">
                <Trash2 className="w-4 h-4" aria-hidden="true" /> {existing.kind === 'extra' ? 'Supprimer ce versement' : 'Supprimer cette paie'}
              </Button>
            )}
            <Button variant="text" onClick={onClose} className="max-sm:h-12">Annuler</Button>
            <Button onClick={goToPlan} disabled={!step1Ok || !!imp.draft} className="max-sm:h-12">Voir la répartition</Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {heading(kind === 'extra' ? EXTRA_PLAN_TITLE[nature ?? 'other'] : 'Que faire de votre paie')}
          <div className="rounded-2xl bg-surface-container p-4">
            <p className="text-xs text-on-surface-variant">{kind === 'extra' ? EXTRA_RECEIVED[nature ?? 'other'] : 'Paie reçue'} le {dayLabel(receivedOn, today)} · Épargne {elideDe(monthName)}</p>
            <p className="mt-1 text-base text-on-surface">
              {kind === 'extra'
                ? nature === 'refund'
                  ? <><MoneyText value={amount ?? 0} className="font-medium" /> remboursés : conseillé de les laisser sur le compte courant</>
                  : <><MoneyText value={amount ?? 0} className="font-medium" /> reçus en plus : tout est placé</>
                : before >= 0.005
                  ? <><MoneyText value={amount ?? 0} /> de paie + <MoneyText value={before} /> déjà sur le compte = <MoneyText value={available} className="font-medium" /> à répartir</>
                  : before <= -0.005
                    ? <><MoneyText value={amount ?? 0} /> de paie − <MoneyText value={-before} /> de découvert = <MoneyText value={available} className="font-medium" /> à répartir</>
                    : <><MoneyText value={amount ?? 0} className="font-medium" /> de paie à répartir</>}
            </p>
            {kind !== 'extra' && balance.source === 'unknown' && (
              <p className="mt-1 text-xs text-on-surface-variant">Sans votre solde, Pécule suppose que le compte courant était vide avant la paie.</p>
            )}
            <PayBar bar={bar} notes={modified || frozen ? {} : { savings: savingsNote }} className="mt-4" />
            {frozen && <p className="mt-3 text-sm text-on-surface">Plan figé : une partie est déjà faite. Les lignes restantes se cochent ci-dessous.</p>}
            {/* La phrase explique le conseil : elle se tait une fois les montants changés. */}
            {gapSentence && !modified && <p className="mt-3 text-sm text-on-surface">{gapSentence}</p>}
            {modified && (
              <Button variant="text" size="sm" onClick={resetAmounts} className="mt-2 -ml-3">Rétablir les montants conseillés</Button>
            )}
          </div>

          {fixedLines.length > 0 && (
            <section aria-labelledby={`${ids}-g-fixed`}>
              {groupHeading('fixed', 'Virements fixes', fixedSum)}
              <ul className="divide-y divide-outline-variant">{fixedLines.map(renderLine)}</ul>
            </section>
          )}

          <section aria-labelledby={`${ids}-g-savings`}>
            {groupHeading('savings', 'Épargne', savingSum, modified || frozen ? undefined : savingsNote)}
            {savingLines.length > 0 && <ul className="divide-y divide-outline-variant">{savingLines.map(renderLine)}</ul>}
            {suggestions.map(st => (
              <p key={st.accountName} className="mt-2 text-sm text-on-tertiary-container bg-tertiary-container rounded-xl p-3 flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />{st.hint}
              </p>
            ))}
            {savingLines.length === 0 && suggestions.length === 0 && added.length === 0 && (
              <p className="mt-3 text-sm text-on-surface-variant">
                {nature === 'refund'
                  ? 'Rien à placer : un remboursement rend de l\'argent déjà dépensé. Pour en placer une partie, « Autre compte ».'
                  : kind === 'extra' ? 'Rien à placer sur ce versement.' : 'Rien à placer sur cette paie.'}
              </p>
            )}
            {added.length > 0 && (
              <ul aria-label="Autres comptes" className="divide-y divide-outline-variant">
                {added.map(a => {
                  const invalid = parseAmount(a.amount) === null;
                  const patch = (p: Partial<AddedRow>) => setAdded(list => list.map(x => (x.id === a.id ? { ...x, ...p } : x)));
                  return (
                    <li key={a.id} className="py-2 flex flex-wrap items-center gap-3">
                      <input type="checkbox" checked={a.checked} onChange={e => patch({ checked: e.target.checked })} aria-label="Versement fait sur l'autre compte" className="w-5 h-5 accent-primary" />
                      <select value={a.accountId} onChange={e => patch({ accountId: e.target.value })} aria-label="Autre compte crédité" className="h-12 sm:h-10 px-2 rounded-xs bg-transparent border border-outline text-sm text-on-surface flex-1 min-w-0">
                        {savingAccounts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      <label className="flex items-center gap-1">
                        <span className="sr-only">Montant versé sur l'autre compte</span>
                        <input type="text" inputMode="decimal" value={a.amount} onChange={e => patch({ amount: e.target.value })} aria-invalid={invalid || undefined}
                          className="w-24 h-12 sm:h-10 px-2 text-right text-sm tabular-nums rounded-xs bg-transparent border border-outline text-on-surface aria-[invalid=true]:border-error aria-[invalid=true]:border-2" />
                        <span className="text-sm text-on-surface-variant" aria-hidden="true">€</span>
                      </label>
                      <IconButton icon={X} label="Retirer cet autre compte" onClick={() => setAdded(list => list.filter(x => x.id !== a.id))} />
                    </li>
                  );
                })}
              </ul>
            )}
            {savingAccounts.length > 0 && (
              <Button variant="text" size="sm" className="mt-1 -ml-3" onClick={() => setAdded(list => [...list, { id: `${Date.now()}-${list.length}`, accountId: (savingAccounts.find(a => !lines.some(l => l.accountId === a.id)) ?? savingAccounts[0]).id, amount: '', checked: true }])}>
                <Plus className="w-4 h-4" aria-hidden="true" /> Autre compte
              </Button>
            )}
          </section>

          {(projectLine || (kind !== 'extra' && allocation.plannedProjects > 0)) && (
            <section aria-labelledby={`${ids}-g-projects`}>
              {groupHeading('projects', 'Épargne projets', projectsSum)}
              {projectLine
                ? <ul className="divide-y divide-outline-variant">{renderLine(projectLine)}</ul>
                : <p className="mt-3 text-sm text-on-surface-variant">Suspendue ce mois-ci : <MoneyText value={0} /> (prévu <MoneyText value={allocation.plannedProjects} />).</p>}
            </section>
          )}

          {kind !== 'extra' ? (
            <section aria-labelledby={`${ids}-g-leisure`}>
              {groupHeading('leisure', 'Plaisir : reste sur le compte courant', Math.max(0, leisureLive))}
              <p className="mt-3 text-sm text-on-surface-variant">Rien à virer : c'est l'argent du mois, sur le compte courant. Il suit les montants ci-dessus.</p>
              {leisureLive < 0 ? (
                <p role="status" className="mt-2 text-sm font-medium text-error flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> Il manque {formatEUR(-leisureLive)} pour les virements fixes : à prendre sur votre épargne disponible.</p>
              ) : allocation.floor > 0 && leisureLive < allocation.floor - 0.005 ? (
                <p role="status" className="mt-2 text-sm font-medium text-error flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> En dessous de votre minimum de {formatEUR(allocation.floor)}.</p>
              ) : null}
            </section>
          ) : leisureLive >= 0.005 && (
            <p className="mt-4 text-sm text-on-surface-variant">Reste sur le compte courant{nature === 'refund' ? ' (argent plaisir)' : ''} : <MoneyText value={leisureLive} />.</p>
          )}

          <div className="mt-6 max-w-xs">
            <TextField label="Virements faits le" type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} supporting="Date des versements enregistrés sur vos comptes." />
          </div>

          {error && <p role="alert" className="mt-4 text-sm text-error flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />{error}</p>}

          <p className="mt-6 text-sm text-on-surface-variant">« Enregistrer les cases cochées » garde seulement ce qui est coché ; le reste reste à faire dans la carte « Ma paie ». « Tout marquer fait » coche tout, comme conseillé.</p>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <Button variant="text" onClick={() => setStep(1)} className="mr-auto -ml-3 max-sm:h-12"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Retour</Button>
            <Button variant="tonal" onClick={() => submit(false)} className="max-sm:h-12"><Wallet className="w-4 h-4" aria-hidden="true" /> Enregistrer les cases cochées</Button>
            <Button onClick={() => submit(true)} className="max-sm:h-12"><CheckCheck className="w-4 h-4" aria-hidden="true" /> Tout marquer fait</Button>
          </div>
        </>
      )}
    </Modal>
  );
};

export default PayReceivedSheet;
