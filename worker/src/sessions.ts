// ================================================
// FILE: worker/src/sessions.ts
// Sessions des appareils et index par utilisateur.
//
//   session:<hash>   { sub, email, createdAt, refreshedAt } — clé = SHA-256 du jeton
//   sessions:<sub>   tableau JSON des empreintes de sessions de l'utilisateur
//
// Durée de vie : glissante (SESSION_IDLE_TTL sans utilisation), mais JAMAIS au-delà de
// createdAt + SESSION_MAX_AGE, quel que soit l'usage.
// ================================================
import { randomToken, sha256b64url } from './crypto';

export const DAY = 86_400;
export const SESSION_MAX_AGE = 60 * DAY;   // plafond absolu (secondes)
export const SESSION_IDLE_TTL = 30 * DAY;  // expiration sans utilisation (secondes)
export const MAX_SESSIONS_PER_USER = 20;
const MIN_KV_TTL = 60;                     // minimum accepté par KV pour expirationTtl

export interface SessionRecord {
  sub: string;
  email: string;
  createdAt?: number;     // absent sur les sessions créées avant le plafond absolu
  refreshedAt: number;
  indexed?: boolean;      // déjà présente dans sessions:<sub>
}

const sessionKey = (hash: string) => `session:${hash}`;
const indexKey = (sub: string) => `sessions:${sub}`;

/** TTL KV (s) d'une session : l'inactivité, bornée par le plafond absolu. ≤ 0 = expirée. */
export const sessionTtl = (createdAtMs: number, nowMs: number): number =>
  Math.min(SESSION_IDLE_TTL, Math.floor((createdAtMs + SESSION_MAX_AGE * 1000 - nowMs) / 1000));

const isSessionExpired = (s: SessionRecord, nowMs: number): boolean =>
  s.createdAt !== undefined && nowMs >= s.createdAt + SESSION_MAX_AGE * 1000;

// ---------- Index ----------

const readRawIndex = async (store: KVNamespace, sub: string): Promise<string[]> => {
  const v = await store.get<unknown>(indexKey(sub), 'json');
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

const writeIndex = (store: KVNamespace, sub: string, hashes: string[]) =>
  hashes.length === 0 ? store.delete(indexKey(sub)) : store.put(indexKey(sub), JSON.stringify(hashes));

/** Sessions vivantes de l'utilisateur ; l'index est purgé des entrées mortes à la lecture. */
export const readSessionIndex = async (store: KVNamespace, sub: string, nowMs = Date.now()): Promise<string[]> => {
  const raw = await readRawIndex(store, sub);
  const alive: string[] = [];
  for (const h of raw) {
    const s = await store.get<SessionRecord>(sessionKey(h), 'json');
    if (s && !isSessionExpired(s, nowMs)) alive.push(h);
  }
  if (alive.length !== raw.length) await writeIndex(store, sub, alive);
  return alive;
};

const addToSessionIndex = async (store: KVNamespace, sub: string, hash: string, nowMs = Date.now()): Promise<void> => {
  const alive = await readSessionIndex(store, sub, nowMs);
  if (alive.includes(hash)) return;
  alive.push(hash);
  // Au-delà du plafond, les plus anciennes sessions sont révoquées.
  while (alive.length > MAX_SESSIONS_PER_USER) await store.delete(sessionKey(alive.shift()!));
  await writeIndex(store, sub, alive);
};

const removeFromSessionIndex = async (store: KVNamespace, sub: string, hash: string): Promise<void> => {
  const raw = await readRawIndex(store, sub);
  if (raw.includes(hash)) await writeIndex(store, sub, raw.filter(h => h !== hash));
};

/** Supprime toutes les sessions de l'utilisateur. Renvoie leur nombre. */
export const deleteAllSessions = async (store: KVNamespace, sub: string, alsoHash?: string): Promise<number> => {
  const hashes = new Set(await readRawIndex(store, sub));
  if (alsoHash) hashes.add(alsoHash);
  for (const h of hashes) await store.delete(sessionKey(h));
  await store.delete(indexKey(sub));
  return hashes.size;
};

// ---------- Cycle de vie ----------

export const createSession = async (store: KVNamespace, sub: string, email: string, nowMs = Date.now()): Promise<{ token: string; hash: string }> => {
  const token = randomToken(32);
  const hash = await sha256b64url(token);
  await store.put(sessionKey(hash), JSON.stringify({
    sub, email, createdAt: nowMs, refreshedAt: nowMs, indexed: true,
  } satisfies SessionRecord), { expirationTtl: sessionTtl(nowMs, nowMs) });
  await addToSessionIndex(store, sub, hash, nowMs);
  return { token, hash };
};

/**
 * Session valide pour cette empreinte, ou `null`. Applique le plafond absolu, et migre au
 * passage les anciennes sessions : sans createdAt, leur première utilisation vaut création
 * (personne n'est déconnecté brutalement) ; absentes de l'index, elles y sont ajoutées.
 */
export const loadSession = async (store: KVNamespace, hash: string, nowMs = Date.now()): Promise<SessionRecord | null> => {
  const s = await store.get<SessionRecord>(sessionKey(hash), 'json');
  if (!s || typeof s.sub !== 'string') return null;
  if (isSessionExpired(s, nowMs)) {
    await store.delete(sessionKey(hash));
    await removeFromSessionIndex(store, s.sub, hash);
    return null;
  }
  if (s.createdAt === undefined || !s.indexed) {
    const migrated: SessionRecord = { ...s, createdAt: s.createdAt ?? nowMs, indexed: true };
    if (!s.indexed) await addToSessionIndex(store, s.sub, hash, nowMs);
    const ttl = sessionTtl(migrated.createdAt!, nowMs);
    if (ttl >= MIN_KV_TTL) await store.put(sessionKey(hash), JSON.stringify(migrated), { expirationTtl: ttl });
    return migrated;
  }
  return s;
};

/** Prolongation glissante (au plus une écriture par jour), sans dépasser le plafond absolu. */
export const touchSession = async (store: KVNamespace, hash: string, s: SessionRecord, nowMs = Date.now()): Promise<void> => {
  if (nowMs - s.refreshedAt <= DAY * 1000) return;
  const ttl = sessionTtl(s.createdAt ?? nowMs, nowMs);
  if (ttl < MIN_KV_TTL) return;
  await store.put(sessionKey(hash), JSON.stringify({ ...s, refreshedAt: nowMs }), { expirationTtl: ttl });
};

export const deleteSession = async (store: KVNamespace, hash: string, sub: string): Promise<void> => {
  await store.delete(sessionKey(hash));
  await removeFromSessionIndex(store, sub, hash);
};

/** Pour la tâche quotidienne : la session existe-t-elle encore (sans écriture) ? */
export const sessionExists = async (store: KVNamespace, hash: string, nowMs = Date.now()): Promise<boolean> => {
  const s = await store.get<SessionRecord>(sessionKey(hash), 'json');
  return !!s && !isSessionExpired(s, nowMs);
};
