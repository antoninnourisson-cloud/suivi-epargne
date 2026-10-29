// Carte « Affichage » des Paramètres : thème automatique (comme l'appareil), clair ou sombre,
// et mode discret (montants masqués). Réglages propres à cet appareil (pas dans le fichier Drive).
import React, { useEffect, useRef } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { SegmentedButton } from '../ui';
import { useTheme } from '../../hooks/useTheme';
import { useDiscreetMode } from '../../hooks/useDiscreetMode';
import { PREFERENCE_LABEL, type ThemePreference } from '../../lib/theme';
import { DISCREET_AMOUNT } from '../../lib/format';
import { Hint } from './SettingsCard';
import { SwitchRow } from './fields';

const OPTIONS: { value: ThemePreference; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'system', label: PREFERENCE_LABEL.system, icon: Monitor },
  { value: 'light', label: PREFERENCE_LABEL.light, icon: Sun },
  { value: 'dark', label: PREFERENCE_LABEL.dark, icon: Moon },
];

/** Résumé de la carte. */
export const displaySummary = (preference: ThemePreference, discreet = false) =>
  `${preference === 'system' ? 'Thème automatique, comme cet appareil' : `Thème ${PREFERENCE_LABEL[preference].toLowerCase()}`}${discreet ? ' · montants masqués' : ''}`;

// L'écran est reconstruit au passage en mode discret (App) : l'interrupteur reprend alors le focus.
let refocusDiscreetSwitch = false;

export const DisplaySection: React.FC = () => {
  const { preference, setPreference } = useTheme();
  const { discreet, setDiscreet } = useDiscreetMode();
  const discreetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!refocusDiscreetSwitch) return;
    refocusDiscreetSwitch = false;
    discreetRef.current?.querySelector<HTMLElement>('[role="switch"]')?.focus();
  }, []);
  return (
    <div className="space-y-3">
      <SegmentedButton label="Thème" options={OPTIONS} value={preference} onChange={setPreference} />
      <Hint>
        « Automatique » suit le réglage clair ou sombre de votre appareil, y compris quand il change dans la journée.
        Le bouton soleil ou lune de l'en-tête choisit directement l'autre thème. Ce réglage reste sur cet appareil.
      </Hint>
      <div ref={discreetRef} className="pt-2">
        <SwitchRow
          label="Mode discret"
          hint={<>Remplace tous les montants affichés par « {DISCREET_AMOUNT} » (transports, écran partagé, capture). Les champs de saisie restent lisibles. Aussi avec le bouton œil de l'en-tête ; réglage de cet appareil.</>}
          checked={discreet}
          onChange={next => { refocusDiscreetSwitch = true; setDiscreet(next); }}
        />
      </div>
    </div>
  );
};
