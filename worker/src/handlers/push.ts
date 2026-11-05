// ================================================
// FILE: worker/src/handlers/push.ts
// Routes des notifications push (abonnements, appareils, essai) et alerte « code oublié ».
// Découpé de worker/src/index.ts sans changement de comportement.
// ================================================
import { sendPush, PushMessage } from '../webpush';
import { type NotificationTally } from '../cronLog';
import { readJsonBody } from '../security';
import { DAY } from '../sessions';
import { sanitizeDeviceLabel } from '../deviceProof';
import { StoredSubscription, parseSubscription, upsertSubscription, describeDevices, deviceId, readStoredList } from '../subscriptions';
import { json, accountLimited } from './http';
import { requireSession } from './session';
import { readPushList, writePushList, removedPushKey, rememberRemovedSubscriptions, pruneOrphanSubscriptions } from './pushStore';
import type { Env } from '../index';

export const handleSubscribe = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const limited = await accountLimited(req, env, 'subscribe', s.session.sub);
  if (limited) return limited;
  const body = await readJsonBody(req) as { subscription?: unknown };
  const subscription = parseSubscription(body.subscription);
  if (!subscription) return json(req, env, { error: 'INVALID_SUBSCRIPTION' }, 400);
  const current = await readPushList(env, s.session.sub);
  const alive = await pruneOrphanSubscriptions(env, current);
  const result = upsertSubscription(alive, subscription, s.hash);
  if (!result.ok) {
    if (alive.length !== current.length) await writePushList(env, s.session.sub, alive);
    return json(req, env, { error: result.error }, 409);
  }
  // Abonnement identique à celui déjà gardé (l'app le renvoie à chaque ouverture) : rien à
  // réécrire, ni liste purgée de ses orphelins en attente.
  if (alive.length !== current.length || !sameStoredList(result.list, current)) await writePushList(env, s.session.sub, result.list);
  return json(req, env, { ok: true, devices: result.list.length });
};

/** Mêmes abonnements, mêmes sessions, quel que soit l'ordre. */
const sameStoredList = (a: StoredSubscription[], b: StoredSubscription[]): boolean => {
  if (a.length !== b.length) return false;
  const canon = (x: StoredSubscription) => JSON.stringify([x.endpoint, x.keys.p256dh, x.keys.auth, x.sessionHash ?? null, x.createdAt ?? null]);
  const seen = new Set(b.map(canon));
  return a.every(x => seen.has(canon(x)));
};

const removeEndpoint = async (env: Env, sub: string, match: (x: StoredSubscription) => Promise<boolean> | boolean) => {
  const list = await readPushList(env, sub);
  const kept: StoredSubscription[] = [];
  const gone: StoredSubscription[] = [];
  for (const x of list) (await match(x) ? gone : kept).push(x);
  if (gone.length) await writePushList(env, sub, kept);
  return { gone, result: { removed: gone.length > 0, devices: kept.length } };
};

export const handleUnsubscribe = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const body = await readJsonBody(req) as { endpoint?: unknown };
  // L'appareil se désabonne lui-même : il ne veut plus rien recevoir, rien n'est gardé.
  const { result } = await removeEndpoint(env, s.session.sub, x => x.endpoint === body.endpoint);
  return json(req, env, { ok: true, devices: result.devices });
};

export const handleDevices = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const list = await readPushList(env, s.session.sub);
  return json(req, env, { devices: await describeDevices(list, s.hash) });
};

export const handleRemoveDevice = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const limited = await accountLimited(req, env, 'remove', s.session.sub);
  if (limited) return limited;
  const body = await readJsonBody(req) as { endpoint?: unknown; id?: unknown };
  if (typeof body.endpoint !== 'string' && typeof body.id !== 'string') return json(req, env, { error: 'INVALID_REQUEST' }, 400);
  const { gone, result } = await removeEndpoint(env, s.session.sub, async x =>
    (typeof body.endpoint === 'string' && x.endpoint === body.endpoint)
    || (typeof body.id === 'string' && (await deviceId(x.endpoint)) === body.id));
  // Appareil d'une AUTRE session retiré : il recevra quand même, 30 jours, l'alerte
  // d'effacement des copies de secours.
  await rememberRemovedSubscriptions(env, s.session.sub, gone.filter(x => x.sessionHash !== s.hash));
  return json(req, env, { ok: true, ...result });
};

/**
 * Envoie un message à tous les appareils en parallèle. Renvoie le nombre de réceptions, les
 * endpoints disparus (404/410), à retirer par l'appelant, et le bilan des envois (tally) :
 * « failed » = refusés ou en erreur, hors appareils disparus.
 */
