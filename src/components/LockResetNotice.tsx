// Écran de connexion pendant une réinitialisation du verrou. À part de AppLockScreen, chargé
// à la demande : l'écran de connexion fait partie du code de démarrage.
import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { Button } from './ui';

/**
 * Sur l'écran de connexion, pendant une réinitialisation du verrou : ce qui reste à faire,
 * et la possibilité de revenir au verrou si le code est retrouvé.
 */
export const LockResetNotice: React.FC<{ onCancel: () => void }> = ({ onCancel }) => (
  <div className="text-left rounded-2xl bg-secondary-container text-on-secondary-container p-4 mb-6 text-sm">
    <p className="font-medium mb-1 flex items-center gap-2"><LockKeyhole className="w-4 h-4 shrink-0" aria-hidden="true" /> Réinitialisation du verrou</p>
    <p className="mb-2">Reconnectez-vous avec votre compte Google. Le verrou de cet appareil sera retiré une fois vos données chargées depuis Drive.</p>
    <Button variant="text" className="-ml-3" onClick={onCancel}>J'ai retrouvé mon code</Button>
  </div>
);
