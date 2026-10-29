// Stockage « persistant » de l'appareil (navigator.storage.persist). Par défaut, le stockage
// d'un site est « au mieux » : sur un téléphone presque plein, le navigateur peut l'effacer
// d'un bloc, sans prévenir. Pour Pécule, il contient la clé qui chiffre les copies locales,
// les saisies pas encore envoyées sur Drive, la copie hors ligne et le verrou de l'appareil.
// Demandé après la connexion, sans jamais bloquer : Chrome l'accorde (ou non) sans afficher
// de question, d'après l'usage du site (app installée, souvent ouverte) ; Firefox peut
// demander l'accord. Un refus ne change rien au fonctionnement : Drive reste la référence.

export type PersistState = 'granted' | 'not-granted' | 'unsupported';

type StorageManagerLike = Pick<StorageManager, 'persist' | 'persisted'>;

const manager = (): StorageManagerLike | null => {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    return s && typeof s.persist === 'function' && typeof s.persisted === 'function' ? s : null;
  } catch { return null; }
};

/** État actuel, sans rien demander. */
export const getPersistState = async (): Promise<PersistState> => {
  const s = manager();
  if (!s) return 'unsupported';
  try { return (await s.persisted()) ? 'granted' : 'not-granted'; } catch { return 'not-granted'; }
};

/** Demande la protection (sans effet si elle est déjà accordée). Ne lève jamais. */
export const requestPersist = async (): Promise<PersistState> => {
  const s = manager();
  if (!s) return 'unsupported';
  try {
    if (await s.persisted()) return 'granted';
    return (await s.persist()) ? 'granted' : 'not-granted';
  } catch { return 'not-granted'; }
};

let asked = false;
/**
 * Demande faite une fois par session, au premier moment utile (après la connexion ou la
 * première copie locale) : appelée plusieurs fois, elle ne redemande pas.
 */
export const requestPersistOnce = (): void => {
  if (asked) return;
  asked = true;
  void requestPersist();
};

/** Pour les tests : oublie la demande de la session. */
export const resetPersistRequestForTests = () => { asked = false; };
