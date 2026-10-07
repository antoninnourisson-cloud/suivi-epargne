// Carte « À faire » de l'accueil : un seul modèle pour toutes les alertes (une phrase, une
// action principale, « Plus tard »), les deux plus importantes d'abord, le reste derrière
// « Voir tout ».
import React, { useState } from 'react';
import { ChevronDown, Clock, ListTodo } from 'lucide-react';
import { Button, Card, Chip } from './ui';

export interface TodoSpec {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  /** 'action' = à traiter ; 'info' = à savoir. */
  tone: 'action' | 'info';
  text: React.ReactNode;
  detail?: React.ReactNode;
  primary?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  /** Contenu déplié sous l'alerte (ex. éditeur de taux). */
  extra?: React.ReactNode;
  /** Masque l'alerte 7 jours. Absent = pas de « Plus tard » (l'alerte a sa propre sortie). */
  snoozable?: boolean;
}

const SNOOZE_KEY = 'todo_snoozed';
const SHOWN_BY_DEFAULT = 2;
const readSnoozed = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}'); } catch { return {}; } };

export const TodoList: React.FC<{ items: TodoSpec[] }> = ({ items }) => {
  const [snoozed, setSnoozed] = useState(readSnoozed);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('todo_open') !== '0'; } catch { return true; } });
  const now = Date.now();
  const visible = items.filter(i => !(snoozed[i.key] > now));
  if (visible.length === 0) return null;
  // Actions avant informations.
  const sorted = [...visible].sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'action' ? -1 : 1));
  const shown = showAll ? sorted : sorted.slice(0, SHOWN_BY_DEFAULT);

  const snooze = (key: string) => {
    const next = { ...snoozed, [key]: now + 7 * 86_400_000 };
    setSnoozed(next);
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch { /* non mémorisé */ }
  };
  const toggle = () => setOpen(o => { try { localStorage.setItem('todo_open', o ? '0' : '1'); } catch { /* idem */ } return !o; });
  const count = `${visible.length} élément${visible.length > 1 ? 's' : ''}`;

  return (
    <Card variant="filled" padding="none" aria-labelledby="todo-title">
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls="todo-list" className="w-full flex items-center justify-between gap-3 px-5 py-4 sm:px-6 text-left rounded-2xl hover:bg-on-surface/4 transition-colors">
        <span className="flex items-center gap-2 min-w-0">
          <ListTodo className="w-5 h-5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
          <span id="todo-title" className="text-base font-medium text-on-surface">À faire</span>
          <span className="min-w-6 h-6 px-2 rounded-full bg-primary text-on-primary text-xs font-medium tabular-nums inline-flex items-center justify-center">
            <span aria-hidden="true">{visible.length}</span>
            <span className="sr-only">{count}</span>
          </span>
        </span>
        <ChevronDown className={`w-5 h-5 shrink-0 text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div id="todo-list" className="px-3 pb-3 sm:px-4 sm:pb-4">
          <ul className="space-y-2">
            {shown.map(item => {
              const isAction = item.tone === 'action';
              return (
                <li key={item.key} className="p-4 rounded-xl bg-surface-container-lowest dark:bg-surface-container-low text-sm">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${isAction ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-high text-on-surface-variant'}`}>
                      <item.icon className="w-[18px] h-[18px]" aria-hidden="true" />
                    </span>
                    <div className="flex-1 min-w-48 pt-1.5">
                      <p className="font-medium text-on-surface">{item.text}</p>
                      {item.detail && <p className="text-xs mt-1 text-on-surface-variant">{item.detail}</p>}
                    </div>
                  </div>
                  {(item.primary || item.secondary || item.snoozable) && (
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      {item.snoozable && <Chip kind="suggestion" icon={Clock} onClick={() => snooze(item.key)}>Plus tard</Chip>}
                      {item.secondary && <Button variant="text" onClick={item.secondary.onClick}>{item.secondary.label}</Button>}
                      {item.primary && <Button variant="tonal" onClick={item.primary.onClick}>{item.primary.label}</Button>}
                    </div>
                  )}
                  {item.extra && <div className="mt-3">{item.extra}</div>}
                </li>
              );
            })}
          </ul>
          {sorted.length > SHOWN_BY_DEFAULT && (
            <div className="mt-2 flex justify-center">
              <Button variant="text" onClick={() => setShowAll(s => !s)} aria-expanded={showAll}>
                {showAll ? 'Voir moins' : `Voir tout (${sorted.length})`}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
