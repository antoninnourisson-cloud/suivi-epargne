// Remplacer les données affichées par une autre version : import d'un fichier, copie
// mensuelle Drive, version mise de côté. Les données actuelles sont TOUJOURS mises de côté
// d'abord (30 jours, chiffrées) : chaque remplacement se défait. La sauvegarde automatique
// envoie ensuite la nouvelle version, avec contrôle de révision (voir useDriveSync).
import { useCallback } from 'react';
import type { RefObject } from 'react';
import { validateImport } from '../../lib/schema';
import { setAsideVersion, getSetAside, removeSetAside, listSetAside, type SetAsideVersion } from '../../services/setAsideVersions';
import { listBackups, readConfigFile, type DriveBackup } from '../../services/googleDriveService';
import type { DocumentState } from './useDocument';
import type { ImportOutcome } from './syncShared';

/** Ce que le moteur de synchronisation sait des données affichées. */
export interface ShownDataRefs {
  /** Un chargement Drive a réussi. */
  hasLoadedRef: RefObject<boolean>;
  /** La copie hors ligne est affichée. */
  offlineRef: RefObject<unknown>;
  /** Fichier Drive ouvert. */
  driveFileIdRef: RefObject<string | null>;
}

export const useRestoreActions = (docState: DocumentState, { hasLoadedRef, offlineRef, driveFileIdRef }: ShownDataRefs) => {
  const { applyData, currentData, docRef, setDoc } = docState;

  /** Met l'état affiché de côté (30 jours, chiffré) avant de le remplacer. Lève si c'est impossible. */
  const setAsideCurrent = useCallback((reason: SetAsideVersion['reason'], label: string) =>
    setAsideVersion({ reason, label, savedAt: new Date().toISOString(), fileId: driveFileIdRef.current ?? undefined, data: currentData() }),
  [currentData, driveFileIdRef]);

  /**
   * Import d'un fichier local. Le fichier est contrôlé avant de remplacer quoi que ce soit, et
   * les données actuelles sont d'abord mises de côté (récupérables 30 jours).
   * `requireSetAside` (restauration de la sauvegarde de secours, qui le promet) : si elles ne
   * peuvent pas l'être, rien n'est remplacé et l'erreur SET_ASIDE_FAILED est levée. Sinon
   * (import d'un fichier), la mise de côté est tentée sans bloquer l'import.
   * Renvoie l'identifiant de la version mise de côté (`undoId`) : « Annuler » la remet
   * (`recoverSetAside`).
   */
  const importData = useCallback(async (file: File, opts?: { requireSetAside?: boolean }): Promise<ImportOutcome> => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const errors = validateImport(parsed);
      if (errors.length > 0) { console.error('Import refusé', errors); return { ok: false }; }
      let undoId: string | undefined;
      if (hasLoadedRef.current || offlineRef.current) {
        try {
          undoId = await (opts?.requireSetAside
            ? setAsideCurrent('restore', 'Vos données avant le retour à une copie de secours')
            : setAsideCurrent('import', 'Vos données avant un import'));
        } catch (err) {
          if (opts?.requireSetAside) throw new Error('SET_ASIDE_FAILED', { cause: err });
          console.warn('Données actuelles non mises de côté', err);
        }
      }
      // Clé Picker déjà réglée : jamais remplacée par celle du fichier importé (un fichier
      // piégé ne doit pas changer les clés de l'utilisateur). La clé Gemini d'un fichier
      // importé n'est jamais reprise (voir applyData).
      const keepPicker = docRef.current.config.pickerApiKey;
      applyData(parsed);
      setDoc(d => ({ ...d, config: { ...d.config, pickerApiKey: keepPicker || d.config.pickerApiKey } }));
      return { ok: true, undoId };
    } catch (e) {
      if (e instanceof Error && e.message === 'SET_ASIDE_FAILED') throw e; // rien n'a été remplacé
      console.error('Import échoué', e);
      return { ok: false };
    }
  }, [applyData, setAsideCurrent, docRef, setDoc, hasLoadedRef, offlineRef]);

  // --- COPIES MENSUELLES DRIVE ---
  const listDriveBackups = useCallback((): Promise<DriveBackup[]> => listBackups(), []);
  /**
   * Revient à une copie mensuelle. Les données actuelles sont d'abord mises de côté : la
   * restauration se défait (`recoverSetAside` avec l'identifiant renvoyé). Si elles ne
   * peuvent pas l'être, rien n'est remplacé (erreur SET_ASIDE_FAILED).
   */
  const restoreDriveBackup = useCallback(async (id: string, label?: string): Promise<string> => {
    const raw: unknown = await readConfigFile(id);
    if (validateImport(raw).length > 0) throw new Error('Copie illisible');
    let undoId: string;
    try {
      undoId = await setAsideCurrent('restore', `Vos données avant le retour à la copie${label ? ` ${label}` : ''}`);
    } catch {
      throw new Error('SET_ASIDE_FAILED');
    }
    applyData(raw);
    return undoId;
  }, [applyData, setAsideCurrent]);

  /** Versions mises de côté pour le fichier ouvert (les plus récentes d'abord). */
  const listSetAsideVersions = useCallback(() => listSetAside(driveFileIdRef.current), [driveFileIdRef]);
  /**
   * Remet une version mise de côté. L'état actuel est mis de côté à son tour (on peut donc
   * revenir en arrière) ; false si la version est illisible ou si l'état actuel n'a pas pu
   * être gardé (rien n'est alors remplacé).
   */
  const recoverSetAside = useCallback(async (entryId: string): Promise<boolean> => {
    const entry = await getSetAside(entryId);
    if (!entry || validateImport(entry.data).length > 0) return false;
    try { await setAsideCurrent('recover', 'Vos données avant la récupération d\'une version mise de côté'); } catch { return false; }
    applyData(entry.data);
    await removeSetAside(entryId);
    return true;
  }, [applyData, setAsideCurrent]);

  return { setAsideCurrent, importData, listDriveBackups, restoreDriveBackup, listSetAsideVersions, recoverSetAside };
};
