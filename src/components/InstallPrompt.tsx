// ================================================
// FILE: src/components/InstallPrompt.tsx
// Encart « Installez l'app » sur téléphone, tant qu'elle s'ouvre dans le navigateur :
// les notifications (obligatoires sur iPhone) et l'ouverture en un geste en dépendent.
// Masquable 30 jours.
// ================================================
import React, { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { canPromptInstall, isStandalone, mobilePlatform, onInstallAvailabilityChange, promptInstall } from '../services/installPrompt';

const DISMISS_KEY = 'install_prompt_dismissed_at';
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
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* préférence non mémorisée */ }
    setHidden(true);
  };

  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900 text-indigo-900 dark:text-indigo-200 text-sm">
      <Smartphone className="w-5 h-5 shrink-0 mt-0.5 text-indigo-600" />
      <div className="flex-1 min-w-0">
        <p className="font-bold">Installez l'app sur votre téléphone</p>
        <p className="text-xs mt-0.5 opacity-90">
          Pour recevoir les rappels (jour de paie, abonnements…) et l'ouvrir en un geste.{' '}
          {platform === 'ios'
            ? <>Dans Safari : bouton <b>Partager</b>, puis <b>« Sur l'écran d'accueil »</b>. Les notifications ne marchent sur iPhone que dans l'app installée.</>
            : canInstall
              ? null
              : <>Dans Chrome : menu <b>⋮</b>, puis <b>« Installer l'application »</b>.</>}
        </p>
        {platform === 'android' && canInstall && (
          <button type="button" onClick={async () => { if (await promptInstall()) setHidden(true); }} className="mt-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black">
            Installer
          </button>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label="Masquer pendant 30 jours" className="p-2 -m-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-600"><X className="w-4 h-4" /></button>
    </div>
  );
};
