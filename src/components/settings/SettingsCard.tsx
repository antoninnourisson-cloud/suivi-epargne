// Carte repliable de l'écran Paramètres : un bouton-titre (aria-expanded, aria-controls) avec
// icône, titre et résumé d'une ligne de l'état actuel, puis le contenu. Une fois repliée, la
// carte garde son contenu monté (attribut hidden) : une saisie en cours n'est pas perdue.
//
// Le résumé vient de la prop `summary`, ou des panneaux affichés dans la carte, qui le
// signalent avec `useCardSummary` (ils sont composés par App et connaissent seuls leur état).
import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { sectionAnchor, type SettingsSection } from './sections';

interface CardContextValue { report: (key: string, text: string | null) => void }
const CardContext = createContext<CardContextValue | null>(null);

/** Vrai dans une carte de Paramètres : le panneau n'y dessine ni bordure ni titre. */
export const useInSettingsCard = () => useContext(CardContext) !== null;

/**
 * Signale une partie du résumé de la carte qui contient le composant (ex. « 2 appareils »).
 * Sans effet hors d'une carte de Paramètres. `key` distingue plusieurs panneaux d'une carte.
 */
export const useCardSummary = (key: string, text: string | null | undefined) => {
  const ctx = useContext(CardContext);
  const report = ctx?.report;
  useEffect(() => {
    if (!report) return;
    report(key, text || null);
    return () => report(key, null);
  }, [report, key, text]);
};

interface SettingsCardProps {
  id: SettingsSection;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Résumé fixe ; sinon celui que signalent les panneaux de la carte. */
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export const SettingsCard: React.FC<SettingsCardProps> = ({ id, title, icon: Icon, summary, open, onToggle, children }) => {
  const base = useId();
  const [parts, setParts] = useState<[string, string][]>([]);
  const report = useCallback((key: string, text: string | null) => {
    setParts(prev => {
      const i = prev.findIndex(([k]) => k === key);
      if (text === null) return i < 0 ? prev : prev.filter(([k]) => k !== key);
      if (i >= 0) return prev[i][1] === text ? prev : prev.map(p => (p[0] === key ? [key, text] : p));
      return [...prev, [key, text]];
    });
  }, []);
  const ctx = useMemo(() => ({ report }), [report]);
  const line = summary ?? parts.map(([, t]) => t).join(' · ');

  return (
    <section id={sectionAnchor(id)} data-section={id}
      className="scroll-mt-20 rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-surface-container-low text-on-surface">
      <h4 className="m-0">
        <button
          type="button"
          id={`${base}-btn`}
          aria-expanded={open}
          aria-controls={`${base}-panel`}
          aria-labelledby={`${base}-title`}
          aria-describedby={line ? `${base}-summary` : undefined}
          onClick={onToggle}
          className={`w-full min-h-16 px-4 sm:px-5 py-3 flex items-center gap-4 text-left hover:bg-on-surface/5 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-300 ${open ? 'rounded-t-2xl' : 'rounded-2xl'}`}
        >
          <span className="w-10 h-10 shrink-0 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center" aria-hidden="true">
            <Icon className="w-5 h-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span id={`${base}-title`} className="block text-base font-medium text-on-surface">{title}</span>
            {line && <span id={`${base}-summary`} className="block text-sm text-on-surface-variant truncate">{line}</span>}
          </span>
          <ChevronDown className={`w-5 h-5 shrink-0 text-on-surface-variant transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </h4>
      <div id={`${base}-panel`} role="region" aria-labelledby={`${base}-title`} hidden={!open}
        className="px-4 sm:px-5 pb-5 pt-4 border-t border-outline-variant">
        <CardContext.Provider value={ctx}>{children}</CardContext.Provider>
      </div>
    </section>
  );
};

/** Intertitre dans une carte (ex. « Copies mensuelles sur Drive »). */
export const CardSubheading: React.FC<{ children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }> = ({ children, icon: Icon }) => (
  <p className="text-sm font-medium text-on-surface flex items-center gap-2">
    {Icon && <Icon className="w-4 h-4 text-on-surface-variant" aria-hidden="true" />}{children}
  </p>
);

/** Texte d'aide sous un réglage. */
export const Hint: React.FC<{ children: React.ReactNode; className?: string; id?: string }> = ({ children, className = '', id }) => (
  <p id={id} className={`text-xs text-on-surface-variant leading-relaxed ${className}`}>{children}</p>
);

/** Encadré d'avertissement sobre (M3 : conteneur tertiaire). */
export const Notice: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warning' | 'error'; className?: string; icon?: React.ComponentType<{ className?: string }> }> = ({ children, tone = 'info', className = '', icon: Icon }) => {
  const tones = {
    info: 'bg-surface-container text-on-surface-variant',
    warning: 'bg-tertiary-container text-on-tertiary-container',
    error: 'bg-error-container text-on-error-container',
  };
  return (
    <div className={`rounded-xl p-3 flex gap-2 items-start text-xs leading-relaxed ${tones[tone]} ${className}`}>
      {Icon && <Icon className="w-4 h-4 mt-px shrink-0" aria-hidden="true" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
};
