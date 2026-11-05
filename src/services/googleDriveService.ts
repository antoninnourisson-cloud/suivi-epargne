// ================================================
// FILE: src/services/googleDriveService.ts
// Version web-only (PWA). Auth Google Identity Services + Drive via fetch.
// Façade : le code vit dans src/services/drive/, découpé par sujet (session, fichier de
// données, sauvegardes mensuelles, sélecteur Picker). Rien d'autre n'importe ces fichiers :
// tout passe par ici, pour que les appelants et les tests gardent la même adresse.
// ================================================

export {
  setOnAuthLost, initGoogleApi, isTokenValid, handleAuthClick, hasStoredSession, completeBackendLoginIfPresent,
  resumeSession, ApiError, driveErrorReason, handleSignOut,
} from './drive/session';
export type { SessionStart } from './drive/session';

export {
  findConfigFiles, readConfigFile, getFileRevision, getFileMeta, createConfigFile, ConflictError, ConcurrentWriteError,
  fetchRevisionContent, updateConfigFile,
} from './drive/dataFile';
export type { DriveFileInfo, FileMeta } from './drive/dataFile';

export { listBackups, writeMonthlyBackup } from './drive/backups';
export type { DriveBackup } from './drive/backups';

export { openDrivePicker, downloadFileAsBase64 } from './drive/picker';
export type { PickedDriveFile } from './drive/picker';
