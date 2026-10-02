// Navigation mobile : quatre onglets et un panneau « Plus » regroupé par zones.
import React from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { NAV_ITEMS, NAV_SECTIONS, NavItem, View } from '../navigation';
import { Modal } from './Modal';

interface BottomNavProps {
  view: View;
  setView: (v: View) => void;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  /** Écrans masqués (ex. part parentale en mode solo). */
  hidden?: View[];
}

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: NavItem['icon']; label: string; current?: boolean }> = ({ active, onClick, icon: Icon, label, current }) => (
  <button onClick={onClick} aria-current={current ? 'page' : undefined} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[52px]">
    <Icon className={`w-5 h-5 ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`} />
    <span className={`text-[11px] font-bold ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}>{label}</span>
  </button>
);

export const BottomNav: React.FC<BottomNavProps> = ({ view, setView, moreOpen, setMoreOpen, hidden = [] }) => {
  const items = NAV_ITEMS.filter(i => !hidden.includes(i.key));
  const tabs = items.filter(i => i.tab);
  const more = items.filter(i => !i.tab);
  const inMore = more.some(i => i.key === view);
  const go = (v: View) => { setView(v); setMoreOpen(false); };
  return (
    <>
      <nav aria-label="Navigation principale" className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex pb-[env(safe-area-inset-bottom)]">
        {tabs.map(t => <TabButton key={t.key} active={view === t.key} current={view === t.key} onClick={() => setView(t.key)} icon={t.icon} label={t.short ?? t.label} />)}
        <TabButton active={moreOpen || inMore} onClick={() => setMoreOpen(true)} icon={MoreHorizontal} label="Plus" />
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} label="Plus d'écrans" variant="sheet" className="md:hidden p-4">
        <div className="flex items-center justify-between mb-2 px-2">
          <h2 className="font-black text-slate-800 dark:text-slate-100">Plus d'écrans</h2>
          <button onClick={() => setMoreOpen(false)} aria-label="Fermer le menu" className="p-2.5 -m-1.5 text-slate-500 dark:text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        {[...NAV_SECTIONS, undefined].map(section => {
          const group = more.filter(i => i.section === section);
          if (group.length === 0) return null;
          return (
            <div key={section ?? 'autres'} className="mt-3">
              {section && <p className="px-2 mb-1 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">{section}</p>}
              <div className="grid grid-cols-3 gap-2">
                {group.map(item => (
                  <button
                    key={item.key}
                    onClick={() => go(item.key)}
                    aria-current={view === item.key ? 'page' : undefined}
                    className={`flex flex-col items-center gap-2 p-3 rounded-2xl min-h-[72px] ${view === item.key ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
                  >
                    <item.icon className="w-5 h-5" />
                    <span className="text-[11px] font-bold text-center leading-tight">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </Modal>
    </>
  );
};
