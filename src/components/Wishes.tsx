// ================================================
// FILE: src/components/Wishes.tsx
// Envies : les achats qu'on envisage (nom, lien, prix du moment), rangés par catégorie. Une
// phrase compare le total à ce qu'on peut dépenser sans toucher à l'épargne de précaution
// (même notion que « J'ai besoin d'argent », lib/needMoney). Rien ici ne modifie les soldes :
// « Je l'achète » ouvre « J'ai besoin d'argent » prérempli, et l'envie passe dans « Achetées »
// seulement si ce parcours se termine par un retrait enregistré ou prévu.
// ================================================
import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Gift, Pencil, Plus, ShoppingBag, Tags, Trash2, Undo2 } from 'lucide-react';
import type { Wish } from '../types';
import type { EmergencyFund } from '../lib/planning';
import { localTodayISO, parseISODate } from '../lib/dates';
import { frenchDay } from '../lib/format';
import { spendableBeyondPrecaution } from '../lib/needMoney';
import {
  addWishCategory, boughtWishes, groupWishes, markWishBought, moveWishes, openWishes, removeWishCategory, renameWishCategory, restoreWish,
  stalePriceNote, wishCategoriesOf, wishCountIn, wishesToComplete, wishesTotal,
} from '../lib/wishes';
import { useUndoableRemove } from './Toast';
import { focusAfterRemoval } from './focusAfterRemoval';
import type { NeedPrefill } from './need/NeedMoneySheet';
import { WishSheet } from './wishes/WishSheet';
import { WishCategoriesSheet } from './wishes/WishCategoriesSheet';
import { Button, Card, EmptyState, IconButton, ListItem, MoneyText, PageHeader } from './ui';

interface WishesProps {
  wishes: Wish[];
  /** Catégories du fichier ; absentes : les catégories par défaut. */
  categories: string[] | undefined;
  onUpdateWishes: React.Dispatch<React.SetStateAction<Wish[]>>;
  onUpdateCategories: (categories: string[]) => void;
  /** Jauge de précaution de l'Accueil (useDerivedData) : absente sans dépenses connues. */
  emergency: EmergencyFund | null;
  /** « Je l'achète » : ouvre « J'ai besoin d'argent » avec ce montant et ce nom. */
  onBuy: (prefill: NeedPrefill) => void;
}

/** « amazon.fr » : le site d'un lien, pour dire où il mène. */
const siteOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

