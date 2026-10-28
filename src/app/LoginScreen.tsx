// Écran de connexion (avant toute session).
import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Logo } from '../components/Logo';
import { Button } from '../components/Button';
import { LockResetNotice } from '../components/LockResetNotice';
import { APP_VERSION } from '../appVersion';

interface LoginScreenProps {
  /** Le bouton de connexion peut être utilisé (services Google chargés, ou mode serveur). */
  ready: boolean;
  /** Les services Google n'ont pas pu être chargés. */
  apiError: boolean;
  /** « Code oublié » en attente : l'avis s'affiche, avec de quoi l'annuler. */
  lockResetPending: boolean;
  onCancelLockReset: () => void;
  onLogin: () => void;
}

// Fond vert sapin fixe (mêmes couleurs en clair et en sombre) : les liens du bas restent
// en blanc atténué, lisible sur ce vert (contraste ≥ 4,5:1).
export const LoginScreen: React.FC<LoginScreenProps> = ({ ready, apiError, lockResetPending, onCancelLockReset, onLogin }) => (
  <main className="min-h-screen bg-sapin flex flex-col items-center justify-center p-4">
    <div className="bg-surface-container-low text-on-surface p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
      <Logo className="w-16 h-16 mx-auto mb-6 shadow-lg" />
      <h1 className="text-[32px] leading-10 font-bold text-on-surface mb-1">Pécule</h1>
      <p className="text-sm font-bold text-primary mb-4">Faites pousser votre épargne</p>
      <p className="text-on-surface-variant mb-8">Vos données sont stockées en sécurité sur votre Google Drive personnel.</p>
      {lockResetPending && <LockResetNotice onCancel={onCancelLockReset} />}
      {apiError ? (
        <div role="alert" className="text-left bg-error-container text-on-error-container rounded-xl p-4">
          <p className="text-sm font-bold mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> Impossible de charger les services Google</p>
          <p className="text-sm mb-3">Vérifiez votre connexion (ou un bloqueur de scripts) puis réessayez.</p>
          <Button variant="danger" onClick={() => window.location.reload()} className="w-full min-h-12">Recharger l'application</Button>
        </div>
      ) : !ready ? <div role="status" className="flex justify-center gap-2 text-primary font-bold"><Loader2 className="animate-spin" aria-hidden="true"/> Connexion à Google…</div> :
        <Button variant="outlined" onClick={onLogin} className="w-full min-h-12">Continuer avec Google</Button>
      }
    </div>
    <p className="mt-4 text-sm font-bold text-white/85 flex gap-4 justify-center">
      <a href="presentation.html" className="underline underline-offset-2 hover:text-white">Découvrir Pécule</a>
      <a href="confidentialite.html" className="underline underline-offset-2 hover:text-white">Confidentialité</a>
    </p>
    <p className="mt-2 text-xs font-bold text-white/70">version {APP_VERSION}</p>
  </main>
);
