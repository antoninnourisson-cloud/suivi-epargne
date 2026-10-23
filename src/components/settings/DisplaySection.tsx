// Carte « Affichage » des Paramètres : thème automatique (comme l'appareil), clair ou sombre.
// Réglage propre à cet appareil (il n'est pas dans le fichier Drive).
import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { SegmentedButton } from '../ui';
import { useTheme } from '../../hooks/useTheme';
import { PREFERENCE_LABEL, type ThemePreference } from '../../lib/theme';
import { Hint } from './SettingsCard';

const OPTIONS: { value: ThemePreference; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'system', label: PREFERENCE_LABEL.system, icon: Monitor },
  { value: 'light', label: PREFERENCE_LABEL.light, icon: Sun },
  { value: 'dark', label: PREFERENCE_LABEL.dark, icon: Moon },
];

/** Résumé de la carte. */
export const displaySummary = (preference: ThemePreference) =>
  preference === 'system' ? 'Thème automatique, comme cet appareil' : `Thème ${PREFERENCE_LABEL[preference].toLowerCase()}`;

export const DisplaySection: React.FC = () => {
  const { preference, setPreference } = useTheme();
  return (
    <div className="space-y-3">
      <SegmentedButton label="Thème" options={OPTIONS} value={preference} onChange={setPreference} />
      <Hint>
        « Automatique » suit le réglage clair ou sombre de votre appareil, y compris quand il change dans la journée.
        Le bouton soleil ou lune de l'en-tête choisit directement l'autre thème. Ce réglage reste sur cet appareil.
      </Hint>
    </div>
  );
};