export const Wishes: React.FC<WishesProps> = ({ wishes, categories, onUpdateWishes, onUpdateCategories, emergency, onBuy }) => {
  const [sheet, setSheet] = useState<{ wish?: Wish } | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [boughtOpen, setBoughtOpen] = useState(false);
  const removeWithUndo = useUndoableRemove();
  const listRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const cats = wishCategoriesOf(categories);
  const today = new Date();
  const groups = useMemo(() => groupWishes(wishes, wishCategoriesOf(categories)), [wishes, categories]);
  const bought = useMemo(() => boughtWishes(wishes), [wishes]);
  const open = openWishes(wishes);
  const total = wishesTotal(open);
  // Envies notées sans prix : hors du total, à compléter.
  const unpriced = wishesToComplete(wishes);
  const hasPriced = open.length > unpriced;
  const spendable = spendableBeyondPrecaution(emergency);
  const counts = useMemo(() => Object.fromEntries(wishCategoriesOf(categories).map(c => [c, wishCountIn(wishes, c)])), [wishes, categories]);

  const save = (wish: Wish) => {
    onUpdateWishes(list => (list.some(w => w.id === wish.id) ? list.map(w => (w.id === wish.id ? wish : w)) : [...list, wish]));
    setSheet(null);
  };

  // Le focus va sur l'envie voisine, sinon sur « Ajouter une envie » (WCAG 2.4.3).
  const remove = (wish: Wish) => {
    const index = [...groups.flatMap(g => g.wishes), ...bought].findIndex(w => w.id === wish.id);
    removeWithUndo(wishes, wish, onUpdateWishes, `Envie « ${wish.name} » supprimée`);
    focusAfterRemoval(() => listRef.current, index, () => addButtonRef.current);
  };

  const buy = (wish: Wish, price: number) => onBuy({
    amount: price,
    label: wish.name,
    // Retrait enregistré ou prévu : l'envie passe dans « Achetées », avec la date du jour et son prix.
    onDone: paid => onUpdateWishes(list => markWishBought(list, wish.id, localTodayISO(), Number.isFinite(paid) && paid > 0 ? paid : price)),
  });

  // --- Catégories : le refus (texte) est rendu à la feuille, sinon `null` ---
  const addCategory = (name: string): string | null => {
    const r = addWishCategory(cats, name);
    if (!r.ok) return r.error;
    onUpdateCategories(r.categories);
    return null;
  };
  const renameCategory = (from: string, to: string): string | null => {
    const r = renameWishCategory(cats, from, to);
    if (!r.ok) return r.error;
    const name = to.trim();
    onUpdateCategories(r.categories);
    if (name !== from) onUpdateWishes(list => moveWishes(list, from, name));
    return null;
  };
  const removeCategory = (name: string, moveTo?: string): string | null => {
    const r = removeWishCategory(cats, name, wishCountIn(wishes, name), moveTo);
    if (!r.ok) return r.error;
    onUpdateCategories(r.categories);
    if (moveTo) onUpdateWishes(list => moveWishes(list, name, moveTo));
    return null;
  };

  const addButton = (
    <Button ref={addButtonRef} onClick={() => setSheet({})} className="max-sm:h-12"><Plus className="w-4 h-4" aria-hidden="true" /> Ajouter une envie</Button>
  );
  const hasWishes = wishes.length > 0;

  const wishRow = (w: Wish) => {
    const stale = stalePriceNote(w.priceDate, today);
    const price = w.price;
    return (
      <ListItem
        key={w.id}
        className="px-4 sm:px-6"
        headline={w.name}
        supporting={(w.note || w.url || stale) ? <>
          {w.note && <span className="block">{w.note}</span>}
          {w.url && (
            <a href={w.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-12 sm:min-h-8 font-medium text-primary underline underline-offset-2 hover:no-underline">
              Voir sur {siteOf(w.url)}<ExternalLink className="w-3 h-3" aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span>
            </a>
          )}
          {stale && <span className="block">{stale}</span>}
        </> : undefined}
        trailing={price !== undefined ? <MoneyText value={price} /> : <span className="text-sm font-medium text-tertiary">Prix à compléter</span>}
        actions={<>
          {/* Sans prix, rien à retirer : on complète d'abord (crayon). */}
          {price !== undefined && <Button variant="tonal" onClick={() => buy(w, price)} aria-label={`Je l'achète : ${w.name}`} className="max-sm:h-12"><ShoppingBag className="w-4 h-4" aria-hidden="true" /> Je l'achète</Button>}
          <IconButton icon={Pencil} label={`Modifier ${w.name}`} onClick={() => setSheet({ wish: w })} data-focus-after-removal />
          <IconButton icon={Trash2} tone="danger" label={`Supprimer ${w.name}`} onClick={() => remove(w)} />
        </>}
      />
    );
  };

  return (
    <div ref={listRef} className="space-y-6 animate-fade-in pb-20">
      <PageHeader
        title="Envies"
        subtitle="Ce que vous aimeriez acheter un jour. Rien ici ne modifie vos soldes."
        actions={<>
          <Button variant="outlined" onClick={() => setCategoriesOpen(true)} className="max-sm:h-12"><Tags className="w-4 h-4" aria-hidden="true" /> Catégories</Button>
          {hasWishes && addButton}
        </>}
      />

      {open.length > 0 ? (
        <Card variant="filled" aria-label="Vos envies et l'argent disponible">
          <p className="text-base text-on-surface">
            {hasPriced
              ? <>Vos envies : <b className="font-medium"><MoneyText value={total} /></b>{unpriced > 0 && <>, et {unpriced} {unpriced > 1 ? 'envies sans prix' : 'envie sans prix'}</>}.</>
              : <>Vos envies : {unpriced} {unpriced > 1 ? 'envies sans prix' : 'envie sans prix'}.</>}
            {hasPriced && spendable !== null && <> Disponible sans toucher à votre épargne de précaution : <b className="font-medium"><MoneyText value={spendable} /></b>.</>}
          </p>
          {hasPriced && spendable !== null && (
            <p className="mt-1 text-sm text-on-surface-variant">
              {total <= spendable
                ? 'Tout est possible sans toucher à votre épargne de précaution.'
                : <>Il manque <MoneyText value={total - spendable} /> pour tout acheter sans toucher à votre épargne de précaution.</>}
            </p>
          )}
        </Card>
      ) : (
        <Card>
          <EmptyState icon={Gift} title={hasWishes ? "Aucune envie à acheter pour l'instant" : "Aucune envie pour l'instant"} action={addButton}>
            Notez ce que vous aimeriez acheter un jour, avec son prix du moment. Pécule fait le total et le compare à ce que vous pouvez dépenser sans toucher à votre épargne de précaution.
          </EmptyState>
        </Card>
      )}

      {groups.map(g => (
        <Card key={g.category} padding="none" title={g.category} icon={Gift} action={<MoneyText value={g.total} className="text-base font-medium" />} className="pb-1">
          <ul className="divide-y divide-outline-variant" aria-label={`Envies : ${g.category}`}>{g.wishes.map(wishRow)}</ul>
        </Card>
      ))}

      {bought.length > 0 && (
        <section aria-labelledby="wishes-bought-title">
          <h3 id="wishes-bought-title" className="text-base font-medium text-on-surface">
            <button
              type="button" aria-expanded={boughtOpen} aria-controls="wishes-bought-list" onClick={() => setBoughtOpen(o => !o)}
              className="w-full min-h-12 flex items-center justify-between gap-2 rounded-xl px-1 text-left hover:bg-on-surface/8"
            >
              <span>Achetées ({bought.length})</span>
              <ChevronDown className={`w-5 h-5 text-on-surface-variant transition-transform ${boughtOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          </h3>
          <div id="wishes-bought-list" hidden={!boughtOpen}>
            {boughtOpen && (
              <Card padding="none" className="mt-2 pb-1">
                <ul className="divide-y divide-outline-variant" aria-label="Envies achetées">
                  {bought.map(w => (
                    <ListItem
                      key={w.id}
                      className="px-4 sm:px-6"
                      headline={w.name}
                      supporting={<>{w.category} · acheté le <span className="whitespace-nowrap">{frenchDay(parseISODate(w.boughtAt!))}</span></>}
                      trailing={(w.boughtPrice ?? w.price) !== undefined ? <MoneyText value={(w.boughtPrice ?? w.price)!} /> : undefined}
                      actions={<>
                        <Button variant="text" onClick={() => onUpdateWishes(list => restoreWish(list, w.id))} aria-label={`Remettre en envie : ${w.name}`} className="max-sm:h-12" data-focus-after-removal>
                          <Undo2 className="w-4 h-4" aria-hidden="true" /> Remettre en envie
                        </Button>
                        <IconButton icon={Trash2} tone="danger" label={`Supprimer ${w.name}`} onClick={() => remove(w)} />
                      </>}
                    />
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </section>
      )}

      {sheet && <WishSheet wish={sheet.wish} categories={cats} onSave={save} onClose={() => setSheet(null)} />}
      {categoriesOpen && (
        <WishCategoriesSheet categories={cats} counts={counts} onAdd={addCategory} onRename={renameCategory} onRemove={removeCategory} onClose={() => setCategoriesOpen(false)} />
      )}
    </div>
  );
};
