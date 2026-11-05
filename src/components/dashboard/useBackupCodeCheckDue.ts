// Rappels de la sauvegarde de secours (Accueil) : sauvegarde chiffrée activée sur cet appareil.
// La clé est rangée dans IndexedDB (services/cloudBackup, chargé à la demande, seulement avec
// le serveur) ; les règles sont dans lib/recoveryCodeCheck :
//  - le code de secours pas retapé depuis un an ;
//  - le dernier envoi vieux de plus de 30 jours, ou une erreur récente (tâche qui disparaît
//    dès qu'un envoi réussit).
// Relu à chaque ouverture de l'Accueil : un code retapé juste dans les Paramètres retire le
// rappel au retour.
import { useEffect, useState } from 'react';
import { isBackendEnabled } from '../../services/backendService';
import { backupCodeCheckDue, backupUploadProblem, type BackupUploadProblem } from '../../lib/recoveryCodeCheck';

export interface BackupReminders {
  codeCheckDue: boolean;
  /** Pour une erreur : `reason` est la phrase en clair (FAILURE_MESSAGES). */
  uploadProblem: (BackupUploadProblem & { reason?: string }) | null;
}
const NONE: BackupReminders = { codeCheckDue: false, uploadProblem: null };

export const useBackupCodeCheckDue = (): BackupReminders => {
  const [state, setState] = useState<BackupReminders>(NONE);
  useEffect(() => {
    if (!isBackendEnabled()) return;
    let alive = true;
    import('../../services/cloudBackup')
      .then(async m => {
        if (!m.isCloudBackupAvailable()) return NONE;
        const enrollment = await m.getDeviceEnrollment();
        const now = new Date();
        const problem = backupUploadProblem(enrollment, m.readStatus(), now);
        const reason = problem?.kind === 'error' ? m.FAILURE_MESSAGES[problem.code as keyof typeof m.FAILURE_MESSAGES] : undefined;
        return { codeCheckDue: backupCodeCheckDue(enrollment, now), uploadProblem: problem && { ...problem, ...(reason ? { reason } : {}) } };
      })
      .then(next => { if (alive) setState(next); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return state;
};
