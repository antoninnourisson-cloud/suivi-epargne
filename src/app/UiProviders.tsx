// Toasts et fenêtre de confirmation, chacun avec son propre état, hors d'App : afficher un
// toast ou ouvrir une confirmation ne re-rend que ce fournisseur, jamais les écrans.
//
// Ils ne s'affichent que par-dessus l'app ouverte (`useMainUiShown`) : jamais par-dessus le
// verrou, l'écran de connexion ou l'écran de démarrage (un toast ou une confirmation peut
// citer un compte ou un montant). En attendant, ils restent en file, comme avant.
import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { ToastContainer, ToastContext, useToasts, type ToastItem } from '../components/Toast';
import { Dialog, emptyDialog, type DialogState } from '../components/Dialog';

export type AddToast = (toast: Omit<ToastItem, 'id'>) => string;

/** Ajouter un toast (fourni par UiProviders). */
export const useAddToast = (): AddToast => {
  const add = useContext(ToastContext);
  if (!add) throw new Error('useAddToast hors de UiProviders');
  return add;
};

export interface DialogApi {
  /** Ouvre la fenêtre (confirmation ou saisie d'un texte). */
  open: (state: Omit<DialogState, 'open'>) => void;
  /**
   * Confirmation simple. `confirmLabel` : dire ce que fait le bouton (« Remplacer par la copie
   * d'août 2026 ») plutôt qu'un « Confirmer » neutre, surtout quand des données sont remplacées.
   */
  confirm: (title: string, message: string, onConfirm: () => void | Promise<void>, danger?: boolean, confirmLabel?: string) => void;
}

const DialogContext = createContext<DialogApi | null>(null);
const ShownContext = createContext<((shown: boolean) => void) | null>(null);

/** Confirmation et saisie (fournies par UiProviders). */
export const useDialog = (): DialogApi => {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useDialog hors de UiProviders');
  return api;
};

/** L'app ouverte est affichée (`shown`) : toasts et fenêtre de confirmation peuvent apparaître. Avant l'affichage, sans attendre. */
export const useMainUiShown = (shown: boolean) => {
  const setShown = useContext(ShownContext);
  if (!setShown) throw new Error('useMainUiShown hors de UiProviders');
  useLayoutEffect(() => { setShown(shown); }, [setShown, shown]);
};

export const UiProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toasts, addToast, dismiss } = useToasts();
  const [dialog, setDialog] = useState<DialogState>(emptyDialog);
  const [shown, setShown] = useState(false);
  const api = useMemo<DialogApi>(() => ({
    open: state => setDialog({ ...state, open: true }),
    confirm: (title, message, onConfirm, danger = false, confirmLabel = 'Confirmer') =>
      setDialog({ open: true, kind: 'confirm', title, message, danger, confirmLabel, onConfirm: () => { void onConfirm(); } }),
  }), []);
  const close = useCallback(() => setDialog(emptyDialog), []);
  return (
    <ToastContext.Provider value={addToast}>
      <DialogContext.Provider value={api}>
        <ShownContext.Provider value={setShown}>
          {children}
          {shown && <ToastContainer toasts={toasts} onDismiss={dismiss} />}
          {shown && <Dialog state={dialog} onClose={close} />}
        </ShownContext.Provider>
      </DialogContext.Provider>
    </ToastContext.Provider>
  );
};
