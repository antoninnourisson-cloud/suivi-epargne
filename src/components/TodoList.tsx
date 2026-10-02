// Carte « À faire » de l'accueil : un seul modèle pour toutes les alertes (une phrase, une
// action principale, « Plus tard »), les trois plus importantes d'abord.
import React, { useState } from 'react';
import { ChevronDown, ListTodo } from 'lucide-react';

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
  const shown = showAll ? sorted : sorted.slice(0, 3);

  const snooze = (key: string) => {
    const next = { ...snoozed, [key]: now + 7 * 86_400_000 };
    setSnoozed(next);
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch { /* non mémorisé */ }
  };
  const toggle = () => setOpen(o => { try { localStorage.setItem('todo_open', o ? '0' : '1'); } catch { /* idem */ } return !o; });

  return (
    <section aria-labelledby="todo-title" className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
      <button type="button" onClick={toggle} aria-expanded={open} className="w-full flex items-center justify-between gap-3 p-4 text-left">
        <span id="todo-title" className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-indigo-600" aria-hidden="true" /> À faire
          <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[11px] font-black" aria-label={`${visible.length} élément${visible.length > 1 ? 's' : ''}`}>{visible.length}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="px-4 pb-4 space-y-2">
          {shown.map(item => (
            <li key={item.key} className={`p-3 rounded-xl border text-sm ${item.tone === 'action' ? 'bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-900' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
              <div className="flex flex-wrap items-start gap-3">
                <item.icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${item.tone === 'action' ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`} aria-hidden="true" />
                <div className="flex-1 min-w-[12rem] text-slate-800 dark:text-slate-100 font-bold">
                  {item.text}
                  {item.detail && <span className="block font-normal text-xs mt-1 text-slate-600 dark:text-slate-300">{item.detail}</span>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {item.secondary && <button onClick={item.secondary.onClick} className="text-xs font-bold text-slate-600 dark:text-slate-300 underline hover:opacity-70 px-1 py-1.5">{item.secondary.label}</button>}
                  {item.snoozable && <button onClick={() => snooze(item.key)} className="text-xs font-bold text-slate-600 dark:text-slate-300 underline hover:opacity-70 px-1 py-1.5">Plus tard</button>}
                  {item.primary && <button onClick={item.primary.onClick} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black">{item.primary.label}</button>}
                </div>
              </div>
              {item.extra && <div className="mt-3">{item.extra}</div>}
            </li>
          ))}
          {sorted.length > 3 && (
            <li>
              <button onClick={() => setShowAll(s => !s)} className="w-full text-center text-xs font-bold text-indigo-700 dark:text-indigo-300 py-2 hover:underline">
                {showAll ? 'Voir moins' : `Voir tout (${sorted.length})`}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
};
