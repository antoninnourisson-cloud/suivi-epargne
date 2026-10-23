// Boîte de dialogue Material 3 (confirmation ou saisie d'un texte) : titre « headline
// small », texte d'explication, actions en bas à droite. Pas de croix : « Annuler », Échap
// ou un clic à côté ferment. Action destructrice : bouton au rôle « error », et le focus part
// sur « Annuler », jamais sur le bouton qui détruit.
import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { TextField } from './ui/TextField';

export interface DialogState {
  open: boolean;
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  defaultValue?: string;
  /** Saisie : libellé visible du champ (défaut « Nouveau libellé »). */
  inputLabel?: string;
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
    <Modal open={state.open} onClose={onClose} label={state.title} className="max-w-sm sm:max-w-md p-6" initialFocusRef={state.danger && state.kind === 'confirm' ? cancelRef : undefined}>
      {state.danger && <AlertTriangle className="w-6 h-6 mx-auto mb-4 text-error" aria-hidden="true" />}
      <h2 className={`text-2xl leading-8 font-normal text-on-surface mb-4 ${state.danger ? 'text-center' : ''}`}>{state.title}</h2>
      {state.message && <p className="text-sm text-on-surface-variant mb-6">{state.message}</p>}
      {state.kind === 'prompt' && (
        <TextField
          className="mb-6"
          label={state.inputLabel || 'Nouveau libellé'}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } }}
        />
      )}
      <div className="flex flex-wrap gap-2 justify-end">
        <Button ref={cancelRef} variant="text" onClick={onClose}>{state.cancelLabel || 'Annuler'}</Button>
        <Button variant={state.danger ? 'danger' : 'filled'} onClick={confirm}>{state.confirmLabel || 'Confirmer'}</Button>
      </div>
    </Modal>
  );
};
