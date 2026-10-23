// ================================================
// FILE: src/components/InstallPrompt.tsx
// Encart « Installez l'app » sur téléphone, tant qu'elle s'ouvre dans le navigateur :
// les notifications (obligatoires sur iPhone) et l'ouverture en un geste en dépendent.
// Masquable 30 jours.
// ================================================
import React, { useEffect, useState } from 'react';
import { lsSet } from '../lib/storage';
import { storageKey } from '../lib/storageKeys';
import { Smartphone, X } from 'lucide-react';
import { Button, IconButton } from './ui';
import { canPromptInstall, isStandalone, mobilePlatform, onInstallAvailabilityChange, promptInstall } from '../services/installPrompt';

const DISMISS_KEY = storageKey('installPromptDismissedAt');
const DISMISS_DAYS = 30;

const recentlyDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch { return false; }
};

export const InstallPrompt: React.FC = () => {
  const platform = mobilePlatform();
  const [hidden, setHidden] = useState(() => !platform || isStandalone() || recentlyDismissed());
  const [canInstall, setCanInstall] = useState(canPromptInstall());
  useEffect(() => onInstallAvailabilityChange(() => setCanInstall(canPromptInstall())), []);

  if (hidden) return null;
  const dismiss = () => {
    lsSet(DISMISS_KEY, String(Date.now()));
    setHidden(true);
  };

  return (
    <div className="flex items-start gap-3 pl-4 py-2 pr-1 rounded-2xl bg-secondary-container text-on-secondary-container text-sm">
      <Smartphone className="w-5 h-5 shrink-0 mt-2.5" aria-hidden="true" />
      <div className="flex-1 min-w-0 py-2">
        <p className="font-medium">Installez l'app sur votre téléphone</p>
        <p className="mt-0.5">
          Pour recevoir les rappels (jour de paie, abonnements…) et l'ouvrir en un geste.{' '}
          {platform === 'ios'
            ? <>Dans Safari : bouton <b>Partager</b>, puis <b>« Sur l'écran d'accueil »</b>. Les notifications ne marchent sur iPhone que dans l'app installée.</>
            : canInstall
              ? null
              : <>Dans Chrome : menu <b>⋮</b>, puis <b>« Installer l'application »</b>.</>}
        </p>
        {platform === 'android' && canInstall && (
          <Button onClick={async () => { if (await promptInstall()) setHidden(true); }} className="mt-3">
            Installer
          </Button>
        )}
      </div>
      <IconButton onClick={dismiss} label="Masquer pendant 30 jours" icon={X} />
    </div>
  );
};
