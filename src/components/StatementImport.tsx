// « Lire un relevé » : le relevé de la banque (PDF ou capture d'écran), choisi sur l'appareil,
// est lu par Gemini avec la clé de l'utilisateur (services/statementReader). Pécule propose
// ensuite, compte par compte, le compte correspondant, le nouveau solde et les opérations à
// ajouter (doublons et opérations déjà comprises dans le dernier solde décochés), avec le
// contrôle « ancien solde + opérations = nouveau solde ». Rien n'est enregistré avant
// « Importer », qui passe par la commande importStatement (annulation exacte). Les calculs
// sont dans lib/statementImport ; ici, seulement l'affichage et les choix.
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, KeyRound, Loader2, Upload, X } from 'lucide-react';
import { AccountType, type SavingsAccount } from '../types';
import { Modal } from './Modal';
import { Button, IconButton, MoneyText, fieldClass } from './ui';
import {
  balanceOnlyByDefault, buildImportItems, initialChoice, previewAccountImport, proposeMapping, statementClosingDate, statementConsistencyGap,
  type OlderBalance, type ReviewedMovement, type StatementAccount, type StatementAccountChoice, type StatementData,
} from '../lib/statementImport';
import { importStatement, type StatementImportItem } from '../lib/commands';
import { tracksDeposits } from '../lib/finance';
import { formatEUR, formatSignedEUR } from '../lib/format';
import { localTodayISO } from '../lib/dates';
import { EPS } from '../lib/money';
import { describeStatementError, isDemoSession, readStatementFile, STATEMENT_ACCEPT } from '../services/statementReader';

export interface StatementImportProps {
  accounts: SavingsAccount[];
  geminiApiKey: string;
  /** Ouvert depuis la fiche d'un compte : proposé pour un relevé d'un seul compte. */
  preferredAccountId?: string;
  onClose: () => void;
  /** Enregistre (commande importStatement, avec « Annuler ») ; renvoie le refus à afficher, ou `null`. */
  onImport: (items: StatementImportItem[]) => string | null;
  /** Ouvre les Paramètres sur la clé Gemini. */
  onOpenKeys?: () => void;
  /** Lecture du fichier (tests) ; par défaut Gemini, ou la lecture fictive du mode démo. */
  read?: (file: File) => Promise<StatementData>;
}

const frDay = (iso: string) => iso.split('-').reverse().join('/');
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const movementNote = (m: ReviewedMovement): string | null => {
  if (m.status === 'duplicate' && m.matched) return `Déjà enregistrée (« ${m.matched.label} » du ${frDay(m.matched.date)})`;
  if (m.status === 'already-counted') return 'Antérieure au dernier solde vérifié : probablement déjà comprise';
  if (m.status === 'future') return "Datée après aujourd'hui : date mal lue, ou opération à venir";
  if (m.interest) return 'Intérêts : enregistrés hors épargne';
  return null;
};

const olderNote = (closing: string, older: OlderBalance): string =>
  (older.reason === 'checked'
    ? `Ce relevé s'arrête le ${frDay(closing)}, avant votre dernier solde vérifié (${frDay(older.since)}) : reprendre son solde ramènerait le compte en arrière.`
    : `Ce relevé s'arrête le ${frDay(closing)}, avant un mouvement déjà enregistré le ${frDay(older.since)} : reprendre son solde effacerait ce qui a bougé depuis.`)
  + ' Laissez décoché, sauf si vous êtes sûr que ce solde est le bon.';

