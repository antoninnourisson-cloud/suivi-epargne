// Réglages « Motivation » : bons mois et jalons (activés par défaut) et seuil d'un bon mois.
// Le contrôle des fiches de paie n'en dépend pas : c'est une sécurité, pas un jeu.
import React, { useId } from 'react';
import { Check, Sprout } from 'lucide-react';
import { DEFAULT_GOOD_MONTH_THRESHOLD } from '../../lib/motivation';
import { NumberInput } from '../NumberInput';
import { Card } from '../ui';

interface MotivationSettingsProps {
  gamification?: boolean;
  goodMonthThreshold?: number;
  onChange: (patch: { gamification?: boolean; goodMonthThreshold?: number }) => void;
}

const MIN_THRESHOLD = 50;

export const MotivationSettings: React.FC<MotivationSettingsProps> = ({ gamification, goodMonthThreshold, onChange }) => {
  const enabled = gamification !== false;
  const switchId = useId();
  const hintId = useId();
  const thresholdId = useId();
  const thresholdHintId = useId();
  return (
    <Card title="Motivation" icon={Sprout} className="lg:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={switchId} className="text-sm font-medium text-on-surface cursor-pointer">Bons mois et jalons</label>
          <p id={hintId} className="text-xs text-on-surface-variant mt-0.5 max-w-xl">
            Sur l'Accueil : vos bons mois et votre série, vos jalons et le point de paie. Rien ne récompense le risque ni le nombre d'opérations.
          </p>
        </div>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-describedby={hintId}
          onClick={() => onChange({ gamification: enabled ? false : undefined })}
          className={`relative shrink-0 w-[52px] h-8 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${enabled ? 'bg-primary' : 'bg-surface-container-highest border-2 border-outline'}`}
        >
          <span className={`absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-all ${enabled ? 'left-[24px] w-6 h-6 bg-on-primary text-primary' : 'left-[6px] w-4 h-4 bg-outline'}`}>
            {enabled && <Check className="w-4 h-4" aria-hidden="true" />}
          </span>
        </button>
      </div>

      {enabled && (
        <div className="mt-5 pt-4 border-t border-outline-variant max-w-xs">
          <label htmlFor={thresholdId} className="text-sm font-medium text-on-surface">Seuil d'un bon mois</label>
          <div className="mt-1">
            <NumberInput
              id={thresholdId}
              value={goodMonthThreshold && goodMonthThreshold > 0 ? goodMonthThreshold : DEFAULT_GOOD_MONTH_THRESHOLD}
              onChange={v => onChange({ goodMonthThreshold: Math.max(MIN_THRESHOLD, Math.round(v)) })}
              min={MIN_THRESHOLD}
              suffix="€"
              describedBy={thresholdHintId}
              className="w-full h-12 px-3 pr-8 rounded-xs border border-outline bg-transparent text-on-surface tabular-nums hover:border-on-surface focus:border-indigo-600 dark:focus:border-indigo-300 outline-none"
            />
          </div>
          <p id={thresholdHintId} className="text-xs text-on-surface-variant mt-1">Argent mis de côté sur une paie pour qu'elle compte comme un bon mois (50 € au moins).</p>
        </div>
      )}
    </Card>
  );
};
