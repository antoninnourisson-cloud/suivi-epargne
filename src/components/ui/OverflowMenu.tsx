// Menu « ⋮ » Material 3 : actions secondaires d'une ligne (renommer, supprimer…) rangées
// derrière un bouton-icône, pour libérer la place sur téléphone. Le menu est en position
// fixe (calculée sur le bouton) : il n'est jamais coupé par une carte `overflow-hidden` ou un
// tableau défilant, et s'ouvre vers le haut près du bas de l'écran. Clavier : flèches,
// Origine/Fin, Échap (rend le focus au bouton) ; un clic ailleurs, un défilement ou Tab le ferme.
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { IconButton } from './IconButton';

export interface OverflowAction {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  tone?: 'default' | 'danger';
}

interface OverflowMenuProps {
  /** Nom du bouton « ⋮ », lu par les lecteurs d'écran (« Actions pour « Épargne du mois » »). */
  label: string;
  actions: OverflowAction[];
  className?: string;
}

const MENU_WIDTH = 192;
const ITEM_HEIGHT = 48;

export const OverflowMenu: React.FC<OverflowMenuProps> = ({ label, actions, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const close = (refocus = false) => {
    setOpen(false);
    setPos(null);
    if (refocus) buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const height = actions.length * ITEM_HEIGHT + 16;
    const below = r.bottom + height <= window.innerHeight - 8;
    setPos({
      top: below ? r.bottom + 4 : Math.max(8, r.top - height - 4),
      left: Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    });
  }, [open, actions.length]);
  // Focus sur la première action une fois le menu placé (un élément encore invisible ne
  // peut pas le recevoir).
  useEffect(() => { if (open && pos) itemsRef.current[0]?.focus(); }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => { if (!wrapRef.current?.contains(e.target as Node)) close(); };
    const onScroll = () => close();
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = itemsRef.current.filter((b): b is HTMLButtonElement => !!b);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close();
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <IconButton
        ref={buttonRef}
        icon={EllipsisVertical}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={pos ? { top: pos.top, left: pos.left, width: MENU_WIDTH } : { width: MENU_WIDTH }}
          className={`fixed z-50 py-2 rounded-sm bg-surface-container text-on-surface shadow-lg ${pos ? '' : 'invisible'}`}
        >
          {actions.map((a, i) => {
            const Icon = a.icon;
            return (
              <li key={a.label} role="none">
                <button
                  ref={el => { itemsRef.current[i] = el; }}
                  type="button"
                  role="menuitem"
                  onClick={() => { close(true); a.onClick(); }}
                  className={`w-full min-h-12 px-3 flex items-center gap-3 text-left text-sm hover:bg-on-surface/8 focus-visible:bg-on-surface/12 focus-visible:outline-none ${a.tone === 'danger' ? 'text-error' : ''}`}
                >
                  {Icon && <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />}
                  {a.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
