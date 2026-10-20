// ================================================
// FILE: worker/src/userRecords.ts
// Compte Google gardé par le serveur : refresh token CHIFFRÉ, e-mail et identifiant.
//
//   user:<sub>   { email, refreshTokenEnc, updatedAt, touchedAt }
//
// Conservation (page public/confidentialite.html, « Durées de conservation ») : seulement
// tant qu'il sert, c'est-à-dire tant qu'une session de l'app est ouverte (pour /token) ou
// qu'un appareil reçoit les notifications (tâche quotidienne). Concrètement :
// - effacé dès qu'il ne sert plus : déconnexion du dernier appareil, déconnexion de tous
//   les appareils, ou tâche quotidienne (`releaseUserIfUnused`, qui épargne un compte écrit
//   depuis moins de 10 minutes : connexion en cours) ;
// - durée de vie KV de USER_TTL, prolongée à chaque usage (au plus une écriture par jour) :
//   même si la tâche quotidienne ne tournait plus, rien ne reste au-delà de 61 jours sans
//   usage (une session dure 60 jours au plus, voir sessions.ts) ;
// - accès retiré chez Google : constaté à la demande suivante ou par la tâche quotidienne,
//   qui tente un rafraîchissement pour chaque compte (index.ts).
// ================================================
import { DAY, SESSION_MAX_AGE, readSessionIndex, sessionExists } from './sessions';
import { readStoredList } from './subscriptions';

export interface UserRecord {
  email: string;
  refreshTokenEnc: string;
  updatedAt: number;
  /** Dernière prolongation de la durée de vie (ms). Absent sur les comptes d'avant la règle. */
  touchedAt?: number;
}

/** Durée de vie KV du compte (s) : la plus longue session possible, plus un jour de marge. */
export const USER_TTL = SESSION_MAX_AGE + DAY;
export const USER_PREFIX = 'user:';
export const userKey = (sub: string) => `${USER_PREFIX}${sub}`;

export const readUser = (store: KVNamespace, sub: string): Promise<UserRecord | null> =>
  store.get<UserRecord>(userKey(sub), 'json');

/** Écrit le compte avec une durée de vie neuve. */
export const writeUser = (store: KVNamespace, sub: string, record: UserRecord, nowMs = Date.now()): Promise<void> =>
  store.put(userKey(sub), JSON.stringify({ ...record, touchedAt: nowMs } satisfies UserRecord), { expirationTtl: USER_TTL });

/** Prolonge la durée de vie après un usage, au plus une écriture par jour (quota KV). */
export const touchUser = async (store: KVNamespace, sub: string, record: UserRecord, nowMs = Date.now()): Promise<void> => {
  if (record.touchedAt !== undefined && nowMs - record.touchedAt < DAY * 1000) return;
  await writeUser(store, sub, record, nowMs);
};

/**
 * Le compte sert-il encore ? Oui s'il reste une session vivante, ou un abonnement push
 * vivant (rattaché à une session vivante, ou ancien abonnement sans session).
 */
export const isUserInUse = async (store: KVNamespace, sub: string, nowMs = Date.now()): Promise<boolean> => {
  if ((await readSessionIndex(store, sub, nowMs)).length > 0) return true;
  const subs = readStoredList(await store.get(`push:${sub}`, 'json'));
  for (const s of subs) {
    if (!s.sessionHash || await sessionExists(store, s.sessionHash, nowMs)) return true;
  }
  return false;
};

/**
 * Délai de grâce de la tâche quotidienne : un compte écrit il y a moins de 10 minutes (une
 * connexion en cours) n'est jamais effacé par elle, même si sa session n'est pas encore
 * visible (KV peut mettre une minute environ à propager une écriture d'un lieu à l'autre).
 */
export const RECENT_WRITE_GRACE_MS = 10 * 60 * 1000;

/**
 * Efface le compte s'il ne sert plus. Renvoie `true` s'il a été effacé. `graceMs` (tâche
 * quotidienne) : un compte écrit depuis moins longtemps est gardé. La déconnexion n'en a pas
 * besoin : la connexion crée sa session AVANT d'écrire le compte (handleAuthCallback).
 */
export const releaseUserIfUnused = async (
  store: KVNamespace, sub: string, nowMs = Date.now(), opts: { graceMs?: number } = {},
): Promise<boolean> => {
  if (await isUserInUse(store, sub, nowMs)) return false;
  if (opts.graceMs) {
    const touchedAt = (await readUser(store, sub))?.touchedAt;
    if (touchedAt !== undefined && nowMs - touchedAt < opts.graceMs) return false;
  }
  await store.delete(userKey(sub));
  return true;
};
