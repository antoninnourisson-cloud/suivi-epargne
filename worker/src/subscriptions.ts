// ================================================
// FILE: worker/src/subscriptions.ts
// Abonnements push : validation stricte et règles de stockage (fonctions pures).
//
//   push:<sub>  tableau de StoredSubscription
//
// Chaque abonnement retient la session qui l'a créé : il disparaît avec elle (déconnexion,
// expiration). Les anciens abonnements sans session sont gardés, puis rattachés à la
// prochaine session qui réabonne le même endpoint.
// ================================================
import { b64urlDecode, sha256b64url } from './crypto';
import type { PushSubscriptionJSON } from './webpush';

export const MAX_SUBSCRIPTIONS = 10;
const MAX_ENDPOINT_LENGTH = 1024;
const MAX_KEY_LENGTH = 256;

export interface StoredSubscription extends PushSubscriptionJSON {
  sessionHash?: string;
  createdAt?: number;
}

// Services de push des navigateurs : Chrome/Edge Android/Opera (FCM), Firefox, Safari,
// Edge Windows (WNS). Aucun autre hôte n'est contacté par le Worker.
const EXACT_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const SUFFIX_HOSTS = ['.push.apple.com', '.notify.windows.com'];

export const isAllowedPushEndpoint = (endpoint: unknown): endpoint is string => {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return EXACT_HOSTS.includes(host) || SUFFIX_HOSTS.some(s => host.endsWith(s) && host.length > s.length);
  } catch { return false; }
};

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

const decodedLength = (s: unknown, max = MAX_KEY_LENGTH): number => {
  if (typeof s !== 'string' || s.length === 0 || s.length > max || !B64URL.test(s)) return -1;
  try { return b64urlDecode(s).length; } catch { return -1; }
};

/**
 * Abonnement reconstruit champ par champ ({endpoint, keys:{p256dh, auth}}), ou `null` s'il
 * est invalide. Rien d'autre que ces trois chaînes n'est jamais stocké.
 */
export const parseSubscription = (raw: unknown): PushSubscriptionJSON | null => {
  if (!raw || typeof raw !== 'object') return null;
  const { endpoint, keys } = raw as { endpoint?: unknown; keys?: unknown };
  if (!isAllowedPushEndpoint(endpoint) || !keys || typeof keys !== 'object') return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null; // (déjà exclu par decodedLength)
  if (decodedLength(p256dh) !== 65 || b64urlDecode(p256dh)[0] !== 0x04) return null; // point P-256 non compressé
  if (decodedLength(auth) !== 16) return null;
  return { endpoint, keys: { p256dh, auth } };
};

export type UpsertResult = { ok: true; list: StoredSubscription[] } | { ok: false; error: 'TOO_MANY_DEVICES' };

/** Ajoute ou remplace (même endpoint) l'abonnement, rattaché à la session courante. */
export const upsertSubscription = (
  list: StoredSubscription[], sub: PushSubscriptionJSON, sessionHash: string, nowMs = Date.now()
): UpsertResult => {
  const existing = list.find(x => x.endpoint === sub.endpoint);
  const others = list.filter(x => x.endpoint !== sub.endpoint);
  if (!existing && others.length >= MAX_SUBSCRIPTIONS) return { ok: false, error: 'TOO_MANY_DEVICES' };
  return {
    ok: true,
    list: [...others, { endpoint: sub.endpoint, keys: { ...sub.keys }, sessionHash, createdAt: existing?.createdAt ?? nowMs }],
  };
};

/** Identifiant court et stable d'un appareil, sans exposer l'endpoint complet. */
export const deviceId = async (endpoint: string): Promise<string> => (await sha256b64url(endpoint)).slice(0, 16);

export interface DeviceInfo { id: string; host: string; createdAt: string | null; current: boolean }

export const describeDevices = async (list: StoredSubscription[], currentSessionHash: string): Promise<DeviceInfo[]> =>
  Promise.all(list.map(async s => ({
    id: await deviceId(s.endpoint),
    host: new URL(s.endpoint).hostname,
    createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
    current: s.sessionHash === currentSessionHash,
  })));

/** Lecture tolérante du stockage (anciens formats, entrées corrompues ignorées). */
export const readStoredList = (v: unknown): StoredSubscription[] =>
  Array.isArray(v) ? v.filter((x): x is StoredSubscription =>
    !!x && typeof x.endpoint === 'string' && typeof x.keys?.p256dh === 'string' && typeof x.keys?.auth === 'string') : [];
