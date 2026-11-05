// ================================================
// FILE: worker/src/handlers/pushStore.ts
// Stockage KV des abonnements push et effacement des données d'un utilisateur.
// Découpé de worker/src/index.ts sans changement de comportement.
// ================================================
import { DAY, deleteAllSessions, sessionExists } from '../sessions';
import { StoredSubscription, readStoredList } from '../subscriptions';
import { userKey } from '../userRecords';
import type { Env } from '../index';

export const pushKey = (sub: string) => `push:${sub}`;
export const readPushList = async (env: Env, sub: string): Promise<StoredSubscription[]> =>
  readStoredList(await env.STORE.get(pushKey(sub), 'json'));
export const writePushList = (env: Env, sub: string, list: StoredSubscription[]) =>
  list.length === 0 ? env.STORE.delete(pushKey(sub)) : env.STORE.put(pushKey(sub), JSON.stringify(list));

// Abonnements retirés par une AUTRE session (« Retirer » un appareil, « Déconnecter » une
// session, « Déconnecter tous les appareils ») : gardés 30 jours pour la seule alerte
// d'effacement des copies de secours. Sinon une session volée retirerait d'abord les
// appareils du propriétaire, puis demanderait l'effacement sans que personne en soit prévenu.
const RECENTLY_REMOVED_TTL = 30 * DAY;
const MAX_RECENTLY_REMOVED = 10;
export const removedPushKey = (sub: string) => `push-removed:${sub}`;

export const rememberRemovedSubscriptions = async (env: Env, sub: string, removed: StoredSubscription[]): Promise<void> => {
  if (removed.length === 0) return;
  const endpoints = new Set(removed.map(x => x.endpoint));
  const previous = readStoredList(await env.STORE.get(removedPushKey(sub), 'json')).filter(x => !endpoints.has(x.endpoint));
  const list = [...removed.map(x => ({ endpoint: x.endpoint, keys: x.keys })), ...previous].slice(0, MAX_RECENTLY_REMOVED);
  await env.STORE.put(removedPushKey(sub), JSON.stringify(list), { expirationTtl: RECENTLY_REMOVED_TTL });
};

/** Retire les abonnements dont la session propriétaire n'existe plus (les anciens, sans session, restent). */
export const pruneOrphanSubscriptions = async (env: Env, list: StoredSubscription[]): Promise<StoredSubscription[]> => {
  const alive: StoredSubscription[] = [];
  for (const s of list) {
    if (!s.sessionHash || await sessionExists(env.STORE, s.sessionHash)) alive.push(s);
  }
  return alive;
};

const deletePrefix = async (store: KVNamespace, prefix: string): Promise<number> => {
  let cursor: string | undefined;
  let n = 0;
  do {
    const page = await store.list({ prefix, cursor });
    for (const k of page.keys) { await store.delete(k.name); n++; }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return n;
};

/**
 * Efface ce que le serveur sait d'un utilisateur (sessions, jeton Google, abonnements,
 * marqueurs « déjà envoyé »), SAUF les sauvegardes de secours chiffrées : elles doivent
 * survivre à une reconnexion forcée (accès Google révoqué ou expiré) comme à une session
 * volée. Elles ne partent que par un effacement programmé (7 jours, annulable : voir
 * scheduleBackupDeletion), ou d'elles-mêmes au bout d'un an (BACKUP_TTL) ; le serveur ne
 * peut pas les lire.
 */
export const purgeUser = async (store: KVNamespace, sub: string, alsoSessionHash?: string): Promise<void> => {
  await deleteAllSessions(store, sub, alsoSessionHash);
  await store.delete(userKey(sub));
  await store.delete(pushKey(sub));
  await store.delete(removedPushKey(sub));
  await deletePrefix(store, `sent:${sub}:`);
};
