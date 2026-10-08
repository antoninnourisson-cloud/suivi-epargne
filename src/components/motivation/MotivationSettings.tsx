// Réglages « Motivation » : bons mois et jalons (activés par défaut) et seuil d'un bon mois.
// Le contrôle des fiches de paie n'en dépend pas : c'est une sécurité, pas un jeu.
import React from 'react';
import { Sprout } from 'lucide-react';
import { DEFAULT_GOOD_MONTH_THRESHOLD } from '../../lib/motivation';
import { formatEUR } from '../../lib/format';
import { Card } from '../ui';
import { NumberField, SwitchRow } from '../settings/fields';
import { useCardSummary, useInSettingsCard } from '../settings/SettingsCard';

interface MotivationSettingsProps {
  gamification?: boolean;
  goodMonthThreshold?: number;
  onChange: (patch: { gamification?: boolean; goodMonthThreshold?: number }) => void;
}

const MIN_THRESHOLD = 50;

export const MotivationSettings: React.FC<MotivationSettingsProps> = ({ gamification, goodMonthThreshold, onChange }) => {
  const enabled = gamification !== false;
  const threshold = goodMonthThreshold && goodMonthThreshold > 0 ? goodMonthThreshold : DEFAULT_GOOD_MONTH_THRESHOLD;
  const embedded = useInSettingsCard();
  useCardSummary('motivation', enabled ? `Activée · seuil ${formatEUR(threshold, 0)}` : 'Désactivée');

  const body = (
    <>
      <SwitchRow
        label="Bons mois et jalons"
        hint="Sur l'Accueil : vos bons mois et votre série, vos jalons et le point de paie. Rien ne récompense le risque ni le nombre d'opérations."
        checked={enabled}
        onChange={on => onChange({ gamification: on ? undefined : false })}
      />
      {enabled && (
        <div className="mt-5 pt-4 border-t border-outline-variant max-w-xs">
          <NumberField
            label="Seuil d'un bon mois"
            value={threshold}
            onChange={v => onChange({ goodMonthThreshold: Math.max(MIN_THRESHOLD, Math.round(v)) })}
            min={MIN_THRESHOLD}
            suffix="€"
            supporting="Argent mis de côté sur une paie pour qu'elle compte comme un bon mois (50 € au moins)."
          />
        </div>
      )}
    </>
  );

  return embedded ? body : <Card title="Motivation" icon={Sprout}>{body}</Card>;
};
