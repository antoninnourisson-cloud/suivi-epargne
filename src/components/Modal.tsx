// Fenêtre modale accessible, partagée par toutes les fenêtres de l'app : rôle « dialog »,
// intitulé annoncé, focus gardé à l'intérieur, Échap pour fermer, retour du focus à
// l'élément d'origine, défilement de la page bloqué.
import React, { useEffect, useRef } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Intitulé lu par les lecteurs d'écran (le titre visible est dans `children`). */
  label: string;
  children: React.ReactNode;
  /** 'center' (défaut) ou 'sheet' (panneau ancré en bas sur mobile). */
  variant?: 'center' | 'sheet';
  className?: string;
  /** Élément à focaliser à l'ouverture (sinon le premier champ ou bouton). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({ open, onClose, label, children, variant = 'center', className = '', initialFocusRef }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = initialFocusRef?.current ?? panel?.querySelector<HTMLElement>('input:not([disabled]), select, textarea') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null);
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;
  const sheet = variant === 'sheet';
  return (
    <div
      className={`fixed inset-0 z-70 flex ${sheet ? 'items-end sm:items-center' : 'items-center p-4'} justify-center bg-scrim/40 animate-fade-in`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        // Material 3 : boîte de dialogue (coins de 28 px, surface « container high ») ou
        // feuille du bas, avec sa poignée.
        className={`bg-surface-container-high text-on-surface shadow-xl w-full outline-hidden rounded-3xl max-h-[90vh] overflow-y-auto ${sheet ? 'max-sm:rounded-b-none max-sm:max-h-[85vh] pb-[env(safe-area-inset-bottom)]' : ''} ${className}`}
      >
        {sheet && <div className="sm:hidden flex justify-center pt-3 -mb-1" aria-hidden="true"><span className="h-1 w-8 rounded-full bg-on-surface-variant/40" /></div>}
        {children}
      </div>
    </div>
  );
};
