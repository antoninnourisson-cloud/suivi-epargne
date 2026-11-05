// Fenêtres de la synchronisation : choix entre deux versions (conflit entre appareils, fichier
// en double) et déconnexion avec des modifications pas encore sur Drive.
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PortfolioData } from '../hooks/usePortfolioData';
import { sendBlocker, type SendBlocker } from '../lib/sync/syncStatus';
import { lazyWithRetry } from '../components/ErrorBoundary';
import { ConflictDialog, Lazy, LogoutDialog } from './screens';
import { useDialog, type AddToast } from './UiProviders';

// Fichier Drive introuvable : fenêtre chargée à la demande, comme les autres fenêtres de la synchro.
const MissingFileDialog = lazyWithRetry(() => import('../components/sync/MissingFileDialog').then(m => ({ default: m.MissingFileDialog })));

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
/** Fichier Drive introuvable : facultatif ici (les tests de ces fenêtres ne le fournissent pas). */
type MissingFileData = Pick<PortfolioData, 'missingFile' | 'restoreMissingFromDevice' | 'startOverMissing'
  | 'restoreMissingFromBackup' | 'retryFindMissing' | 'listDriveBackups'>;

interface SyncDialogsHostProps {
  data: DialogData & Partial<MissingFileData>;
  dialogs: SyncDialogsState;
  addToast: AddToast;
  onLogout: (opts: { discardUnsynced: boolean }) => Promise<void>;
}

/** Fichier Drive introuvable : le choix s'affiche tant qu'il n'est pas fait (voir useMissingFile). */
const MissingFileHost: React.FC<{ data: MissingFileData; addToast: AddToast }> = ({ data, addToast }) => {
  const info = useSyncExternalStore(data.missingFile.subscribe, data.missingFile.getSnapshot);
  const dialog = useDialog();
  if (!info) return null;
  return (
    <Lazy><MissingFileDialog
      info={info}
      onRestoreDevice={data.restoreMissingFromDevice}
      onStartOver={data.startOverMissing}
      onRetryFind={data.retryFindMissing}
      listBackups={data.listDriveBackups}
      restoreBackup={data.restoreMissingFromBackup}
      confirm={(t, m, ok, label) => dialog.confirm(t, m, ok, true, label)}
      onDone={outcome => addToast({
        kind: 'success',
        message: outcome === 'found' ? 'Fichier retrouvé sur Drive.' : 'Votre fichier Pécule a été recréé sur Drive.',
      })}
    /></Lazy>
  );
};

export const SyncDialogsHost: React.FC<SyncDialogsHostProps> = ({ data, dialogs, addToast, onLogout }) => {
  const blocker = sendBlocker(data.syncStatus, { conflictOpen: data.syncConflict, hasLocalBackup: !!data.localBackup });
  return (
    <>
      {data.missingFile && <MissingFileHost data={data as MissingFileData} addToast={addToast} />}
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
