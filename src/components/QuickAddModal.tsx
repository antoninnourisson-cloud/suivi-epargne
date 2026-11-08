// Bouton « Mouvement » : un dépôt, un retrait, un virement entre deux de vos comptes (seul
// endroit pour ce geste depuis la fin de l'écran Virements), ou une envie d'achat notée à la
// volée (le nom suffit ; prix et lien se complètent plus tard, voir lib/wishes). Une fois la saisie commencée, un
// toucher hors de la feuille ne la ferme plus (Échap et « Fermer » restent) ; après l'ajout,
// le message de confirmation propose « Annuler » (voir useAccountActions).
import React, { useEffect, useRef, useState } from 'react';
import { lsGet, lsSet } from '../lib/storage';
import { SavingsAccount, type Wish } from '../types';
import { X, ArrowUpCircle, ArrowDownCircle, ArrowRightLeft, Gift, Lightbulb, AlertCircle } from 'lucide-react';
import { NumberInput } from './NumberInput';
import { localTodayISO, parseISODate } from '../lib/dates';
import { quinzaineWithdrawalTip } from '../lib/finance';
import { formatEUR, frenchDay } from '../lib/format';
import { Modal } from './Modal';
import { canWithdrawOwn } from '../lib/accountOps';
import { isQuickAddInterest } from '../lib/commands/quickAdd';
import { normalizeWishUrl } from '../lib/wishes';
import { Button, Chip, IconButton, SegmentedButton, TextField } from './ui';

/** Choix de la feuille : dépôt, retrait, virement entre deux comptes ou envie d'achat. */
export type QuickAddKind = 'IN' | 'OUT' | 'TRANSFER' | 'WISH';

/** Virement demandé ; la réponse est le refus à afficher, ou `null` s'il est enregistré. */
export interface TransferRequest { sourceId: string; destId: string; amount: number; date: string }

interface QuickAddModalProps {
  open: boolean;
  accounts: SavingsAccount[];
  /** Choix affiché à l'ouverture (« Faire un virement » : TRANSFER) ; dépôt par défaut. */
  initialKind?: QuickAddKind;
  onClose: () => void;
  onSubmit: (accountId: string, amount: number, type: 'IN' | 'OUT', label: string, date: string) => void;
  /** Virement entre deux comptes (commande linkedTransfer, annulable). Sans lui, pas de choix « Virement ». */
  onTransfer?: (request: TransferRequest) => string | null;
  /** « J'ai besoin d'argent : où le prendre ? » : ferme cette feuille et ouvre le retrait guidé. */
  onOpenNeed?: () => void;
  /** Envie d'achat notée à la volée. Sans lui, pas de choix « Envie ». */
  onAddWish?: (wish: Wish) => void;
  /** Catégories proposées pour l'envie (la première par défaut). */
  wishCategories?: string[];
}

type Direction = 'IN' | 'OUT';
const LAST_ACCOUNT_KEY = 'quickadd_last_account';
const KINDS: { value: QuickAddKind; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'IN', label: 'Dépôt', icon: ArrowUpCircle },
  { value: 'OUT', label: 'Retrait', icon: ArrowDownCircle },
  { value: 'TRANSFER', label: 'Virement', icon: ArrowRightLeft },
  { value: 'WISH', label: 'Envie', icon: Gift },
];
const SUGGESTIONS: Record<Direction, string[]> = {
  IN: ['Virement de paie', 'Épargne du mois', 'Intérêts', 'Cadeau'],
  OUT: ['Retrait', 'Dépense imprévue', 'Projet'],
};

/** Libellés récents : combien en proposer en tête des puces. */
const RECENT_COUNT = 3;

/** Libellé déjà utilisé sur le compte, avec le dernier montant qui l'accompagnait. */
interface RecentLabel { label: string; amount: number }

/**
 * Les trois derniers libellés distincts (sans tenir compte des majuscules) des dépôts ou des
 * retraits du compte, du plus récent au plus ancien, chacun avec son dernier montant. Seuls
 * les vrais versements comptent : ni virements entre comptes, ni valorisations, corrections,
 * part des parents ou mouvement de départ.
 */
export const recentLabels = (account: SavingsAccount | undefined, dir: Direction): RecentLabel[] => {
  const real = (account?.movements ?? [])
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.type === dir && !m.kind && !m.tag && !m.linkId && m.label.trim() !== '' && m.amount > 0)
    // Plus récent d'abord ; à date égale, le dernier saisi.
    .sort((a, b) => b.m.date.localeCompare(a.m.date) || b.i - a.i);
  const seen = new Set<string>();
  const out: RecentLabel[] = [];
  for (const { m } of real) {
    const key = m.label.trim().toLocaleLowerCase('fr');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: m.label.trim(), amount: m.amount });
    if (out.length === RECENT_COUNT) break;
  }
  return out;
};

