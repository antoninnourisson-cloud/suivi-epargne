// Ce que l'app fait autour du verrou de l'appareil (biométrie et/ou PIN, propre à ce
// navigateur, jamais synchronisé) : déverrouillage, « Code oublié », fin du retrait.
import { useCallback } from 'react';
import { useAppLock, useLockResetCompletion } from '../hooks/useAppLock';
import { openSettingsSection } from '../components/settings/sections';
import type { View } from '../navigation';
import type { AddToast } from './UiProviders';

type Lock = ReturnType<typeof useAppLock>;

interface LockFlowDeps {
  lock: Lock;
  /** État du chargement Drive (le retrait du verrou attend un chargement réussi). */
  load: { isLoading: boolean; isAuthenticated: boolean; loadFailed: boolean };
  addToast: AddToast;
  setView: (v: View) => void;
  /** Déconnexion (useAuthSession) : elle efface aussi la clé Gemini et les traces d'usage. */
  logout: (opts: { discardUnsynced: boolean }) => Promise<void>;
}

export const useLockFlow = ({ lock, load, addToast, setView, logout }: LockFlowDeps) => {
  // « Code oublié » : le verrou suspendu n'est retiré qu'à la fin d'un chargement Drive
  // réussi (reconnexion Google faite), quel que soit le chemin (connexion, reconnexion,
  // « Réessayer »). Jamais avant : la session de l'appareil avait été fermée. Règle testée
  // dans useAppLock.test.ts (shouldCompleteLockReset).
  const onLockResetCompleted = useCallback(() => {
    addToast({
      kind: 'info',
      message: 'Verrou retiré de cet appareil. Vous pouvez en définir un nouveau dans Paramètres.',
      action: { label: 'Paramètres', onClick: () => { openSettingsSection('lock'); setView('settings'); } },
    });
  }, [addToast, setView]);
  useLockResetCompletion(load, lock.completeReset, onLockResetCompleted);

  // Déverrouillage réussi : une demande de retrait du verrou en cours est annulée, et le
  // propriétaire l'apprend (elle a pu être faite par quelqu'un d'autre).
  const unlock = () => {
    const cancelled = lock.unlock();
    if (!cancelled) return;
    const when = cancelled.requestedAt.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    addToast({ kind: 'info', message: `Une demande de retrait du verrou, faite le ${when}, vient d'être annulée. Si ce n'était pas vous, gardez votre appareil avec vous.` });
  };

  // Retrait confirmé : session fermée, puis ce que l'appareil garde hors de Drive est effacé.
  const forgotCode = ({ discardUnsynced }: { discardUnsynced: boolean }) => lock.forgetCode(async () => {
    // Les modifications pas encore sur Drive restent en copie chiffrée, sauf choix contraire.
    // La déconnexion efface aussi ce que l'appareil garde hors de Drive : clé Gemini, et les
    // traces d'usage liées aux données (registre lib/storageKeys, clearTraces).
    await logout({ discardUnsynced });
  });

  return { unlock, forgotCode };
};