export const deliver = async (
  env: Env, subs: StoredSubscription[], message: PushMessage,
): Promise<{ delivered: number; gone: string[]; tally: NotificationTally }> => {
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
  const results = await Promise.allSettled(subs.map(s => sendPush(s, message, vapid)));
  let delivered = 0;
  let failed = 0;
  const gone: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') { failed++; console.error('push failed', r.reason); return; }
    if (r.value >= 200 && r.value < 300) delivered++;
    else if (r.value === 404 || r.value === 410) gone.push(subs[i].endpoint);
    else { failed++; console.error('push rejected', r.value, new URL(subs[i].endpoint).hostname); }
  });
  return { delivered, gone, tally: { attempted: subs.length, delivered, failed } };
};

export const handleTestPush = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const list = await readPushList(env, s.session.sub);
  const { delivered, gone } = await deliver(env, list, {
    title: 'Pécule', body: 'Les notifications fonctionnent sur cet appareil.', url: env.APP_URL, tag: 'test',
  });
  if (gone.length) await writePushList(env, s.session.sub, list.filter(x => !gone.includes(x.endpoint)));
  return json(req, env, { ok: delivered > 0, delivered });
};

/** « 20 octobre à 14:05 », heure de Paris. */
export const parisDateTime = (ms: number): string =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
/** « 27 octobre », heure de Paris. */
export const parisDay = (ms: number): string =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' }).format(new Date(ms));

/** Paramètres, carte `section` ouverte (src/components/settings/sections.ts). */
export const settingsUrl = (env: Env, section: 'account' | 'data') =>
  `${env.APP_URL}${env.APP_URL.includes('?') ? '&' : '?'}view=settings&section=${section}`;

/**
 * Envoie un message à tous les appareils de l'utilisateur (sauf ceux de `exceptSession`) et
 * retire les abonnements disparus. `alsoRecentlyRemoved` : aussi aux appareils retirés par
 * une autre session depuis moins de 30 jours. Renvoie le nombre de réceptions.
 */
export const alertDevices = async (
  env: Env, sub: string, message: PushMessage, opts: { exceptSession?: string; alsoRecentlyRemoved?: boolean } = {},
): Promise<number> => {
  const list = await pruneOrphanSubscriptions(env, await readPushList(env, sub));
  const targets = list.filter(x => !opts.exceptSession || x.sessionHash !== opts.exceptSession);
  const removed = opts.alsoRecentlyRemoved ? readStoredList(await env.STORE.get(removedPushKey(sub), 'json')) : [];
  const extra = removed.filter(r => !targets.some(t => t.endpoint === r.endpoint));
  if (targets.length + extra.length === 0) return 0;
  const { delivered, gone } = await deliver(env, [...targets, ...extra], message);
  if (gone.length && list.some(x => gone.includes(x.endpoint))) await writePushList(env, sub, list.filter(x => !gone.includes(x.endpoint)));
  return delivered;
};

const LOCK_ALERT_TTL = 3600;
const LOCK_RESET_MAX_AGE_MS = 7 * DAY * 1000;

/**
 * « Code oublié » sur un appareil : ses AUTRES appareils (notifications activées) sont
 * prévenus, avec un texte générique (date, type d'appareil, rien sur les données), et ce
 * qu'il faut faire si ce n'est pas le propriétaire. Une alerte par heure et par session au
 * plus. Chiffrée de bout en bout comme toutes les notifications (RFC 8291).
 */
export const handleLockResetAlert = async (req: Request, env: Env): Promise<Response> => {
  const s = await requireSession(req, env);
  const limited = await accountLimited(req, env, 'lock-reset', s.session.sub);
  if (limited) return limited;
  const body = await readJsonBody(req) as { requestedAt?: unknown; device?: unknown };
  const alertKey = `alert:lock-reset:${s.hash}`;
  if (await env.STORE.get(alertKey)) return json(req, env, { ok: true, delivered: 0, throttled: true });
  const now = Date.now();
  // Date de la demande (l'appareil était peut-être hors ligne) : acceptée si elle est
  // plausible, sinon l'heure de réception.
  const asked = typeof body.requestedAt === 'string' ? Date.parse(body.requestedAt) : NaN;
  const when = Number.isFinite(asked) && asked <= now + 5 * 60_000 && asked >= now - LOCK_RESET_MAX_AGE_MS ? asked : now;
  const device = s.session.device ?? sanitizeDeviceLabel(body.device);
  const delivered = await alertDevices(env, s.session.sub, {
    title: 'Pécule : retrait du verrou demandé',
    body: `Le ${parisDateTime(when)}, ${device ? `un appareil (${device})` : 'un de vos appareils'} a demandé à retirer le verrou de Pécule. `
      + 'Ce n\'est pas vous ? Déconnectez cet appareil dans Paramètres, rubrique « Appareils connectés ». '
      + 'Si c\'est bien le vôtre, déverrouillez Pécule dessus pour annuler la demande.',
    url: settingsUrl(env, 'account'), tag: 'lock-reset',
  }, { exceptSession: s.hash });
  await env.STORE.put(alertKey, '1', { expirationTtl: LOCK_ALERT_TTL });
  return json(req, env, { ok: true, delivered });
};