export const StatementImport: React.FC<StatementImportProps> = ({ accounts, geminiApiKey, preferredAccountId, onClose, onImport, onOpenKeys, read }) => {
  const demo = isDemoSession();
  const canRead = demo || !!geminiApiKey;
  const [step, setStep] = useState<'pick' | 'reading' | 'review'>('pick');
  const [error, setError] = useState<{ text: string; key?: boolean } | null>(null);
  const [data, setData] = useState<StatementData | null>(null);
  const [choices, setChoices] = useState<StatementAccountChoice[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const reviewTitleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  // Fenêtre fermée pendant la lecture : la réponse arrivée ensuite est ignorée.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (step === 'review') reviewTitleRef.current?.focus(); }, [step]);
  const today = localTodayISO();

  const choiceFor = (s: StatementAccount, d: StatementData, accountId: string | undefined): StatementAccountChoice =>
    initialChoice(s, d, accountId ? accounts.find(a => a.id === accountId) : undefined, today);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setStep('reading');
    try {
      const d = await (read ?? (f => readStatementFile(f, geminiApiKey)))(file);
      if (!alive.current) return;
      if (d.accounts.length === 0) {
        setError({ text: "Aucun compte lisible dans ce document. Vérifiez qu'il s'agit bien d'un relevé de compte (le PDF d'origine de la banque, ou une capture nette), ou actualisez vos soldes à la main." });
        setStep('pick');
        return;
      }
      const mapping = proposeMapping(d, accounts, preferredAccountId);
      setData(d);
      setChoices(d.accounts.map((s, i) => choiceFor(s, d, mapping[i])));
      setStep('review');
    } catch (err) {
      if (!alive.current) return;
      const r = describeStatementError(err);
      setError({ text: r.message, key: r.kind === 'key' });
      setStep('pick');
    }
  };

  const patchChoice = (i: number, patch: Partial<StatementAccountChoice>) => {
    setError(null);
    setChoices(prev => prev.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  };
  // Autre compte choisi : tout est recalculé pour lui (rien ne reste du compte d'avant).
  const replaceChoice = (i: number, choice: StatementAccountChoice) => {
    setError(null);
    setChoices(prev => prev.map((c, k) => (k === i ? choice : c)));
  };
  const toggleMovement = (i: number, k: number) => {
    setError(null);
    setChoices(prev => prev.map((c, j) => (j === i ? { ...c, selected: c.selected.map((v, x) => (x === k ? !v : v)) } : c)));
  };

  const items = useMemo(() => (data ? buildImportItems(data, choices, today) : []), [data, choices, today]);
  // Essai à blanc de la commande : un refus (part des parents, solde négatif) est montré
  // avant de valider, avec le message même qu'aurait l'enregistrement.
  const check = useMemo(() => (items.length > 0 ? importStatement({ accounts }, { items }) : null), [items, accounts]);
  const blocking = check && !check.ok ? check.error : null;

  const submit = () => {
    if (items.length === 0 || blocking) return;
    const refused = onImport(items);
    if (refused) setError({ text: refused });
    else onClose();
  };

  const openKeys = onOpenKeys && (
    <Button variant="tonal" onClick={() => { onClose(); onOpenKeys(); }}>
      <KeyRound className="w-4 h-4" aria-hidden="true" /> Ajouter la clé Gemini
    </Button>
  );

  const pick = (
    <div className="space-y-4">
      <p className="text-sm text-on-surface-variant">
        Choisissez le relevé de compte de votre banque (PDF, ou capture d'écran de son application). Pécule propose ensuite les nouveaux soldes et les opérations à ajouter : <strong className="font-medium text-on-surface">rien n'est enregistré avant votre validation</strong>.
      </p>
      <p className="text-xs text-on-surface-variant">
        {demo
          ? 'Mode démo : un relevé fictif est lu, sans rien envoyer.'
          : "Le document est envoyé à Google Gemini avec votre clé, directement depuis cet appareil : jamais au serveur de Pécule, et il n'est pas gardé dans vos données."}
      </p>
      {!demo && (
        <p className="text-xs text-on-surface-variant">
          Un relevé contient votre nom, votre adresse et vos numéros de compte. Avec une clé Gemini gratuite, Google peut utiliser le document pour améliorer ses modèles et le faire relire par des personnes : utilisez une clé d'une offre payante si cela ne vous convient pas.
        </p>
      )}
      {canRead && <input ref={fileRef} type="file" accept={STATEMENT_ACCEPT} onChange={onFile} className="hidden" tabIndex={-1} aria-hidden="true" data-testid="statement-file" />}
      {canRead ? (
        <Button ref={pickRef} onClick={() => fileRef.current?.click()} disabled={step === 'reading'} isLoading={step === 'reading'}>
          {step !== 'reading' && <Upload className="w-4 h-4" aria-hidden="true" />} Choisir le relevé
        </Button>
      ) : (
        <div className="rounded-xl bg-surface-container p-4 space-y-3">
          <p className="text-sm text-on-surface">La lecture d'un relevé demande une clé Gemini, gardée sur cet appareil seulement.</p>
          {openKeys}
        </div>
      )}
      <p role="status" aria-live="polite" className="text-sm text-on-surface-variant flex items-center gap-2 min-h-5">
        {step === 'reading' && <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Lecture du relevé… (jusqu'à une minute pour un long relevé)</>}
      </p>
    </div>
  );

  const usedBefore = (i: number) => choices.slice(0, i).some(c => c.accountId && c.accountId === choices[i].accountId);

  const review = data && (
    <div className="space-y-4">
      <p className="text-sm text-on-surface-variant">
        {[data.bank, data.periodStart && data.periodEnd ? `du ${frDay(data.periodStart)} au ${frDay(data.periodEnd)}` : null].filter(Boolean).join(', ') || 'Relevé lu'}
        {' · '}{plural(data.accounts.length, 'compte', 'comptes')}. Vérifiez chaque ligne avec votre relevé avant d'importer.
      </p>
      {data.accounts.map((s, i) => {
        const c = choices[i];
        const acc = c?.accountId ? accounts.find(a => a.id === c.accountId) : undefined;
        const gap = statementConsistencyGap(s);
        const selectedMoves = acc ? c.movements.filter((_, k) => c.selected[k]) : [];
        const preview = acc ? previewAccountImport(acc, c.updateBalance ? s.closingBalance : undefined, selectedMoves) : null;
        const newCount = c?.movements.filter(m => m.status === 'new').length ?? 0;
        const selectId = `${titleId}-acc-${i}`;
        return (
          <section key={i} aria-labelledby={`${selectId}-title`} className="rounded-2xl border border-outline-variant bg-surface-container-low p-4 space-y-3">
            <div>
              <h3 id={`${selectId}-title`} className="text-base font-medium text-on-surface flex items-center gap-2">
                <FileText className="w-4 h-4 text-on-surface-variant shrink-0" aria-hidden="true" /> {s.name}
              </h3>
              <p className="text-sm text-on-surface-variant">
                {s.closingBalance !== undefined
                  ? <>Nouveau solde : <MoneyText value={s.closingBalance} decimals={2} className="font-medium text-on-surface" /> au {frDay(statementClosingDate(s, data, today))}</>
                  : 'Nouveau solde non lu'}
                {' · '}{plural(s.movements.length, 'opération', 'opérations')}
              </p>
            </div>

            <div>
              <label htmlFor={selectId} className="block text-sm font-medium text-on-surface-variant mb-1.5">Compte dans Pécule</label>
              <select id={selectId} value={c?.accountId ?? ''} onChange={e => replaceChoice(i, choiceFor(s, data, e.target.value || undefined))} className={fieldClass}>
                <option value="">Ne pas importer</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.institution ? ` (${a.institution})` : ''}</option>)}
              </select>
              {usedBefore(i) && <p className="mt-1 px-4 text-xs text-error font-medium">Ce compte est déjà choisi plus haut : seul le premier relevé sera importé.</p>}
            </div>

            {acc && c && (
              <>
                {s.closingBalance !== undefined && (
                  <div>
                    <label className="flex items-start gap-3 min-h-12 py-1 text-sm text-on-surface cursor-pointer">
                      <input type="checkbox" checked={c.updateBalance} onChange={e => patchChoice(i, { updateBalance: e.target.checked })} className="mt-0.5 w-5 h-5 accent-primary shrink-0"
                        aria-describedby={c.older ? `${selectId}-older` : undefined} />
                      <span>Mettre le solde à jour : <MoneyText value={s.closingBalance} decimals={2} className="font-medium" /> (actuellement <MoneyText value={acc.totalAmount} decimals={2} />{acc.parentalCapital > 0 ? <>, dont <MoneyText value={acc.parentalCapital} /> de vos parents, qui ne bouge pas</> : null})</span>
                    </label>
                    {c.older && (
                      <p id={`${selectId}-older`} className="ml-8 text-xs font-medium text-tertiary flex items-start gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {olderNote(statementClosingDate(s, data, today), c.older)}
                      </p>
                    )}
                  </div>
                )}

                {gap !== null && Math.abs(gap) < EPS && (
                  <p className="text-xs text-on-surface-variant flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-gain shrink-0" aria-hidden="true" /> Relevé complet : l'ancien solde plus les opérations lues donnent bien le nouveau solde.</p>
                )}
                {gap !== null && Math.abs(gap) >= EPS && (
                  <p className="text-xs font-medium text-tertiary flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> Le relevé ne tombe pas juste ({formatSignedEUR(gap, 2)} entre l'ancien solde, les opérations lues et le nouveau solde) : des lignes ont pu être mal lues. Comparez avec votre relevé.</p>
                )}
                {s.ignored > 0 && <p className="text-xs text-on-surface-variant">{plural(s.ignored, 'ligne illisible écartée', 'lignes illisibles écartées')} (date, montant ou sens manquant).</p>}

                {c.movements.length > 0 && (
                  <fieldset className="space-y-1">
                    <legend className="text-sm font-medium text-on-surface flex flex-wrap items-center justify-between gap-2 w-full">
                      <span>Opérations à ajouter à vos mouvements</span>
                      {newCount > 0 && (
                        <Button variant="text" className="-mr-3"
                          onClick={() => patchChoice(i, { selected: c.selected.some(Boolean) ? c.selected.map(() => false) : c.movements.map(m => m.status === 'new') })}>
                          {c.selected.some(Boolean) ? 'Tout décocher' : `Cocher les nouvelles (${newCount})`}
                        </Button>
                      )}
                    </legend>
                    {acc.type === AccountType.COMPTE_COURANT && <p className="text-xs text-on-surface-variant">Compte courant : par défaut, seul le solde est mis à jour. Cochez les opérations à garder dans votre historique.</p>}
                    {acc.type !== AccountType.COMPTE_COURANT && balanceOnlyByDefault(acc.type) && (
                      <p className="text-xs text-on-surface-variant">Placement : par défaut, seul le solde est mis à jour, et l'écart compte comme une variation de valeur. Cochez seulement l'argent que vous avez vraiment versé ou retiré, pas les achats, ventes, dividendes ou frais.</p>
                    )}
                    <ul className="divide-y divide-outline-variant">
                      {c.movements.map((m, k) => {
                        const note = movementNote(m);
                        return (
                          <li key={k}>
                            <label className="flex items-start gap-3 min-h-12 py-2 cursor-pointer">
                              <input type="checkbox" checked={!!c.selected[k]} onChange={() => toggleMovement(i, k)} className="mt-0.5 w-5 h-5 accent-primary shrink-0"
                                aria-label={`${frDay(m.date)}, ${m.label}, ${m.type === 'IN' ? '+' : '−'}${formatEUR(m.amount, 2)}${note ? `. ${note}` : ''}`} />
                              <span className="flex-1 min-w-0 text-sm" aria-hidden="true">
                                <span className="flex justify-between gap-2">
                                  <span className="text-on-surface break-words">{m.label}</span>
                                  <span className={`tabular-nums whitespace-nowrap font-medium ${m.type === 'IN' ? 'text-gain' : 'text-loss'}`}>{m.type === 'IN' ? '+' : '−'}{formatEUR(m.amount, 2)}</span>
                                </span>
                                <span className="block text-xs text-on-surface-variant">{frDay(m.date)}{note ? ` · ${note}` : ''}</span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                )}

                {preview && (
                  <p className="text-sm text-on-surface rounded-xl bg-surface-container p-3">
                    {preview.remainingGap === null
                      ? (selectedMoves.length === 0 ? 'Rien à importer pour ce compte.'
                        : selectedMoves.length === 1 ? "Solde non repris : seule l'opération cochée est ajoutée."
                          : `Solde non repris : seules les ${selectedMoves.length} opérations cochées sont ajoutées.`)
                      : Math.abs(preview.remainingGap) < EPS
                        ? <>Après import : solde de <MoneyText value={s.closingBalance!} decimals={2} />, identique au relevé.</>
                        : <>Après import : solde de <MoneyText value={s.closingBalance!} decimals={2} />. L'écart restant (<MoneyText value={preview.remainingGap} decimals={2} signed />) est enregistré comme dans Actualiser{tracksDeposits(acc.type) ? ' (variation de valeur)' : ''}.</>}
                  </p>
                )}
              </>
            )}
          </section>
        );
      })}
      {(blocking || error) && <p role="alert" className="rounded-xl bg-error-container text-on-error-container p-3 text-sm font-medium">{blocking || error?.text}</p>}
    </div>
  );

  return (
    <Modal open onClose={onClose} label="Lire un relevé" variant="sheet" className="max-w-2xl p-6" initialFocusRef={canRead ? pickRef : undefined} closeOnScrim={step === 'pick'}>
      <div className="flex justify-between items-start gap-2 mb-4">
        {step === 'review'
          ? <h2 ref={reviewTitleRef} tabIndex={-1} className="text-2xl font-normal text-on-surface outline-none">Relecture du relevé</h2>
          : <h2 className="text-2xl font-normal text-on-surface">Lire un relevé</h2>}
        <IconButton icon={X} label="Fermer" onClick={onClose} className="-mr-3" />
      </div>
      {step === 'review' ? review : pick}
      {step !== 'review' && error && (
        <div role="alert" className="mt-3 rounded-xl bg-error-container text-on-error-container p-3 text-sm font-medium space-y-2">
          <p>{error.text}</p>
          {error.key && openKeys}
        </div>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {step === 'review' && <Button variant="text" onClick={() => { setStep('pick'); setData(null); setChoices([]); setError(null); }}>Autre relevé</Button>}
        <Button variant="text" onClick={onClose}>Annuler</Button>
        {step === 'review' && (
          <Button onClick={submit} disabled={items.length === 0 || !!blocking} aria-describedby={items.length === 0 ? `${titleId}-why` : undefined}>Importer</Button>
        )}
      </div>
      {step === 'review' && items.length === 0 && <p id={`${titleId}-why`} className="mt-2 text-right text-xs text-on-surface-variant">Choisissez au moins un compte, avec son solde ou des opérations.</p>}
    </Modal>
  );
};
