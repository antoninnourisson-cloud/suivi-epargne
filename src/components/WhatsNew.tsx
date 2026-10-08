// ================================================
// FILE: src/components/WhatsNew.tsx
// « Quoi de neuf » : affiché UNE fois après une mise à jour (versions non encore vues).
// L'historique complet est dans Paramètres, carte « À propos ».
// ================================================
import React, { useState } from 'react';
import { lsGet, lsSet } from '../lib/storage';
import { CHANGELOG, LATEST_VERSION, ChangelogEntry } from '../changelog';
import { parseISODate } from '../lib/dates';
import { Sparkles, X } from 'lucide-react';
import { Modal } from './Modal';

const SEEN_KEY = 'last_seen_version';

const readSeen = (): string | null => lsGet(SEEN_KEY);
const markSeen = () => lsSet(SEEN_KEY, LATEST_VERSION);

/** Versions publiées depuis la dernière vue (la plus récente seulement au tout premier lancement). */
const unseenEntries = (): ChangelogEntry[] => {
  const seen = readSeen();
  if (seen === LATEST_VERSION) return [];
  if (!seen) return CHANGELOG.slice(0, 1);
  const idx = CHANGELOG.findIndex(e => e.version === seen);
  return idx < 0 ? CHANGELOG.slice(0, 1) : CHANGELOG.slice(0, idx);
};

const EntryBlock: React.FC<{ e: ChangelogEntry }> = ({ e }) => (
  <div>
    <p className="text-sm font-black text-slate-800 dark:text-slate-100">{e.title}</p>
    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">{parseISODate(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
      {e.items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  </div>
);

export const WhatsNewModal: React.FC<{ isNewUser?: boolean }> = ({ isNewUser }) => {
  const [entries, setEntries] = useState<ChangelogEntry[]>(() => {
    // Tout premier lancement : rien de « nouveau » à présenter, on note la version.
    if (isNewUser && !readSeen()) { markSeen(); return []; }
    return unseenEntries();
  });
  const close = () => { markSeen(); setEntries([]); };
  return (
    <Modal open={entries.length > 0} onClose={close} label="Quoi de neuf" variant="sheet" className="max-w-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Sparkles className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Quoi de neuf</h2>
        <button onClick={close} aria-label="Fermer" className="p-2 -m-1 text-slate-500 dark:text-slate-400"><X className="w-5 h-5" /></button>
      </div>
      <div className="space-y-5">{entries.map(e => <EntryBlock key={e.version} e={e} />)}</div>
      <button onClick={close} className="mt-6 w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black">C'est noté</button>
    </Modal>
  );
};