/** Puces de 32 px, zone tactile de 48 px (Material 3). */
const CHIP_TARGET = 'relative after:absolute after:inset-x-0 after:-inset-y-2';

export const QuickAddModal: React.FC<QuickAddModalProps> = ({ open, accounts, initialKind = 'IN', onClose, onSubmit, onTransfer, onOpenNeed, onAddWish, wishCategories = [] }) => {
  const [accountId, setAccountId] = useState('');
  const [destId, setDestId] = useState('');
  const [amount, setAmount] = useState(0);
  // Ouverte sur « Envie » : le choix est là dès le premier affichage (le focus va sur le nom).
  const [type, setType] = useState<QuickAddKind>(initialKind === 'WISH' && onAddWish ? 'WISH' : 'IN');
  // Envie : nom, prix (vide = à compléter), lien, catégorie.
  const [wishName, setWishName] = useState('');
  const [wishPrice, setWishPrice] = useState(Number.NaN);
  const [wishUrl, setWishUrl] = useState('');
  const [wishCategory, setWishCategory] = useState('');
  const [wishUrlError, setWishUrlError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(localTodayISO());
  // Virement refusé par la commande : la raison reste écrite dans la feuille.
  const [transferError, setTransferError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // Un virement demande deux comptes.
  const canTransfer = !!onTransfer && accounts.length >= 2;
  const canWish = !!onAddWish;
  const kinds = KINDS.filter(k => (k.value !== 'TRANSFER' || canTransfer) && (k.value !== 'WISH' || canWish));
  const transfer = type === 'TRANSFER';
  const wish = type === 'WISH';
  // Sens d'un dépôt ou d'un retrait (libellés proposés) ; sans objet pour un virement ou une envie.
  const dir: Direction = type === 'OUT' ? 'OUT' : 'IN';

  // Chaque ouverture repart d'un formulaire propre, sur le dernier compte utilisé (les
  // comptes ont pu être créés depuis le montage).
  useEffect(() => {
    if (!open) return;
    const last = lsGet(LAST_ACCOUNT_KEY) || '';
    setAccountId(accounts.some(a => a.id === last) ? last : accounts[0]?.id || '');
    setDestId('');
    setAmount(0);
    setType((initialKind === 'TRANSFER' && !canTransfer) || (initialKind === 'WISH' && !canWish) ? 'IN' : initialKind);
    setWishName('');
    setWishPrice(Number.NaN);
    setWishUrl('');
    setWishCategory(wishCategories[0] ?? '');
    setWishUrlError(null);
    setLabel('');
    setDate(localTodayISO());
    setTransferError(null);
    // Les catégories ne sont lues qu'à l'ouverture : une mise à jour en cours de saisie ne l'efface pas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accounts, initialKind, canTransfer, canWish]);

  // Choisir « Envie » : le clavier s'ouvre tout de suite sur le nom.
  useEffect(() => { if (open && type === 'WISH') nameRef.current?.focus(); }, [open, type]);

  const account = accounts.find(a => a.id === accountId);
  // Puces : les libellés récents de ce compte d'abord, puis les fixes (sans doublon).
  const recents = React.useMemo(() => recentLabels(account, dir), [account, dir]);
  const chips = React.useMemo(() => {
    const taken = new Set(recents.map(r => r.label.toLocaleLowerCase('fr')));
    return [...recents, ...SUGGESTIONS[dir].filter(l => !taken.has(l.toLocaleLowerCase('fr'))).map(l => ({ label: l, amount: 0 }))];
  }, [recents, dir]);
  const tip = open && type === 'OUT' && account ? quinzaineWithdrawalTip(account, amount, parseISODate(date)) : null;
  const since = parseISODate(date).getDate() < 16 ? '1er' : '16';
  // Montant repris d'un libellé récent. Le champ, s'il a le focus, garde sa saisie brute : on le
  // quitte d'abord (sa validation passe avant), puis la nouvelle valeur s'affiche.
  const prefillAmount = (value: number) => {
    if (amountRef.current && document.activeElement === amountRef.current) amountRef.current.blur();
    setAmount(value);
  };
  // Un retrait, comme un virement, ne prend que sur votre part du compte (de départ).
  const tooMuch = (type === 'OUT' || transfer) && !!account && amount > 0 && !canWithdrawOwn(account, amount);
  const canSubmit = wish ? wishName.trim() !== ''
    : !!accountId && amount > 0 && !tooMuch && (!transfer || (!!destId && destId !== accountId));
  // Bouton grisé : la raison est écrite sous le bouton et lui est reliée (un montant trop
  // élevé est déjà expliqué sous le champ « Montant »).
  const verb = transfer ? 'enregistrer' : 'ajouter';
  const whyDisabled = wish ? (wishName.trim() === '' ? "Donnez un nom à l'envie pour pouvoir l'ajouter." : null)
    : !accountId ? `Choisissez un compte pour pouvoir ${verb}.`
    : transfer && !destId ? "Choisissez le compte d'arrivée pour pouvoir enregistrer."
      : !(amount > 0) ? `Indiquez un montant pour pouvoir ${verb}.` : null;
  // Saisie commencée : un toucher sur le voile ne doit pas l'effacer.
  const dirty = wish ? wishName.trim() !== '' || wishUrl.trim() !== '' || wishPrice > 0
    : amount > 0 || label.trim() !== '' || (transfer && destId !== '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (wish) {
      const url = wishUrl.trim() ? normalizeWishUrl(wishUrl) : undefined;
      if (wishUrl.trim() && !url) { setWishUrlError('Le lien doit commencer par http:// ou https://.'); return; }
      // Prix facultatif : sans prix, l'envie reste « à compléter » (pas de date de prix non plus).
      const added: Wish = { id: crypto.randomUUID(), name: wishName.trim(), category: wishCategory || wishCategories[0] || '' };
      if (wishPrice > 0) { added.price = wishPrice; added.priceDate = localTodayISO(); }
      if (url) added.url = url;
      onAddWish?.(added);
      onClose();
      return;
    }
    lsSet(LAST_ACCOUNT_KEY, accountId);
    if (transfer) {
      const refused = onTransfer?.({ sourceId: accountId, destId, amount, date }) ?? null;
      if (refused) { setTransferError(refused); return; }
    } else {
      onSubmit(accountId, amount, dir, label.trim() || (dir === 'IN' ? 'Dépôt' : 'Retrait'), date);
    }
    onClose();
  };

  // Compte du mouvement ; pour un virement, le compte d'arrivée part vide et ne peut pas
  // être le compte de départ.
  const accountSelect = (fieldLabel: string, value: string, onChange: (v: string) => void, excludedId?: string) => (
    <TextField
      label={fieldLabel}
      render={p => (
        <select id={p.id} className={p.className} value={value} onChange={e => { setTransferError(null); onChange(e.target.value); }}>
          {excludedId !== undefined && <option value="">Choisir un compte</option>}
          {accounts.map(a => <option key={a.id} value={a.id} disabled={a.id === excludedId}>{a.name}</option>)}
        </select>
      )}
    />
  );

  return (
    <Modal open={open} onClose={onClose} label="Ajouter un mouvement" variant="sheet" className="max-w-md p-6" initialFocusRef={initialKind === 'WISH' ? nameRef : amountRef} closeOnScrim={!dirty}>
      <form onSubmit={submit} noValidate>
        <div className="flex items-center justify-between gap-2 mb-5">
          <h2 className="min-w-0 hyphens-auto break-words text-2xl font-normal text-on-surface">Ajouter un mouvement</h2>
          <IconButton icon={X} label="Fermer" onClick={onClose} className="-mr-3" />
        </div>

        <div className="space-y-5">
          {/* Texte agrandi (html { font-size: 200% }) : la largeur de la feuille, comptée en rem
              (requête de conteneur), tombe sous 19 rem et les quatre choix passent en grille de
              2 colonnes, chacun en pilule. Au texte normal, un écran d'au moins 360 px offre plus de
              19 rem : rien ne change. */}
          <div className="@container">
            <SegmentedButton
              label="Type de mouvement" options={kinds} value={type} onChange={k => { setTransferError(null); setType(k); }}
              className="w-full [&>button]:flex-1 [&>button]:px-2 max-sm:[&>button]:h-12 max-[359px]:[&>button]:px-1 max-[359px]:[&>button]:text-xs max-[359px]:[&>button>svg]:hidden @max-[19rem]:min-[360px]:grid @max-[19rem]:min-[360px]:grid-cols-2 @max-[19rem]:min-[360px]:gap-2 @max-[19rem]:min-[360px]:rounded-none @max-[19rem]:min-[360px]:border-0 @max-[19rem]:min-[360px]:overflow-visible @max-[19rem]:min-[360px]:[&>button]:rounded-full @max-[19rem]:min-[360px]:[&>button]:border @max-[19rem]:min-[360px]:[&>button]:border-outline"
            />
          </div>
          {/* Retrait guidé : un lien sous les choix, pas un choix de plus. Sous 360 px, les quatre choix perdent leur icône pour tenir. */}
          {onOpenNeed && !wish && (
            <button type="button" onClick={onOpenNeed} className="-mt-2 min-h-12 text-sm font-medium text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary text-left">
              J'ai besoin d'argent : où le prendre ?
            </button>
          )}

          {wish ? (<>
            <TextField
              label="Nom"
              render={p => (
                <input id={p.id} ref={nameRef} className={p.className} value={wishName} onChange={e => setWishName(e.target.value)}
                  placeholder="Aspirateur robot, un roman…" autoComplete="off" enterKeyHint="next" />
              )}
            />
            <TextField label="Prix (facultatif)" supporting="Sans prix, l'envie reste à compléter plus tard." render={p => (
              <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={wishPrice} onChange={setWishPrice} min={0} suffix="€" placeholder="0,00" className={`${p.className} tabular-nums`} />
            )} />
            <TextField label="Lien (facultatif)" type="url" inputMode="url" value={wishUrl} onChange={e => { setWishUrl(e.target.value); setWishUrlError(null); }}
              placeholder="https://…" autoComplete="off" error={wishUrlError ?? undefined} />
            {wishCategories.length > 0 && (
              <div>
                <p id="quick-wish-category" className="block text-sm font-medium text-on-surface-variant mb-1.5">Catégorie</p>
                <div role="group" aria-labelledby="quick-wish-category" className="flex flex-wrap gap-x-2 gap-y-4 py-1">
                  {wishCategories.map(c => (
                    <Chip key={c} selected={wishCategory === c} className={CHIP_TARGET} onClick={() => setWishCategory(c)}>{c}</Chip>
                  ))}
                </div>
              </div>
            )}
          </>) : transfer ? (<>
            {accountSelect('Compte de départ', accountId, v => { setAccountId(v); if (v === destId) setDestId(''); })}
            {accountSelect("Compte d'arrivée", destId, setDestId, accountId)}
          </>) : accountSelect('Compte', accountId, setAccountId)}

          {!wish && <div>
            <TextField
              label="Montant"
              error={!tooMuch ? undefined : account!.parentalCapital > 0
                ? `Votre part sur ce compte est de ${formatEUR(account!.ownedAmount)} : la part de vos parents ne peut pas être retirée.`
                : `Le solde de ce compte est de ${formatEUR(account!.ownedAmount)} : impossible de retirer davantage.`}
              render={p => (
                <NumberInput id={p.id} inputRef={amountRef} value={amount} onChange={setAmount} suffix="€" min={0}
                  describedBy={p.describedBy} invalid={p.invalid} className={`${p.className} text-2xl tabular-nums`} />
              )}
            />
            {tip && (
              <p className="mt-2 text-sm rounded-xl p-3 flex items-start gap-2 bg-tertiary-container text-on-tertiary-container">
                <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Retiré à cette date, ce montant ne rapporte déjà plus rien depuis le {since}. En attendant le {frenchDay(parseISODate(tip.waitUntil))}, vous gardez environ {formatEUR(tip.gain, 0)} d'intérêts.</span>
              </p>
            )}
          </div>}

          {!transfer && !wish && <div>
            <TextField label="Libellé (facultatif)" value={label} onChange={e => setLabel(e.target.value)} placeholder={SUGGESTIONS[dir][0]} />
            <div role="group" aria-label="Libellés proposés" className="flex flex-wrap gap-x-2 gap-y-4 mt-3 py-1">
              {chips.map(sug => (
                <Chip key={sug.label} selected={label === sug.label} className={CHIP_TARGET}
                  // Un libellé récent reprend aussi son dernier montant (modifiable).
                  onClick={() => { if (label === sug.label) { setLabel(''); return; } setLabel(sug.label); if (sug.amount > 0) { prefillAmount(sug.amount); } }}>{sug.label}</Chip>
              ))}
            </div>
            {isQuickAddInterest({ type: dir, label }) && (
              <p className="mt-2 text-sm text-on-surface-variant">Compté comme intérêts : hors épargne (ni « Placé », ni taux d'épargne).</p>
            )}
          </div>}

          {!wish && <TextField label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />}
        </div>

        {transferError && (
          <p role="alert" className="mt-5 bg-error-container text-on-error-container p-3 rounded-xl text-sm font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> {transferError}
          </p>
        )}
        <Button type="submit" disabled={!canSubmit} aria-describedby={whyDisabled ? 'quick-add-why' : undefined} className="w-full mt-6 h-12!">{transfer ? 'Enregistrer le virement' : 'Ajouter'}</Button>
        {whyDisabled && <p id="quick-add-why" className="mt-2 text-sm text-on-surface-variant text-center">{whyDisabled}</p>}
      </form>
    </Modal>
  );
};
