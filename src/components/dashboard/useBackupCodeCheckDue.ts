// Rappel annuel du code de secours (Accueil) : sauvegarde chiffrée activée sur cet appareil
// et code pas retapé depuis un an ? La clé est rangée dans IndexedDB (services/cloudBackup,
// chargé à la demande, seulement avec le serveur) ; la règle est dans lib/recoveryCodeCheck.
// Relu à chaque ouverture de l'Accueil : un code retapé juste dans les Paramètres retire le
// rappel au retour.
import { useEffect, useState } from 'react';
import { isBackendEnabled } from '../../services/backendService';
import { backupCodeCheckDue } from '../../lib/recoveryCodeCheck';

export const useBackupCodeCheckDue = (): boolean => {
  const [due, setDue] = useState(false);
  useEffect(() => {
    if (!isBackendEnabled()) return;
    let alive = true;
    import('../../services/cloudBackup')
      .then(m => (m.isCloudBackupAvailable() ? m.getDeviceEnrollment() : null))
      .then(enrollment => { if (alive) setDue(backupCodeCheckDue(enrollment, new Date())); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return due;
};
