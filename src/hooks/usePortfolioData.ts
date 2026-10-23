// Données de l'app : façade qui assemble trois morceaux, chacun dans son fichier.
//  - le document et ses modifications (portfolio/useDocument) ;
//  - la synchronisation avec Drive (portfolio/useDriveSync), dont l'état est un seul objet
//    (lib/sync/syncStatus) ;
//  - les points mensuels de l'historique (portfolio/useMonthlySnapshots).
// Les valeurs dérivées pour les écrans sont calculées dans src/app/useDerivedData.
//
// Ajouter un champ au fichier ne demande que son type, sa valeur par défaut (src/lib/schema.ts)
// et son interface : les écrans lisent `doc` (normalisé, voir AppDoc) et le modifient par les
// setters ou `patchConfig`.
import { useMemo } from 'react';
import { useDocument } from './portfolio/useDocument';
import { useDriveSync } from './portfolio/useDriveSync';
import { useMonthlySnapshots } from './portfolio/useMonthlySnapshots';

export type {
  ConflictVersion, SyncConflictView, ImportOutcome, ConflictChoice, ConflictResolution, SyncFailure,
} from './portfolio/syncShared';

export const usePortfolioData = (isAuthenticated: boolean) => {
  const docState = useDocument();
  const sync = useDriveSync(isAuthenticated, docState);
  useMonthlySnapshots(docState.doc, docState.setDoc, sync.isLoaded, sync.loadCount);

  const { doc } = docState;
  const c = doc.config;
  const s = sync.status;
  // Champs du document lus par les écrans (déjà normalisés par migrate()).
  const fields = useMemo(() => ({
    accounts: doc.accounts,
    expenses: doc.expenses,
    history: doc.history,
    expensesHistory: doc.expensesHistory,
    payslips: doc.payslips,
    recurringMovements: doc.recurringMovements,
    subscriptions: doc.subscriptions,
    donations: doc.donations,
    payChecklist: doc.payChecklist,
    parentalRestitution: doc.parentalRestitution,
    activePayslipId: doc.activePayslipId,
    fiscalConfig: doc.fiscalConfig,
    workBenefits: doc.workBenefits,
    config: c,
    leisureBudget: c.leisureBudget,
    pickerApiKey: c.pickerApiKey ?? '',
  }), [doc, c]);

  return {
    // Données
    doc,
    ...fields,
    geminiApiKey: docState.geminiApiKey,
    setGeminiApiKey: docState.setGeminiApiKey,
    lastView: docState.lastView,
    setLastView: docState.setLastView,
    buildData: docState.buildData,
    /** État le plus récent, à lire au moment d'une action (copie de secours, export). */
    currentData: docState.currentData,
    ...docState.setters,
    exportData: docState.exportData,

    // Statut de la synchronisation (un seul objet ; les champs à plat restent pour l'interface)
    syncStatus: s,
    isLoadingData: s.loading,
    isSaving: s.saving,
    syncError: s.error !== null,
    syncErrorInfo: s.error,
    syncConflict: sync.syncConflict,
    conflict: sync.conflict,
    duplicateFile: sync.duplicateFile,
    sessionExpired: s.sessionExpired,
    appOutdated: s.appOutdated,
    localBackup: sync.localBackup,
    /** Copie jamais envoyée illisible : 'lost' (définitivement), 'unavailable' (pour l'instant), sinon null. */
    unreadableLocalCopy: sync.unreadableCopies.length === 0 ? null : sync.unreadableCopies.some(u => u.lost) ? 'lost' as const : 'unavailable' as const,
    lastSavedAt: sync.lastSavedAt,
    isOffline: s.offline,
    loadFailed: s.loadFailed,
    remoteUpdatedAt: sync.remoteUpdatedAt,
    dataShown: sync.dataShown,
    offlineDataAt: sync.offlineDataAt,

    // Actions de synchronisation et de restauration (identités stables)
    ...sync.actions,
    importData: sync.restore.importData,
    listDriveBackups: sync.restore.listDriveBackups,
    restoreDriveBackup: sync.restore.restoreDriveBackup,
    listSetAsideVersions: sync.restore.listSetAsideVersions,
    recoverSetAside: sync.restore.recoverSetAside,
  };
};

export type PortfolioData = ReturnType<typeof usePortfolioData>;
