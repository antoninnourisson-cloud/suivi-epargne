// ================================================
// FILE: worker/src/handlers/cron.ts
// Tâches planifiées : rappels quotidiens, conservation du jeton Google, veille fiscale.
// Découpé de worker/src/index.ts sans changement de comportement.
// ================================================
import { readDataFile } from '../google';
import { PushMessage } from '../webpush';
import { CronErrors, appendCronLog, recordFiscalWatchCron, type NotificationTally } from '../cronLog';
import { runAndStoreFiscalWatch, isFiscalRetryDue, noteFiscalRetry } from '../fiscalWatchJob';
import { isReminderEnabled } from '../../../src/lib/notificationPrefs';
import { computeReminders, applyDiscreetMode, isDiscreet, parisCivilDate } from '../reminders';
import { DAY, loadSession, sessionPublicId, SESSION_MAX_AGE } from '../sessions';
import { StoredSubscription } from '../subscriptions';
import { USER_PREFIX, releaseUserIfUnused, RECENT_WRITE_GRACE_MS } from '../userRecords';
import { accessTokenFor, isInvalidGrant, isTransientGoogleError } from './session';
import { pushKey, readPushList, writePushList, pruneOrphanSubscriptions, purgeUser } from './pushStore';
import { deliver, parisDay } from './push';
import { purgeDueBackupDeletions } from './backup';
import type { Env } from '../index';

const SENT_TTL = 400 * DAY;
// Valeur des marques « envoyé ». Les rappels de paie comptaient par mois de VERSEMENT
// ('payday:2026-10' pour la paie du 27 octobre), ils comptent désormais par mois d'épargne
// ('payday:2026-11'). L'ancienne version marquait '1' : une ancienne clé (Reminder.legacyKeys)
// ne bloque un rappel que si elle porte cette valeur, sinon la clé de la paie d'octobre
// ('payday:2026-11', nouvelle forme) bloquerait à tort la paie de novembre (même texte en
// ancienne forme). Le jour de la mise en service ne renvoie donc rien de déjà parti.
const SENT_MARK = '2';
const LEGACY_SENT_MARK = '1';
const RECONNECT_NOTICE_TTL = 3 * DAY;
// Une session ne se prolonge pas au-delà de SESSION_MAX_AGE (60 jours après la connexion),
// même utilisée chaque jour : on prévient cette durée avant, une seule fois par session.
const SESSION_EXPIRY_WARNING = 7 * DAY;
const SESSION_EXPIRY_NOTICE_TTL = 10 * DAY;

export interface CronHealth { lastRunAt: string; ok: boolean; error?: string; usersProcessed: number; notifications?: NotificationTally }

const RECONNECT_MESSAGE = (env: Env): PushMessage => ({
  title: 'Pécule', body: 'Reconnectez-vous à Pécule pour garder vos rappels.', url: env.APP_URL, tag: 'reconnect',
});

/** Seule une nouvelle connexion Google crée une session neuve : l'ouvrir ne suffit pas. */
const SESSION_EXPIRY_MESSAGE = (env: Env, expiresAtMs: number): PushMessage => ({
  title: 'Pécule',
  body: `Votre connexion à Pécule se termine le ${parisDay(expiresAtMs)}. Avant cette date, déconnectez-vous puis reconnectez-vous avec Google dans l'app, sinon vos rappels s'arrêteront.`,
  url: env.APP_URL, tag: 'session-expiry',
});

const remindUser = async (env: Env, sub: string, now: Date, errors?: CronErrors): Promise<void> => {
  const stored = await readPushList(env, sub);
  let subs = await pruneOrphanSubscriptions(env, stored);
  const persist = async () => { if (subs.length !== stored.length) await writePushList(env, sub, subs); };
  if (subs.length === 0) { await persist(); return; }

  const send = async (
    message: PushMessage, sentKey: string, ttl: number, legacyKeys: string[] = [], targets: StoredSubscription[] = subs,
  ) => {
    if (await env.STORE.get(sentKey)) return;
    for (const k of legacyKeys) if ((await env.STORE.get(k)) === LEGACY_SENT_MARK) return;
    const { delivered, gone, tally } = await deliver(env, targets, message);
    errors?.addNotifications(tally);
    if (gone.length) subs = subs.filter(x => !gone.includes(x.endpoint));
    // Marqué « envoyé » seulement si au moins un appareil l'a reçu : sinon on réessaie demain.
    if (delivered > 0) await env.STORE.put(sentKey, SENT_MARK, { expirationTtl: ttl });
  };

  // Session qui expire dans 7 jours ou moins : prévenu une fois, sur les seuls appareils qu'elle porte.
  const nowMs = now.getTime();
  const bySession = new Map<string, StoredSubscription[]>();
  for (const s of subs) if (s.sessionHash) bySession.set(s.sessionHash, [...(bySession.get(s.sessionHash) ?? []), s]);
  for (const [hash, targets] of bySession) {
    const session = await loadSession(env.STORE, hash, nowMs);
    if (!session?.createdAt) continue;
    const expiresAt = session.createdAt + SESSION_MAX_AGE * 1000;
    if (expiresAt - nowMs > SESSION_EXPIRY_WARNING * 1000) continue;
    await send(SESSION_EXPIRY_MESSAGE(env, expiresAt), `sent:${sub}:session-expiry:${await sessionPublicId(hash)}`, SESSION_EXPIRY_NOTICE_TTL, [], targets);
  }
  if (subs.length === 0) { await persist(); return; }

  let accessToken: string;
  try {
    accessToken = (await accessTokenFor(env, sub)).access_token;
  } catch (e) {
    if (isInvalidGrant(e)) {
      // Accès Google révoqué : plus rien à faire pour ce compte, on efface tout (sauf la
      // sauvegarde de secours chiffrée, voir purgeUser).
      await purgeUser(env.STORE, sub, undefined);
      return;
    }
    console.error('cannot refresh token for reminders', e);
    // Incident passager chez Google (délai dépassé, erreur 5xx, réseau) : rien à demander à
    // l'utilisateur, la tournée de demain réessaiera. « Reconnectez-vous » seulement pour un refus.
    if (!isTransientGoogleError(e)) await send(RECONNECT_MESSAGE(env), `sent:${sub}:reconnect`, RECONNECT_NOTICE_TTL);
    await persist();
    return;
  }
  try {
    const data = await readDataFile(accessToken);
    if (!data) return;
    let reminders = computeReminders(data, parisCivilDate(now), env.APP_URL)
      .filter(r => isReminderEnabled(r.key, data.config?.notificationPrefs));
    if (isDiscreet(data)) reminders = applyDiscreetMode(reminders);
    for (const reminder of reminders) {
      if (subs.length === 0) break;
      await send(reminder.message, `sent:${sub}:${reminder.key}`, SENT_TTL, (reminder.legacyKeys ?? []).map(k => `sent:${sub}:${k}`));
    }
  } finally {
    await persist();
  }
};

