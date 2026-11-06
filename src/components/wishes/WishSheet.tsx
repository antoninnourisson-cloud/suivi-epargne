// Feuille « Nouvelle envie » / « Modifier l'envie » (feuille du bas). Nom et prix obligatoires ;
// lien, date du prix, catégorie et note au choix. Le prix change : sa date repasse à aujourd'hui
// (le prix est alors celui d'aujourd'hui) ; la date reste modifiable à la main.
import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { Wish } from '../../types';
import { localTodayISO } from '../../lib/dates';
import { isValidDay, normalizeWishUrl } from '../../lib/wishes';
import { Modal } from '../Modal';
import { NumberInput } from '../NumberInput';
import { Button, IconButton, TextField } from '../ui';

interface WishSheetProps {
  /** Envie à modifier ; absente : nouvelle envie. */
  wish?: Wish;
  categories: string[];
  /** Catégorie proposée pour une nouvelle envie. */
  defaultCategory?: string;
  onSave: (wish: Wish) => void;
  onClose: () => void;
}

export const WishSheet: React.FC<WishSheetProps> = ({ wish, categories, defaultCategory, onSave, onClose }) => {
  const [name, setName] = useState(wish?.name ?? '');
  const [url, setUrl] = useState(wish?.url ?? '');
  // Nouvelle envie : champ vide (NaN s'affiche vide, la validation exige un prix supérieur à 0).
  const [price, setPrice] = useState(wish?.price ?? Number.NaN);
  const [priceDate, setPriceDate] = useState(wish?.priceDate ?? localTodayISO());
  const [category, setCategory] = useState(wish?.category ?? defaultCategory ?? categories[0] ?? '');
  const [note, setNote] = useState(wish?.note ?? '');
  const [errors, setErrors] = useState<{ name?: string; url?: string; price?: string; priceDate?: string }>({});
  // Une catégorie que la liste ne connaît plus (envie d'un ancien fichier) reste choisissable.
  const options = category && !categories.includes(category) ? [...categories, category] : categories;

  const changePrice = (next: number) => {
    // NumberInput rappelle onChange à la sortie du champ, même sans changement : la date ne bouge que si le prix change.
    if (next === price) return;
    setPrice(next);
    setPriceDate(localTodayISO());
    setErrors(e => ({ ...e, price: undefined, priceDate: undefined }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    const found: typeof errors = {};
    if (!cleanName) found.name = "Donnez un nom à l'envie.";
    const cleanUrl = url.trim() ? normalizeWishUrl(url) : undefined;
    if (url.trim() && !cleanUrl) found.url = 'Le lien doit commencer par http:// ou https://.';
    if (!(price > 0)) found.price = 'Saisissez un prix supérieur à 0.';
    if (!isValidDay(priceDate)) found.priceDate = 'Indiquez le jour où ce prix a été relevé.';
    if (Object.keys(found).length > 0) { setErrors(found); return; }
    const saved: Wish = { ...wish, id: wish?.id ?? crypto.randomUUID(), name: cleanName, price, priceDate, category: category || categories[0] || '' };
    if (cleanUrl) saved.url = cleanUrl; else delete saved.url;
    if (note.trim()) saved.note = note.trim(); else delete saved.note;
    onSave(saved);
  };

  const title = wish ? "Modifier l'envie" : 'Nouvelle envie';

  return (
    <Modal open onClose={onClose} label={title} variant="sheet" closeOnScrim={false} className="sm:max-w-lg p-4 sm:p-6">
      <div className="flex items-start justify-between gap-2 mb-4">
        <h2 className="text-xl font-normal text-on-surface">{title}</h2>
        <IconButton icon={X} label="Fermer" onClick={onClose} className="-mr-3 -mt-2" />
      </div>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField label="Nom" value={name} onChange={e => { setName(e.target.value); setErrors(x => ({ ...x, name: undefined })); }}
          placeholder="Aspirateur robot, un roman…" autoComplete="off" error={errors.name} />
        <TextField label="Prix" error={errors.price} render={p => (
          <NumberInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={price} onChange={changePrice} min={0} suffix="€" placeholder="0,00" className={`${p.className} tabular-nums`} />
        )} />
        <TextField label="Prix relevé le" type="date" value={priceDate} onChange={e => { setPriceDate(e.target.value); setErrors(x => ({ ...x, priceDate: undefined })); }}
          error={errors.priceDate} supporting="Aujourd'hui quand vous changez le prix." />
        <TextField label="Catégorie" render={p => (
          <select id={p.id} className={p.className} value={category} onChange={e => setCategory(e.target.value)}>
            {options.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )} />
        <TextField label="Lien (facultatif)" type="url" inputMode="url" value={url} onChange={e => { setUrl(e.target.value); setErrors(x => ({ ...x, url: undefined })); }}
          placeholder="https://…" autoComplete="off" error={errors.url} />
        <TextField label="Note (facultative)" value={note} onChange={e => setNote(e.target.value)} placeholder="Couleur, taille, où l'acheter…" autoComplete="off" />
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="text" onClick={onClose} className="max-sm:h-12">Annuler</Button>
          <Button type="submit" className="max-sm:h-12">{wish ? 'Enregistrer' : "Ajouter l'envie"}</Button>
        </div>
      </form>
    </Modal>
  );
};
