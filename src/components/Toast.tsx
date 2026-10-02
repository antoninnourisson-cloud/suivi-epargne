import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, X, AlertCircle } from 'lucide-react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  kind?: 'success' | 'error' | 'info';
  action?: ToastAction;
  durationMs?: number;
}

export const useToasts = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID();
    const duration = toast.durationMs ?? (toast.action ? 6000 : 3000);
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  return { toasts, addToast, dismiss };
};

export const ToastContainer: React.FC<{ toasts: ToastItem[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => {
  // La zone existe toujours (même vide) : les lecteurs d'écran n'annoncent que ce qui
  // apparaît dans une zone « live » déjà présente. Sur mobile, au-dessus de la barre du bas.
  return (
    <div role="status" aria-live="polite" className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0 z-[60] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : undefined}
          className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-bold animate-in slide-in-from-bottom-2 ${
            t.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          }`}
        >
          {t.kind === 'error' ? <AlertCircle className="w-4 h-4 flex-shrink-0" /> : <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />}
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              onClick={() => { t.action!.onClick(); onDismiss(t.id); }}
              className="text-indigo-300 dark:text-indigo-600 hover:underline flex-shrink-0"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => onDismiss(t.id)} aria-label="Fermer la notification" className="p-2 -m-1 opacity-60 hover:opacity-100 flex-shrink-0"><X className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
};

// Accès aux toasts depuis n'importe quel écran (fourni par App).
type AddToast = (toast: Omit<ToastItem, 'id'>) => string;
export const ToastContext = createContext<AddToast | null>(null);
export const useToast = () => useContext(ToastContext);

type ListSetter<T> = React.Dispatch<React.SetStateAction<T[]>>;

/**
 * Suppression annulable : l'élément disparaît tout de suite, un toast « Annuler » le remet
 * à sa place pendant 6 s. La restauration part de l'état COURANT (mise à jour
 * fonctionnelle) : une autre modification faite entre-temps n'est pas écrasée.
 */
export const useUndoableRemove = () => {
  const addToast = useContext(ToastContext);
  return useCallback(<T extends { id: string }>(list: T[], item: T, set: ListSetter<T>, message: string) => {
    const index = list.findIndex(x => x.id === item.id);
    set(prev => prev.filter(x => x.id !== item.id));
    addToast?.({
      message,
      kind: 'success',
      action: {
        label: 'Annuler',
        onClick: () => set(prev => prev.some(x => x.id === item.id)
          ? prev
          : [...prev.slice(0, Math.max(0, index)), item, ...prev.slice(Math.max(0, index))]),
      },
    });
  }, [addToast]);
};
