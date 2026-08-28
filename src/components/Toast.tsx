import React, { useCallback, useState } from 'react';
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
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0 z-[60] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-bold animate-in slide-in-from-bottom-2 ${
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
