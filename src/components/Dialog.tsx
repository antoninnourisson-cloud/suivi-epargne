import React, { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';

export interface DialogState {
  open: boolean;
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm?: (value?: string) => void;
}

export const emptyDialog: DialogState = { open: false, kind: 'confirm', title: '' };

export const Dialog: React.FC<{ state: DialogState; onClose: () => void }> = ({ state, onClose }) => {
  const [value, setValue] = useState(state.defaultValue || '');

  useEffect(() => { setValue(state.defaultValue || ''); }, [state.defaultValue, state.open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (state.open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.open, onClose]);

  if (!state.open) return null;

  const confirm = () => {
    state.onConfirm?.(state.kind === 'prompt' ? value : undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
            {state.danger && <AlertTriangle className="w-5 h-5 text-rose-500" />}
            {state.title}
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>
        {state.message && <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{state.message}</p>}
        {state.kind === 'prompt' && (
          <input
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirm()}
            className="w-full p-3 mb-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl font-bold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Annuler</button>
          <button
            onClick={confirm}
            className={`px-4 py-2 rounded-xl font-bold text-sm text-white ${state.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
          >
            {state.confirmLabel || 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
};
