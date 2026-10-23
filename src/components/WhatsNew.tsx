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
import { Button, IconButton } from './ui';
import { SEEN_VERSION_KEY } from './whatsNewGate';

const SEEN_KEY = SEEN_VERSION_KEY;

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
    <p className="text-sm font-medium text-on-surface">{e.title}</p>
    <p className="text-xs text-on-surface-variant mb-1">{parseISODate(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <ul className="list-disc pl-5 space-y-1 text-sm text-on-surface-variant">
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
        <h2 className="text-[22px] leading-7 font-normal text-on-surface flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" aria-hidden="true" /> Quoi de neuf</h2>
        <IconButton label="Fermer" icon={X} onClick={close} className="-my-2 -mr-2" />
      </div>
      <div className="space-y-5">{entries.map(e => <EntryBlock key={e.version} e={e} />)}</div>
      <Button variant="filled" className="mt-6 w-full" onClick={close}>C'est noté</Button>
    </Modal>
  );
};

