// Fenêtres de la synchronisation : choix entre deux versions (conflit entre appareils, fichier
// en double) et déconnexion avec des modifications pas encore sur Drive.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PortfolioData } from '../hooks/usePortfolioData';
import { sendBlocker, type SendBlocker } from '../lib/sync/syncStatus';
import { ConflictDialog, Lazy, LogoutDialog } from './screens';
import type { AddToast } from './UiProviders';

/** Pourquoi « Envoyer puis se déconnecter » est grisé. */
const CANNOT_SEND: Record<SendBlocker, string> = {
  'local-backup': 'Une sauvegarde locale attend votre choix (bandeau en haut de l\'écran) : touchez « Annuler », puis restaurez-la ou ignorez-la avant d\'envoyer.',
  conflict: 'Un choix entre deux versions est en attente : réglez-le d\'abord pour pouvoir envoyer.',
  session: 'Votre session Google a expiré : reconnectez-vous pour pouvoir envoyer.',
  outdated: 'Cette version de Pécule est trop ancienne pour enregistrer sur Drive : mettez-la à jour.',
  'load-failed': 'Vos données n\'ont pas pu être chargées depuis Drive : rien ne peut être envoyé pour l\'instant.',
  offline: 'Vous êtes hors ligne ou Drive est injoignable pour le moment.',
};

/**
 * Ouverture des deux fenêtres. Un conflit qui apparaît ouvre tout de suite l'écran de choix
 * (la bannière permet de le rouvrir) ; il se ferme quand il n'y a plus rien à choisir.
 */
export const useSyncDialogs = (syncConflict: boolean, hasConflictView: boolean) => {
  const [conflictOpen, setConflictOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  useEffect(() => { if (syncConflict) setConflictOpen(true); }, [syncConflict]);
  useEffect(() => { if (!hasConflictView) setConflictOpen(false); }, [hasConflictView]);
  const openConflict = useCallback(() => setConflictOpen(true), []);
  const closeConflict = useCallback(() => setConflictOpen(false), []);
  const openLogout = useCallback(() => setLogoutOpen(true), []);
  const closeLogout = useCallback(() => setLogoutOpen(false), []);
  return useMemo(() => ({ conflictOpen, openConflict, closeConflict, logoutOpen, openLogout, closeLogout }),
    [conflictOpen, openConflict, closeConflict, logoutOpen, openLogout, closeLogout]);
};
export type SyncDialogsState = ReturnType<typeof useSyncDialogs>;

type DialogData = Pick<PortfolioData,
  'conflict' | 'syncStatus' | 'syncConflict' | 'localBackup' | 'closeDuplicateComparison' | 'resolveConflict'
  | 'retryConflictLoad' | 'flushPendingChanges'>;

interface SyncDialogsHostProps {
  data: DialogData;
  dialogs: SyncDialogsState;
  addToast: AddToast;
  onLogout: (opts: { discardUnsynced: boolean }) => Promise<void>;
}

export const SyncDialogsHost: React.FC<SyncDialogsHostProps> = ({ data, dialogs, addToast, onLogout }) => {
  const blocker = sendBlocker(data.syncStatus, { conflictOpen: data.syncConflict, hasLocalBackup: !!data.localBackup });
  return (
    <>
      {data.conflict && (
        <Lazy><ConflictDialog
          open={dialogs.conflictOpen}
          conflict={data.conflict}
          onClose={() => { dialogs.closeConflict(); data.closeDuplicateComparison(); }}
          onResolve={data.resolveConflict}
          onRetry={data.retryConflictLoad}
          onResolved={(choice, kind) => {
            dialogs.closeConflict();
            addToast({
              kind: 'success',
              message: kind === 'duplicate'
                ? (choice === 'local' ? 'Fichier ouvert gardé.' : 'Contenu de l\'autre fichier repris. L\'ancien est mis de côté 30 jours (Paramètres, Sauvegardes).')
                : `${choice === 'local' ? 'Version de cet appareil gardée' : 'Version de Drive gardée'}. L'autre est mise de côté 30 jours (Paramètres, Sauvegardes).`,
            });
          }}
        /></Lazy>
      )}
      {dialogs.logoutOpen && <Lazy><LogoutDialog
        open={dialogs.logoutOpen}
        onClose={dialogs.closeLogout}
        canSend={blocker === null}
        cannotSendReason={CANNOT_SEND[blocker ?? 'offline']}
        onSend={data.flushPendingChanges}
        onLogout={async discard => { dialogs.closeLogout(); await onLogout({ discardUnsynced: discard }); }}
      /></Lazy>}
    </>
  );
};