/**
 * Conservation du jeton Google (page de confidentialité) : après les rappels, chaque compte
 * gardé est revu. Plus de session ni de notification : il est effacé. Sinon, sans
 * notification (ceux qui en ont viennent d'être vérifiés par remindUser), un rafraîchissement
 * constate un accès retiré chez Google, et tout est alors effacé comme dans /token. Une
 * panne passagère de Google ne purge rien.
 */
const sweepUserRecords = async (env: Env, now: Date, errors: CronErrors): Promise<void> => {
  let cursor: string | undefined;
  do {
    const page = await env.STORE.list({ prefix: USER_PREFIX, cursor });
    for (const k of page.keys) {
      const sub = k.name.slice(USER_PREFIX.length);
      try {
        // Date.now() (et non le début de la tâche) : une connexion faite pendant les rappels
        // reste dans le délai de grâce.
        if (await releaseUserIfUnused(env.STORE, sub, Date.now(), { graceMs: RECENT_WRITE_GRACE_MS })) continue;
        if (await env.STORE.get(pushKey(sub))) continue;
        try {
          await accessTokenFor(env, sub);
        } catch (e) {
          if (isInvalidGrant(e)) await purgeUser(env.STORE, sub, undefined);
          else console.error('cannot refresh token during retention check', e);
        }
      } catch (e) {
        console.error('retention check failed', e);
        errors.add(e);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
};

export const runDailyReminders = async (env: Env): Promise<void> => {
  const now = new Date();
  let usersProcessed = 0;
  const errors = new CronErrors();
  try {
    let cursor: string | undefined;
    do {
      const page = await env.STORE.list({ prefix: 'push:', cursor });
      for (const k of page.keys) {
        usersProcessed++;
        try { await remindUser(env, k.name.slice('push:'.length), now, errors); }
        catch (e) { console.error('reminders failed', e); errors.add(e); }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    await sweepUserRecords(env, now, errors);
    await purgeDueBackupDeletions(env, now.getTime(), errors);
  } catch (e) {
    errors.add(e);
  } finally {
    const health: CronHealth = {
      lastRunAt: now.toISOString(), ok: errors.count === 0, usersProcessed,
      ...(errors.count ? { error: `${errors.count} échec(s) : ${errors.messages[0]}`.slice(0, 300) } : {}),
      notifications: { ...errors.notifications },
    };
    await env.STORE.put('health:cron', JSON.stringify(health));
    // Historique public de /status : catégories d'erreur seulement, jamais le message.
    await appendCronLog(env.STORE, { at: health.lastRunAt, cron: 'daily', ok: health.ok, errors: errors.categories, notifications: errors.notifications })
      .catch(e => console.error('cron log failed', e));
  }
};

/**
 * Veille fiscale du lundi (cron) : son dernier succès et son dernier échec sont gardés pour
 * /status, que la surveillance GitHub lit (alerte au-delà de 8 jours sans succès).
 */
export const runScheduledFiscalWatch = async (env: Env): Promise<void> => {
  const startedAt = new Date();
  let ok = false;
  try {
    const r = await runAndStoreFiscalWatch(env.STORE, env.AI);
    ok = r.ok;
    console.log('fiscal watch', r.ok, Object.keys(r.values).length, 'values', r.neuronsUsed ?? r.neuronsEstimate, 'neurons');
  } catch (e) {
    console.error('fiscal watch failed', e);
  }
  await recordFiscalWatchCron(env.STORE, startedAt, ok).catch(e => console.error('fiscal watch health failed', e));
};

/**
 * Relance quotidienne de la veille après un échec (cron de 7 h) : une fois par jour au plus,
 * 6 fois par semaine au plus, jusqu'au premier succès (isFiscalRetryDue). Sans effet si le
 * dernier essai a réussi. Le seuil d'alerte de /status (8 jours sans succès) reste valable.
 */
export const retryFiscalWatchIfFailed = async (env: Env): Promise<void> => {
  try {
    if (!env.AI) return;
    const now = new Date();
    if (!(await isFiscalRetryDue(env.STORE, now))) return;
    await noteFiscalRetry(env.STORE, now);
    await runScheduledFiscalWatch(env);
  } catch (e) {
    console.error('fiscal watch retry failed', e);
  }
};
