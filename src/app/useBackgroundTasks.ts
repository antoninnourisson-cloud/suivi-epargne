// Tâches de fond qui suivent les données : pastille sur l'icône de l'app installée et
// sauvegarde de secours chiffrée sur le serveur.
import { useEffect } from 'react';
import { computeBadgeCount } from '../lib/projection';
import { isBackendEnabled } from '../services/backendService';
import type { AppDoc } from '../types';

/** Pastille sur l'icône de l'app installée : nombre de choses à faire (`enabled` : données affichées). */
export const useAppBadge = (fullData: AppDoc, enabled: boolean) => {
  useEffect(() => {
    if (!enabled) return;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    const n = computeBadgeCount(fullData);
    (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => { /* non pris en charge */ });
  }, [fullData, enabled]);
};

/**
 * Sauvegarde de secours chiffrée (serveur) : au plus une fois par semaine, si les données ont
 * changé. Attend 30 s de calme après le chargement ou la dernière modification, ne bloque
 * jamais l'écran, et ne part que de données chargées de Drive sans rien en suspens (`ready`,
 * voir isSettledOnDrive). Code chargé à ce moment-là.
 */
export const useCloudBackup = (fullData: AppDoc, ready: boolean) => {
  useEffect(() => {
    if (!ready || !isBackendEnabled()) return;
    const t = setTimeout(() => {
      import('../services/cloudBackup').then(m => m.maybeAutoUpload(fullData)).catch(() => undefined);
    }, 30_000);
    return () => clearTimeout(t);
  }, [ready, fullData]);
};
