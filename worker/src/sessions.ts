// ================================================
// FILE: worker/src/sessions.ts
// Sessions des appareils et index par utilisateur.
//
//   session:<hash>   { sub, email, createdAt, refreshedAt, gen, key?, device? } — clé = SHA-256 du jeton
//   sessions:<sub>   tableau JSON des empreintes de sessions de l'utilisateur
//
// `key` : clé publique de l'appareil (deviceProof.ts) ; une session qui en a une exige une
// preuve signée à chaque requête. `device` : type d'appareil déclaré, pour la liste des
// sessions dans Paramètres (« Déconnecter cet appareil »). `gen` : SESSION_GEN pour une
// session ouverte depuis la liaison à l'appareil. Une session plus ancienne et jamais liée
// est refusée (isLegacySession) : un jeton copié avant cette protection ne doit pas pouvoir
// être lié par celui qui l'a copié. Cela coûte une reconnexion, une seule fois.
//
// Durée de vie : glissante (SESSION_IDLE_TTL sans utilisation), mais JAMAIS au-delà de
// createdAt + SESSION_MAX_AGE, quel que soit l'usage.
// ================================================
import { randomToken, sha256b64url } from './crypto';
import type { DeviceKey } from './deviceProof';

export const DAY = 86_400;
export const SESSION_MAX_AGE = 60 * DAY;   // plafond absolu (secondes)
export const SESSION_IDLE_TTL = 30 * DAY;  // expiration sans utilisation (secondes)
export const MAX_SESSIONS_PER_USER = 20;
/** Génération des sessions ouvertes depuis la liaison à l'appareil. */
const SESSION_GEN = 2;
const MIN_KV_TTL = 60;                     // minimum accepté par KV pour expirationTtl

export interface SessionRecord {
  sub: string;
  email: string;
  createdAt?: number;     // absent sur les sessions créées avant le plafond absolu
  refreshedAt: number;
  indexed?: boolean;      // déjà présente dans sessions:<sub>
  key?: DeviceKey;        // session liée à l'appareil (preuve exigée)
  device?: string;        // type d'appareil déclaré à la connexion
  gen?: number;           // SESSION_GEN depuis la liaison à l'appareil ; absent avant
}

/** Session ouverte avant la liaison à l'appareil et jamais liée : refusée, reconnexion exigée. */
export const isLegacySession = (s: SessionRecord): boolean => !s.key && (s.gen ?? 1) < SESSION_GEN;

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
    sub, email, createdAt: nowMs, refreshedAt: nowMs, indexed: true, gen: SESSION_GEN,
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

/**
 * Prolongation glissante (au plus une écriture par jour), sans dépasser le plafond absolu.
 * Repart de la session telle qu'elle est stockée, pas de `s` (lu au début de la requête) :
 * une liaison à l'appareil faite entre-temps par une autre requête n'est jamais effacée, et
 * une session déconnectée entre-temps n'est pas recréée.
 */
export const touchSession = async (store: KVNamespace, hash: string, s: SessionRecord, nowMs = Date.now()): Promise<void> => {
  if (nowMs - s.refreshedAt <= DAY * 1000) return;
  const ttl = sessionTtl(s.createdAt ?? nowMs, nowMs);
  if (ttl < MIN_KV_TTL) return;
  const latest = await store.get<SessionRecord>(sessionKey(hash), 'json');
  if (!latest || latest.sub !== s.sub) return;
  if (nowMs - latest.refreshedAt <= DAY * 1000) return;
  // Une clé ne disparaît jamais : relecture en retard (autre lieu), on garde celle déjà vue.
  const key = latest.key ?? s.key;
  const device = latest.device ?? s.device;
  await store.put(sessionKey(hash), JSON.stringify({ ...latest, ...(key ? { key } : {}), ...(device ? { device } : {}), refreshedAt: nowMs }), { expirationTtl: ttl });
};

export const deleteSession = async (store: KVNamespace, hash: string, sub: string): Promise<void> => {
  await store.delete(sessionKey(hash));
  await removeFromSessionIndex(store, sub, hash);
};

/**
 * Lie la session à la clé publique de l'appareil (et note son type). Garde le TTL restant :
 * le plafond absolu ne bouge pas. `false` si la session expire dans moins d'une minute.
 * `refreshedAt` est remis à maintenant : une prolongation lancée juste après (autre requête,
 * relecture en retard) ne réécrit pas la session sans sa clé.
 */
export const bindSession = async (
  store: KVNamespace, hash: string, s: SessionRecord, key: DeviceKey, device?: string, nowMs = Date.now(),
): Promise<boolean> => {
  const ttl = sessionTtl(s.createdAt ?? nowMs, nowMs);
  if (ttl < MIN_KV_TTL) return false;
  const record: SessionRecord = { ...s, key, ...(device ? { device } : {}), refreshedAt: nowMs };
  await store.put(sessionKey(hash), JSON.stringify(record), { expirationTtl: ttl });
  return true;
};

/** Identifiant public d'une session (liste des appareils) : ne permet pas de la retrouver. */
export const sessionPublicId = async (hash: string): Promise<string> => (await sha256b64url(`sid:${hash}`)).slice(0, 16);

/** Sessions vivantes de l'utilisateur, avec leur contenu (liste des appareils connectés). */
export const listSessions = async (store: KVNamespace, sub: string, nowMs = Date.now()): Promise<{ hash: string; session: SessionRecord }[]> => {
  const out: { hash: string; session: SessionRecord }[] = [];
  for (const hash of await readSessionIndex(store, sub, nowMs)) {
    const session = await store.get<SessionRecord>(sessionKey(hash), 'json');
    if (session && session.sub === sub) out.push({ hash, session });
  }
  return out;
};

/** Pour la tâche quotidienne : la session existe-t-elle encore (sans écriture) ? */
export const sessionExists = async (store: KVNamespace, hash: string, nowMs = Date.now()): Promise<boolean> => {
  const s = await store.get<SessionRecord>(sessionKey(hash), 'json');
  return !!s && !isSessionExpired(s, nowMs);
};
