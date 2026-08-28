import React from 'react';
import { LayoutDashboard, ArrowRightLeft, Wallet, ShieldCheck, MoreHorizontal, X } from 'lucide-react';

interface BottomNavProps {
  view: string;
  setView: (v: any) => void;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  moreItems: { key: string; label: string; icon: React.ComponentType<any> }[];
}

const TabButton = ({ active, onClick, icon: Icon, label }: any) => (
  <button onClick={onClick} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2">
    <Icon className={`w-5 h-5 ${active ? 'text-indigo-600' : 'text-slate-400 dark:text-slate-500'}`} />
    <span className={`text-[10px] font-bold ${active ? 'text-indigo-600' : 'text-slate-400 dark:text-slate-500'}`}>{label}</span>
  </button>
);

export const BottomNav: React.FC<BottomNavProps> = ({ view, setView, moreOpen, setMoreOpen, moreItems }) => {
  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex pb-[env(safe-area-inset-bottom)]">
        <TabButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={LayoutDashboard} label="Dashboard" />
        <TabButton active={view === 'transfers'} onClick={() => setView('transfers')} icon={ArrowRightLeft} label="Virements" />
        <TabButton active={view === 'accounts'} onClick={() => setView('accounts')} icon={Wallet} label="Comptes" />
        <TabButton active={view === 'pilot'} onClick={() => setView('pilot')} icon={ShieldCheck} label="Pilotage" />
        <TabButton active={moreOpen} onClick={() => setMoreOpen(true)} icon={MoreHorizontal} label="Plus" />
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={() => setMoreOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="font-black text-slate-800 dark:text-slate-100">Plus d'options</h3>
              <button onClick={() => setMoreOpen(false)} aria-label="Fermer le menu" className="p-2.5 -m-1.5 text-slate-400 dark:text-slate-500"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {moreItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => { setView(item.key); setMoreOpen(false); }}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl ${view === item.key ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[11px] font-bold text-center">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
