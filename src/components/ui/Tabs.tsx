// Onglets Material 3 (« primary tabs ») : motif ARIA complet (tablist, tab, tabpanel
// reliés), flèches gauche/droite, Début et Fin, un seul arrêt de tabulation.
import React, { useId } from 'react';
import { onTablistKeyDown } from '../../lib/tablist';

interface TabDef<T extends string> { value: T; label: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }

interface TabsProps<T extends string> {
  label: string;
  tabs: TabDef<T>[];
  value: T;
  onChange: (value: T) => void;
  children: React.ReactNode;
  className?: string;
}

export const Tabs = <T extends string>({ label, tabs, value, onChange, children, className = '' }: TabsProps<T>) => {
  const base = useId();
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} onKeyDown={onTablistKeyDown} className="flex border-b border-outline-variant overflow-x-auto">
        {tabs.map(t => {
          const selected = t.value === value;
          return (
            <button
              key={t.value}
              id={`${base}-tab-${t.value}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.value)}
              className={`relative h-12 px-4 flex items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-on-surface/8 ${selected ? 'text-indigo-700 dark:text-indigo-200' : 'text-on-surface-variant'}`}
            >
              {t.icon && <t.icon className="w-4 h-4" aria-hidden="true" />}
              {t.label}
              {selected && <span className="absolute left-2 right-2 bottom-0 h-[3px] rounded-t-full bg-indigo-600 dark:bg-indigo-300" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${value}`} className="pt-6">
        {children}
      </div>
    </div>
  );
};
