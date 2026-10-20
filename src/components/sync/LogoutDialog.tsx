// Déconnexion alors que des modifications ne sont pas encore sur Drive : deux choix clairs,
// « Envoyer puis se déconnecter » ou « Se déconnecter sans envoyer » (elles sont alors
// effacées de cet appareil), et « Annuler ».
import React, { useEffect, useState } from 'react';
import { AlertTriangle, CloudUpload } from 'lucide-react';
import { Modal } from '../Modal';
import { Button } from '../ui';
import { Notice } from '../settings/SettingsCard';

export const LogoutDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  /** L'envoi peut partir maintenant (en ligne, pas de conflit à régler, session valide). */
  canSend: boolean;
  /** Pourquoi l'envoi est impossible, en clair (si `canSend` est faux). */
  cannotSendReason?: string;
  /** Envoie ce qui n'est pas sur Drive ; true si Drive est à jour. */
  onSend: () => Promise<boolean>;
  /** Déconnexion, avec ou sans effacer les modifications non envoyées. */
  onLogout: (discardUnsynced: boolean) => void | Promise<void>;
}> = ({ open, onClose, canSend, cannotSendReason, onSend, onLogout }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (open) { setBusy(false); setFailed(false); } }, [open]);

  const send = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (await onSend()) { await onLogout(false); return; }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} label="Modifications pas encore sur Drive" className="max-w-md p-6">
      <h2 className="text-2xl text-on-surface mb-2">Modifications pas encore sur Drive</h2>
      <p className="text-sm text-on-surface-variant">
        Des modifications faites sur cet appareil ne sont pas encore enregistrées sur votre Drive. Envoyez-les avant de vous déconnecter pour les retrouver sur vos autres appareils.
      </p>
      {!canSend && cannotSendReason && (
        <Notice tone="warning" icon={AlertTriangle} className="mt-3">{cannotSendReason}</Notice>
      )}
      <div aria-live="assertive" className="mt-3 empty:hidden">
        {failed && (
          <Notice tone="error" icon={AlertTriangle}>
            L'envoi n'a pas abouti : vos modifications sont toujours sur cet appareil. Réessayez dans un moment, ou déconnectez-vous sans envoyer.
          </Notice>
        )}
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <Button variant="filled" onClick={() => void send()} disabled={!canSend || busy}>
          <CloudUpload className="w-4 h-4" aria-hidden="true" /> {busy ? 'Envoi en cours…' : 'Envoyer puis se déconnecter'}
        </Button>
        <Button variant="outlined" className="text-error! border-error/40!" disabled={busy} onClick={() => void onLogout(true)}>
          Se déconnecter sans envoyer
        </Button>
        <p className="text-xs text-on-surface-variant text-center">Sans envoi, ces modifications sont effacées de cet appareil.</p>
        <Button variant="text" disabled={busy} onClick={onClose}>Annuler</Button>
      </div>
    </Modal>
  );
};
