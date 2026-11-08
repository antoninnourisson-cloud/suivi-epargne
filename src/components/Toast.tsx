import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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

/** Confirmation « simple » : ni erreur, ni bouton (« Annuler »). Celle-là peut être remplacée. */
const isPlainConfirmation = (t: Pick<ToastItem, 'kind' | 'action'>) => t.kind !== 'error' && !t.action;

/**
 * Pile des toasts après l'ajout de `next` : un nouveau message de confirmation (pas une erreur)
 * remplace les confirmations simples encore affichées, au lieu de s'empiler dessus. Une erreur
 * ou un message avec action (« Annuler ») n'est jamais retiré par un autre : il part à la fin
 * de sa durée, pour ne pas faire perdre une annulation.
 */
export const pushToast = (prev: ToastItem[], next: ToastItem): ToastItem[] =>
  [...(next.kind === 'error' ? prev : prev.filter(t => !isPlainConfirmation(t))), next];

export const useToasts = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID();
    // Le minuteur vit dans ToastView : il se met en pause au survol et au focus (WCAG 2.2.1).
    setToasts(prev => pushToast(prev, { ...toast, id }));
    return id;
  }, []);

  return { toasts, addToast, dismiss };
};

export const ToastContainer: React.FC<{ toasts: ToastItem[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => {
  // La zone existe toujours (même vide) : les lecteurs d'écran n'annoncent que ce qui
  // apparaît dans une zone « live » déjà présente. Sur mobile, au-dessus de la barre du bas.
  return (
    <div role="status" aria-live="polite" className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0 z-60 flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
      {toasts.map(t => <ToastView key={t.id} t={t} onDismiss={onDismiss} />)}
    </div>
  );
};

/** Durée d'un toast : une erreur reste 10 s au moins, et jusqu'à fermeture si son texte est long
 *  (plus de 80 caractères : le temps de le lire n'est pas garanti) ; un message avec action
 *  (« Annuler ») garde 10 s ; une confirmation courte 3 s ; une durée fournie l'emporte, sauf
 *  pour une erreur (au moins 10 s). Retourne null pour « jusqu'à fermeture ». */
export const LONG_ERROR_CHARS = 80;
export const toastDurationMs = (t: Pick<ToastItem, 'message' | 'kind' | 'action' | 'durationMs'>): number | null => {
  if (t.kind === 'error') {
    if (t.message.length > LONG_ERROR_CHARS) return null;
    return Math.max(10_000, t.durationMs ?? 0);
  }
  return t.durationMs ?? (t.action ? 10_000 : 3000);
};

/** Un toast : durée selon `toastDurationMs`, en pause tant que la souris est dessus ou que le
 *  focus est dedans. */
const ToastView: React.FC<{ t: ToastItem; onDismiss: (id: string) => void }> = ({ t, onDismiss }) => {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toastDurationMs(t));
  useEffect(() => {
    if (paused || remaining.current === null) return;
    const left = remaining.current;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(t.id), left);
    return () => { window.clearTimeout(timer); remaining.current = Math.max(1500, left - (Date.now() - started)); };
  }, [paused, t.id, onDismiss]);
  return (
    <div
      role={t.kind === 'error' ? 'alert' : undefined}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      // Snackbar Material 3 : surface inversée, coins de 4 px, action dans la couleur inverse.
      className="pointer-events-auto min-h-12 flex items-center gap-3 pl-4 pr-2 py-2 rounded-xs shadow-md text-sm bg-inverse-surface text-inverse-on-surface animate-fade-in"
    >
      {t.kind === 'error' ? <AlertCircle className="w-5 h-5 shrink-0 text-inverse-error" aria-hidden="true" /> : <CheckCircle2 className="w-5 h-5 shrink-0 text-inverse-primary" aria-hidden="true" />}
      <span className="flex-1">{t.message}</span>
      {t.action && (
        <button
          onClick={() => { t.action!.onClick(); onDismiss(t.id); }}
          className="h-10 px-3 rounded-full font-medium text-inverse-primary hover:bg-inverse-primary/10 shrink-0"
        >
          {t.action.label}
        </button>
      )}
      <button onClick={() => onDismiss(t.id)} aria-label="Fermer la notification" className="p-2 rounded-full opacity-80 hover:opacity-100 hover:bg-inverse-on-surface/10 shrink-0"><X className="w-4 h-4" aria-hidden="true" /></button>
    </div>
  );
};

// Accès aux toasts depuis n'importe quel écran (fourni par App).
type AddToast = (toast: Omit<ToastItem, 'id'>) => string;
export const ToastContext = createContext<AddToast | null>(null);
export const useToast = () => useContext(ToastContext);

type ListSetter<T> = React.Dispatch<React.SetStateAction<T[]>>;

/** Durée du toast « Annuler » : 10 s à la souris ou au doigt, 30 s au clavier. Au clavier, le
 *  focus part sur la ligne voisine et le bouton « Annuler » est à plusieurs tabulations :
 *  il faut le temps d'y aller (le toast se met ensuite en pause tant que le focus est dedans). */
export const UNDO_TOAST_MS = 10_000;
export const UNDO_TOAST_KEYBOARD_MS = 30_000;

// Dernière interaction connue : clavier (touche) ou pointeur (souris, doigt, stylet). Suivie
// au niveau de la fenêtre, une seule fois, pour couvrir aussi une suppression confirmée dans
// une boîte de dialogue.
let lastInputWasKeyboard = false;
let trackingInput = false;
const trackInputModality = () => {
  if (trackingInput || typeof window === 'undefined') return;
  trackingInput = true;
  window.addEventListener('keydown', () => { lastInputWasKeyboard = true; }, true);
  window.addEventListener('pointerdown', () => { lastInputWasKeyboard = false; }, true);
};

/**
 * Suppression annulable : l'élément disparaît tout de suite, un toast « Annuler » le remet
 * à sa place (10 s, ou 30 s si la suppression vient du clavier). La restauration part de
 * l'état COURANT (mise à jour fonctionnelle) : une autre modification faite entre-temps
 * n'est pas écrasée.
 */
export const useUndoableRemove = () => {
  const addToast = useContext(ToastContext);
  useEffect(() => trackInputModality(), []);
  return useCallback(<T extends { id: string }>(list: T[], item: T, set: ListSetter<T>, message: string) => {
    const index = list.findIndex(x => x.id === item.id);
    set(prev => prev.filter(x => x.id !== item.id));
    addToast?.({
      message,
      kind: 'success',
      durationMs: lastInputWasKeyboard ? UNDO_TOAST_KEYBOARD_MS : UNDO_TOAST_MS,
      action: {
        label: 'Annuler',
        onClick: () => set(prev => prev.some(x => x.id === item.id)
          ? prev
          : [...prev.slice(0, Math.max(0, index)), item, ...prev.slice(Math.max(0, index))]),
      },
    });
  }, [addToast]);
};
