// Feuille « Catégories » des envies : ajouter, renommer, retirer. Une catégorie qui a encore
// des envies (à acheter ou achetées) ne se retire qu'en les déplaçant dans une autre.
import React, { useRef, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Modal } from '../Modal';
import { Button, IconButton, TextField } from '../ui';

interface WishCategoriesSheetProps {
  categories: string[];
  /** Nombre d'envies de chaque catégorie (achetées comprises). */
  counts: Record<string, number>;
  /** Chaque action renvoie le refus à afficher, ou `null` si elle est faite. */
  onAdd: (name: string) => string | null;
  onRename: (from: string, to: string) => string | null;
  /** `moveTo` : catégorie qui reçoit les envies de celle qu'on retire. */
  onRemove: (name: string, moveTo?: string) => string | null;
  onClose: () => void;
}

const envies = (n: number) => `${n} envie${n > 1 ? 's' : ''}`;

export const WishCategoriesSheet: React.FC<WishCategoriesSheetProps> = ({ categories, counts, onAdd, onRename, onRemove, onClose }) => {
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<{ name: string; text: string } | null>(null);
  const [removing, setRemoving] = useState<{ name: string; target: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const backToTitle = () => requestAnimationFrame(() => headingRef.current?.focus());

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const refused = onAdd(adding);
    setError(refused);
    if (!refused) setAdding('');
  };
  const saveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const refused = onRename(editing.name, editing.text);
    setError(refused);
    if (!refused) { setEditing(null); backToTitle(); }
  };
  const startRemove = (name: string) => {
    setError(null);
    if ((counts[name] ?? 0) === 0) { onRemove(name); backToTitle(); return; }
    setRemoving({ name, target: categories.find(c => c !== name) ?? '' });
  };
  const confirmRemove = () => {
    if (!removing) return;
    const refused = onRemove(removing.name, removing.target);
    setError(refused);
    if (!refused) { setRemoving(null); backToTitle(); }
  };

  return (
    <Modal open onClose={onClose} label="Catégories des envies" variant="sheet" closeOnScrim={false} className="sm:max-w-lg p-4 sm:p-6">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-normal text-on-surface outline-none">Catégories</h2>
        <IconButton icon={X} label="Fermer" onClick={onClose} className="-mr-3 -mt-2" />
      </div>
      <p className="text-sm text-on-surface-variant mb-2">Renommer une catégorie la change aussi pour ses envies.</p>

      <ul aria-label="Catégories" className="divide-y divide-outline-variant">
        {categories.map(name => (
          <li key={name} className="py-2">
            {editing?.name === name ? (
              <form onSubmit={saveRename} className="space-y-3 py-1">
                <TextField label={`Nouveau nom de ${name}`} value={editing.text} onChange={e => { setEditing({ name, text: e.target.value }); setError(null); }} autoComplete="off" />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="text" onClick={() => { setEditing(null); setError(null); }} className="max-sm:h-12">Annuler</Button>
                  <Button type="submit" className="max-sm:h-12"><Check className="w-4 h-4" aria-hidden="true" /> Enregistrer</Button>
                </div>
              </form>
            ) : removing?.name === name ? (
              <div className="space-y-3 py-1">
                <p className="text-sm text-on-surface">« {name} » a encore {envies(counts[name] ?? 0)}. Où les ranger avant de retirer cette catégorie ?</p>
                <TextField label="Déplacer ses envies vers" render={p => (
                  <select id={p.id} className={p.className} value={removing.target} onChange={e => setRemoving({ name, target: e.target.value })}>
                    {categories.filter(c => c !== name).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )} />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="text" onClick={() => setRemoving(null)} className="max-sm:h-12">Annuler</Button>
                  <Button onClick={confirmRemove} className="max-sm:h-12">Déplacer et retirer</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-on-surface break-words">{name}</p>
                  <p className="text-xs text-on-surface-variant">{(counts[name] ?? 0) === 0 ? 'Aucune envie' : envies(counts[name])}</p>
                </div>
                <IconButton icon={Pencil} label={`Renommer ${name}`} onClick={() => { setRemoving(null); setError(null); setEditing({ name, text: name }); }} />
                {categories.length > 1 && <IconButton icon={Trash2} tone="danger" label={`Retirer ${name}`} onClick={() => { setEditing(null); startRemove(name); }} />}
              </div>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="mt-4 flex items-start gap-2">
        <TextField label="Nouvelle catégorie" value={adding} onChange={e => { setAdding(e.target.value); setError(null); }} placeholder="Voyages, cadeaux…" autoComplete="off" className="flex-1" />
        <Button type="submit" variant="tonal" className="mt-7 max-sm:h-12"><Plus className="w-4 h-4" aria-hidden="true" /> Ajouter</Button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-error">{error}</p>}
      <div className="mt-6 flex justify-end">
        <Button onClick={onClose} className="max-sm:h-12">Terminé</Button>
      </div>
    </Modal>
  );
};
