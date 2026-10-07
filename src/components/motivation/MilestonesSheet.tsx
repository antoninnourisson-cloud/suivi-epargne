// Feuille « Vos jalons » : chaque jalon, atteint ou non, avec son avancement. Sobre : pas
// d'animation ni de son, l'état est toujours écrit (jamais porté par la seule couleur).
import React from 'react';
import { Check, Flag, X } from 'lucide-react';
import type { Milestone } from '../../lib/motivation';
import { Modal } from '../Modal';
import { Button } from '../ui';

interface MilestonesSheetProps {
  open: boolean;
  onClose: () => void;
  milestones: Milestone[];
}

export const MilestonesSheet: React.FC<MilestonesSheetProps> = ({ open, onClose, milestones }) => {
  const achieved = milestones.filter(m => m.achieved).length;
  return (
    <Modal open={open} onClose={onClose} label="Vos jalons" variant="sheet" className="max-w-lg p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] leading-7 font-normal text-on-surface flex items-center gap-2">
            <Flag className="w-5 h-5 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /> Vos jalons
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">{achieved} atteint{achieved > 1 ? 's' : ''} sur {milestones.length}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer" className="p-2 -m-2 rounded-full text-on-surface-variant hover:bg-on-surface/8">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
      <ul className="mt-5 space-y-2">
        {milestones.map(m => {
          const pct = Math.round((m.progress ?? 0) * 100);
          return (
            <li key={m.id} className={`p-4 rounded-xl ${m.achieved ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-low dark:bg-surface-container'}`}>
              <div className="flex items-start gap-3">
                <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${m.achieved ? 'bg-primary text-on-primary' : 'border border-outline text-on-surface-variant'}`}>
                  {m.achieved ? <Check className="w-4 h-4" aria-hidden="true" /> : <Flag className="w-4 h-4" aria-hidden="true" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-on-surface flex flex-wrap items-baseline justify-between gap-x-3">
                    <span>{m.title}</span>
                    <span className="text-xs font-medium text-on-surface-variant tabular-nums">
                      {m.achieved ? 'Atteint' : m.progress !== undefined ? `${pct} %` : 'À venir'}
                    </span>
                  </p>
                  <p className="text-sm text-on-surface-variant mt-0.5">{m.detail}</p>
                  {!m.achieved && m.progress !== undefined && (
                    <div className="mt-2 h-1.5 rounded-full bg-surface-container-highest overflow-hidden" role="progressbar" aria-label={m.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-end">
        <Button variant="tonal" onClick={onClose}>Fermer</Button>
      </div>
    </Modal>
  );
};
