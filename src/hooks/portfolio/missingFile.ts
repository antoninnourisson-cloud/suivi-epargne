// Fichier de données introuvable sur Drive (mis à la corbeille, accès retiré) alors que cet
// appareil garde des données : rien n'est créé ni écrasé, l'utilisateur choisit (voir
// MissingFileDialog). Ce petit magasin porte ce qu'il faut montrer ; la copie elle-même
// (les données) reste ici, jamais dans l'état React ni dans un journal.
import type { StoredSnapshot } from './syncShared';

/** Ce que la fenêtre de choix affiche. */
export interface MissingFileInfo {
  /** Date de la copie de cet appareil qu'on peut restaurer ; null s'il n'y en a pas de lisible. */
  copyAt: string | null;
  /** Une copie existe mais ne peut pas être relue (clé effacée, stockage protégé indisponible). */
  unreadable: boolean;
}

/** Résultat d'une action de la fenêtre de choix. */
export type MissingFileOutcome = 'done' | 'found' | 'failed' | 'set-aside-failed' | 'invalid';

/** Magasin lisible par React (useSyncExternalStore) : identité stable, `getSnapshot` change seulement si l'affichage change. */
export const createMissingFileStore = () => {
  let info: MissingFileInfo | null = null;
  let copy: StoredSnapshot | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(l => l());
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: (): MissingFileInfo | null => info,
    /** Le fichier est introuvable : `newest` est la copie la plus récente de l'appareil, si lisible. */
    show(newest: StoredSnapshot | null, unreadable: boolean) {
      copy = newest;
      const next = { copyAt: newest?.savedAt ?? null, unreadable };
      if (info && info.copyAt === next.copyAt && info.unreadable === next.unreadable) return;
      info = next;
      notify();
    },
    clear() {
      copy = null;
      if (info === null) return;
      info = null;
      notify();
    },
    /** Copie de l'appareil proposée à la restauration. */
    copy: (): StoredSnapshot | null => copy,
  };
};
export type MissingFileStore = ReturnType<typeof createMissingFileStore>;
/** Ce que l'interface en voit (sans la copie). */
export type MissingFileView = Pick<MissingFileStore, 'subscribe' | 'getSnapshot'>;
