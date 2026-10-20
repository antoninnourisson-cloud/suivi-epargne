import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from './Button';

export interface DialogState {
  open: boolean;
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  // Libellé du bouton qui ferme sans rien faire (défaut « Annuler »), quand « Annuler »
  // prêterait à confusion (ex. « Annuler la restitution »).
  cancelLabel?: string;
  danger?: boolean;
  onConfirm?: (value?: string) => void;
}

export const emptyDialog: DialogState = { open: false, kind: 'confirm', title: '' };

export const Dialog: React.FC<{ state: DialogState; onClose: () => void }> = ({ state, onClose }) => {
  const [value, setValue] = useState(state.defaultValue || '');

  useEffect(() => { setValue(state.defaultValue || ''); }, [state.defaultValue, state.open]);

  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = () => {
    state.onConfirm?.(state.kind === 'prompt' ? value : undefined);
    onClose();
  };

  return (
    // Action dangereuse : le focus part sur « Annuler », jamais sur le bouton qui détruit.
    <Modal open={state.open} onClose={onClose} label={state.title} className="max-w-sm p-6" initialFocusRef={state.danger && state.kind === 'confirm' ? cancelRef : undefined}>
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
            {state.danger && <AlertTriangle className="w-5 h-5 text-rose-500" />}
            {state.title}
          </h2>
          <button onClick={onClose} aria-label="Fermer" className="p-2.5 -m-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>
        {state.message && <p className="text-sm text-on-surface-variant mb-4">{state.message}</p>}
        {state.kind === 'prompt' && (
          <input
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirm()}
            className="w-full p-3 mb-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-hidden"
          />
        )}
        {/* Boutons du kit Material 3 : même forme (pilule) pour les deux actions. */}
        <div className="flex flex-wrap gap-2 justify-end">
          <Button ref={cancelRef} variant="text" onClick={onClose}>{state.cancelLabel || 'Annuler'}</Button>
          <Button variant={state.danger ? 'danger' : 'filled'} onClick={confirm}>{state.confirmLabel || 'Confirmer'}</Button>
        </div>
    </Modal>
  );
};
