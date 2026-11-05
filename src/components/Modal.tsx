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
  /**
   * 'center' (défaut), 'sheet' (panneau ancré en bas sur mobile) ou 'page' (plein écran sur
   * mobile, boîte centrée ailleurs : parcours en plusieurs étapes, comme le rituel de paie).
   */
  variant?: 'center' | 'sheet' | 'page';
  className?: string;
  /** Élément à focaliser à l'ouverture (sinon le premier champ ou bouton). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * `false` : un clic sur le voile ne ferme pas (formulaire déjà commencé, qu'un toucher
   * maladroit effacerait). Échap et le bouton Fermer restent disponibles.
   */
  closeOnScrim?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Fenêtres ouvertes, de la plus ancienne à la plus haute : seule la dernière réagit à Échap et
// à Tab (une confirmation posée sur une feuille ne referme pas la feuille avec elle).
const stack: symbol[] = [];

// Éléments rendus inertes pendant qu'une fenêtre est ouverte, avec le nombre de fenêtres qui
// les ont demandés : ils ne redeviennent actifs qu'à la fermeture de la dernière.
const inertCounts = new Map<Element, number>();

/**
 * Rend inerte tout ce qui entoure la fenêtre (frères de chacun de ses ancêtres), sauf la zone
 * des toasts (annoncée aux lecteurs d'écran) et le verrou de l'app. Ce qui était déjà inerte
 * (l'app sous le verrou) n'est pas touché. Renvoie la fonction qui annule.
 */
const isolate = (overlay: HTMLElement): (() => void) => {
  const mine: Element[] = [];
  for (let node: HTMLElement | null = overlay; node && node !== document.body; node = node.parentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || sibling.matches('script, style, [role="status"], [data-app-lock]')) continue;
      const count = inertCounts.get(sibling);
      if (count === undefined) {
        if (sibling.hasAttribute('inert')) continue;
        sibling.setAttribute('inert', '');
      }
      inertCounts.set(sibling, (count ?? 0) + 1);
      mine.push(sibling);
    }
  }
  return () => {
    for (const el of mine) {
      const count = (inertCounts.get(el) ?? 1) - 1;
      if (count > 0) { inertCounts.set(el, count); continue; }
      inertCounts.delete(el);
      // Verrou posé entre-temps : l'app y reste inerte (App.tsx la rouvre au déverrouillage).
      if (!document.querySelector('[data-app-lock]')) el.removeAttribute('inert');
    }
  };
};

export const Modal: React.FC<ModalProps> = ({ open, onClose, label, children, variant = 'center', className = '', initialFocusRef, closeOnScrim = true }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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

    const id = Symbol('modal');
    stack.push(id);
    const release = overlayRef.current ? isolate(overlayRef.current) : undefined;

    const onKey = (e: KeyboardEvent) => {
      // Fenêtre empilée sous une autre : seule la plus haute répond.
      if (stack[stack.length - 1] !== id) return;
      // Verrou posé par-dessus l'app (App.tsx) : la fenêtre, restée ouverte derrière, ne
      // réagit pas aux touches (Échap ou Tab tapés sur l'écran de verrouillage).
      if (panel?.closest('[inert]')) return;
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
      release?.();
      const at = stack.indexOf(id);
      if (at !== -1) stack.splice(at, 1);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;
  const sheet = variant === 'sheet';
  const page = variant === 'page';
  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-70 flex ${sheet || page ? 'items-end sm:items-center' : 'items-center p-4'} justify-center bg-scrim/40 animate-fade-in`}
      onClick={closeOnScrim ? onClose : undefined}
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
        className={`bg-surface-container-high text-on-surface shadow-xl w-full outline-hidden rounded-3xl max-h-[90vh] overflow-y-auto ${sheet ? 'max-sm:rounded-b-none max-sm:max-h-[85vh] pb-[env(safe-area-inset-bottom)]' : ''} ${page ? 'max-sm:rounded-none max-sm:h-dvh max-sm:max-h-dvh pb-[env(safe-area-inset-bottom)]' : ''} ${className}`}
      >
        {/* Poignée remontée dans le rembourrage du haut, puis 8 px fixes avant le contenu,
            quel que soit le rembourrage passé (p-4 ou p-6) : elle ne touche jamais le titre. */}
        {sheet && <div data-sheet-handle className="sm:hidden flex justify-center -mt-2 mb-2" aria-hidden="true"><span className="h-1 w-8 rounded-full bg-on-surface-variant/40" /></div>}
        {children}
      </div>
    </div>
  );
};
