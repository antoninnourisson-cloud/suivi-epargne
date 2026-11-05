// ================================================
// FILE: src/services/drive/backups.ts
// Sauvegardes mensuelles sur Drive (une copie par mois, les 12 dernières gardées).
// Découpé de googleDriveService.ts sans changement de comportement.
// ================================================
import { authedFetch } from './session';
import { createConfigFile } from './dataFile';

// --- SAUVEGARDES MENSUELLES ---
// Drive ne garde les anciennes révisions d'un fichier que 30 jours (ou 100 révisions), et
// l'app sauvegarde souvent : sans copie à part, une erreur découverte trop tard n'aurait
// plus de version saine où revenir. Une copie par mois, les 12 dernières gardées (les plus
// anciennes vont à la corbeille Drive, récupérables 30 jours).
const BACKUP_PREFIX = 'suivi_epargne_backup_';
const BACKUPS_KEPT = 12;

export interface DriveBackup { id: string; name: string; createdTime: string; month: string }

export const listBackups = async (): Promise<DriveBackup[]> => {
  const q = encodeURIComponent(`name contains '${BACKUP_PREFIX}' and trashed = false`);
  const res = await authedFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime desc&pageSize=50`);
  const data = await res.json();
  return (data.files || [])
    .filter((f: { name: string }) => f.name.startsWith(BACKUP_PREFIX))
    .map((f: { id: string; name: string; createdTime: string }) => ({ ...f, month: f.name.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + 7) }));
};

/** Crée la copie du mois si elle n'existe pas encore. Renvoie true si une copie a été créée. */
export const writeMonthlyBackup = async (monthKey: string, data: unknown): Promise<boolean> => {
  const existing = await listBackups();
  if (existing.some(b => b.month === monthKey)) return false;
  await createConfigFile(data, `${BACKUP_PREFIX}${monthKey}.json`);
  const stale = [...existing].sort((a, b) => b.month.localeCompare(a.month)).slice(BACKUPS_KEPT - 1);
  for (const b of stale) {
    await authedFetch(`https://www.googleapis.com/drive/v3/files/${b.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
    }).catch(() => { /* une copie de trop n'est pas grave */ });
  }
  return true;
};
