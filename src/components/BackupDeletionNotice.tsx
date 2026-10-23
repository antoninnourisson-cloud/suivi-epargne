// Effacement des copies de secours programmé sur le serveur (7 jours, annulable) : affiché en
// haut de l'app à chaque ouverture. Il reste ainsi visible même si quelqu'un qui aurait pris
// la main sur une session a d'abord coupé les notifications du propriétaire, puis demandé
// l'effacement (voir scheduleBackupDeletion dans worker/src/index.ts).
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui';
import { useToast } from './Toast';
import { hasBackendSession, isBackendEnabled } from '../services/backendService';
import { openSettingsSection } from './settings/sections';
import type { ServerDeletion } from '../services/cloudBackup';

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const dateTimeLabel = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export const BackupDeletionNotice: React.FC<{
  /** Données affichées (après le chargement) : la vérification part à ce moment-là, une fois. */
  active: boolean;
  /** Affiche l'écran Paramètres (la carte « Données » est ouverte d'abord). */
  onOpenSettings: () => void;
}> = ({ active, onOpenSettings }) => {
  const toast = useToast();
  const [deletion, setDeletion] = useState<ServerDeletion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checked = useRef(false);

  useEffect(() => {
    if (!active || checked.current || !isBackendEnabled() || !hasBackendSession()) return;
    checked.current = true;
    // Code de la sauvegarde chargé à la demande (comme l'envoi automatique).
    import('../services/cloudBackup')
      .then(m => m.getServerDeletion())
      .then(setDeletion)
      .catch(() => { checked.current = false; }); // hors ligne : nouvel essai à la prochaine activation
  }, [active]);

  if (!deletion) return null;

  const cancel = async () => {
    setBusy(true);
    setError('');
    try {
      const m = await import('../services/cloudBackup');
      await m.cancelServerDeletion();
      setDeletion(null);
      toast?.({ kind: 'success', message: 'Effacement annulé : vos copies de secours sont gardées.' });
    } catch {
      setError('Le serveur est injoignable : l\'effacement n\'est pas annulé. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" data-testid="backup-deletion-notice"
      className="mb-4 bg-error-container text-on-error-container rounded-2xl p-4 flex flex-col gap-3">
      <p className="flex items-start gap-2 text-sm">
        <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-bold">Vos copies de secours seront effacées le {dayLabel(deletion.purgeAt)}.</strong>
          {' '}L'effacement a été demandé le {dateTimeLabel(deletion.requestedAt)}. Ce n'est pas vous ? Annulez-le, puis
          déconnectez dans Paramètres les appareils que vous ne reconnaissez pas.
        </span>
      </p>
      {error && <p className="text-sm font-medium">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="filled" className="min-h-12 sm:min-h-10" isLoading={busy} onClick={() => void cancel()}>Annuler l'effacement</Button>
        <Button variant="text" className="min-h-12 sm:min-h-10" onClick={() => { openSettingsSection('data'); onOpenSettings(); }}>Voir dans Paramètres</Button>
      </div>
    </div>
  );
};
