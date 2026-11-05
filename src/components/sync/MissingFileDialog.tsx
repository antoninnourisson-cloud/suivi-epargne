// « Votre fichier Pécule est introuvable sur Drive » : le fichier a disparu (corbeille, accès
// retiré) alors que cet appareil garde des données. Rien n'est créé ni écrasé tant que vous
// n'avez pas choisi : restaurer la copie de cet appareil, revenir à une copie mensuelle Drive,
// ou repartir de zéro (après confirmation). La fenêtre ne se ferme pas toute seule : il faut
// choisir, ou chercher à nouveau le fichier (par exemple après l'avoir sorti de la corbeille).
import React, { useState } from 'react';
import { AlertTriangle, ArchiveRestore, RefreshCw, Smartphone } from 'lucide-react';
import { Modal } from '../Modal';
import { Button } from '../ui';
import { Notice } from '../settings/SettingsCard';
import { DriveBackupsPanel } from '../SettingsPanels';
import type { DriveBackup } from '../../services/googleDriveService';
import type { MissingFileInfo, MissingFileOutcome } from '../../hooks/portfolio/missingFile';

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

const FAILURES: Partial<Record<MissingFileOutcome, string>> = {
  failed: 'Le fichier n\'a pas pu être créé sur Drive pour l\'instant. Rien n\'a été modifié : réessayez dans un moment.',
  invalid: 'La copie de cet appareil est inutilisable. Rien n\'a été modifié.',
  'set-aside-failed': 'La copie de cet appareil n\'a pas pu être mise de côté : rien n\'a été remplacé.',
};

export const MissingFileDialog: React.FC<{
  info: MissingFileInfo;
  onRestoreDevice: () => Promise<MissingFileOutcome>;
  onStartOver: () => Promise<MissingFileOutcome>;
  onRetryFind: () => Promise<unknown>;
  listBackups: () => Promise<DriveBackup[]>;
  restoreBackup: (id: string, label: string) => Promise<string | void>;
  confirm: (title: string, message: string, onOk: () => void | Promise<void>, confirmLabel?: string) => void;
  /** Un fichier est réapparu et a été ouvert, ou le fichier a été recréé. */
  onDone: (outcome: MissingFileOutcome) => void;
}> = ({ info, onRestoreDevice, onStartOver, onRetryFind, listBackups, restoreBackup, confirm, onDone }) => {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MissingFileOutcome | null>(null);
  const [confirmingZero, setConfirmingZero] = useState(false);

  const run = async (action: () => Promise<MissingFileOutcome>) => {
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await action();
      if (outcome === 'done' || outcome === 'found') { onDone(outcome); return; }
      setFailure(outcome);
      setConfirmingZero(false);
    } catch {
      setFailure('failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => {}} closeOnScrim={false} variant="sheet" label="Votre fichier Pécule est introuvable sur Drive" className="max-w-md p-6">
      <h2 className="text-2xl text-on-surface mb-2">Votre fichier Pécule est introuvable sur Drive</h2>
      <p className="text-sm text-on-surface-variant">
        Il a peut-être été mis à la corbeille, ou l'accès vous a été retiré. Rien n'a été créé ni effacé : choisissez ce qu'il faut faire.
      </p>
      {info.unreadable && (
        <Notice tone="warning" icon={AlertTriangle} className="mt-3">
          {info.copyAt
            ? 'Une autre copie gardée sur cet appareil n\'a pas pu être relue (la clé qui la protégeait n\'est plus disponible).'
            : 'Cet appareil garde une copie de vos données, mais elle ne peut pas être relue (la clé qui la protégeait n\'est plus disponible).'}
        </Notice>
      )}
      <div aria-live="assertive" className="mt-3 empty:hidden">
        {failure && FAILURES[failure] && <Notice tone="error" icon={AlertTriangle}>{FAILURES[failure]}</Notice>}
      </div>

      {confirmingZero ? (
        <div className="mt-5 flex flex-col gap-2" role="group" aria-label="Confirmer le départ de zéro">
          <Notice tone="error" icon={AlertTriangle}>
            Un nouveau fichier vide sera créé sur votre Drive. {info.copyAt ? 'La copie de cet appareil est mise de côté 30 jours (Paramètres, Sauvegardes).' : ''}
          </Notice>
          <Button variant="danger" disabled={busy} onClick={() => void run(onStartOver)}>{busy ? 'Création…' : 'Oui, repartir de zéro'}</Button>
          <Button variant="text" disabled={busy} onClick={() => setConfirmingZero(false)}>Non, revenir au choix</Button>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-2">
          {info.copyAt && (
            <Button variant="filled" disabled={busy} onClick={() => void run(onRestoreDevice)}>
              <Smartphone className="w-4 h-4" aria-hidden="true" /> {busy ? 'Création du fichier…' : `Restaurer la copie de cet appareil (${when(info.copyAt)})`}
            </Button>
          )}
          <Button variant="tonal" disabled={busy} onClick={() => { setFailure(null); void onRetryFind(); }}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Chercher à nouveau le fichier
          </Button>
          <p className="text-xs text-on-surface-variant">Si vous l'avez sorti de la corbeille de Drive, touchez « Chercher à nouveau ».</p>
        </div>
      )}

      {!confirmingZero && (
        <>
          {/* Copies mensuelles Drive : le même écran qu'en Paramètres, ici elles recréent le fichier. */}
          <DriveBackupsPanel list={listBackups} restore={restoreBackup} confirm={confirm} />
          <div className="pt-5 mt-5 border-t border-outline-variant">
            <p className="flex items-start gap-2 text-xs text-on-surface-variant">
              <ArchiveRestore className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
              <span>La sauvegarde de secours chiffrée se restaure dans Paramètres, Sauvegardes, une fois votre fichier recréé par l'un des choix ci-dessus.</span>
            </p>
            <Button variant="outlined" className="mt-4 w-full text-error! border-error/40!" disabled={busy} onClick={() => setConfirmingZero(true)}>
              Repartir de zéro
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
};
