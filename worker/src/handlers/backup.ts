// ================================================
// FILE: worker/src/handlers/backup.ts
// Routes de la sauvegarde de secours chiffrée par l'app et effacement différé des copies.
// Découpé de worker/src/index.ts sans changement de comportement.
// ================================================
import { CronErrors } from '../cronLog';
import { parisCivilDate } from '../reminders';
import { readJsonBody } from '../security';
import { DAY } from '../sessions';
import { backupsToKeep } from '../backupRetention';
import { json, rateLimited } from './http';
import { requireSession } from './session';
import { parisDateTime, parisDay, settingsUrl, alertDevices } from './push';
import type { Env } from '../index';

// L'app chiffre ses données AVANT l'envoi (AES-256-GCM, clé dérivée d'un code de secours
// que seul l'utilisateur détient : src/lib/cloudBackupCrypto.ts). Le serveur ne garde
// qu'un texte chiffré opaque : il en contrôle la forme et la taille, jamais le contenu.
//   PUT    /backup           enregistre la copie du jour (remplace celle du même jour)
//   GET    /backup           dates des copies gardées, la plus récente d'abord, et
//                            l'effacement programmé s'il y en a un
//   GET    /backup/:date     une copie (texte chiffré)
//   DELETE /backup           PROGRAMME l'effacement, dans 7 jours, des copies présentes à
//                            la date de la demande (les copies envoyées ensuite restent,
//                            jusqu'à une nouvelle demande qui les ajoute à leur tour)
//   DELETE /backup/deletion  annule cet effacement
// Une session volée ne peut donc rien détruire sur-le-champ : l'effacement est annoncé aux
// appareils (notification) et annulable pendant 7 jours ; la conservation échelonnée
// (backupRetention.ts) garde des copies anciennes qu'aucun nouvel envoi ne chasse ; les
// envois sont plafonnés par jour.

export const BACKUP_MAX_BYTES = 2 * 1024 * 1024;
export const BACKUP_DELETION_DELAY_MS = 7 * DAY * 1000;
export const BACKUP_PUTS_PER_DAY = 20;
const BACKUP_TTL = 365 * DAY;
const backupDeletionKey = (sub: string) => `backup-deletion:${sub}`;
/**
 * Effacement programmé : chaque copie concernée (date AAAA-MM-JJ) avec sa propre échéance
 * (`due`). `requestedAt` : dernière demande qui a ajouté des copies ; `purgeAt` : échéance la
 * plus tardive (toutes ces copies effacées).
 */
interface BackupDeletion { requestedAt: string; purgeAt: string; due: Record<string, string> }
// Le marqueur survit un mois à la date prévue : la tâche quotidienne a largement le temps.
const deletionTtl = (d: BackupDeletion, nowMs = Date.now()) =>
  Math.max(60, Math.ceil((Date.parse(d.purgeAt) - nowMs) / 1000) + 30 * DAY);
const backupPrefix = (sub: string) => `backup:${sub}:`;
const BACKUP_DATE = /^\d{4}-\d{2}-\d{2}$/;
const B64URL_FIELD = /^[A-Za-z0-9_-]+$/;

/** Copie reconstruite champ par champ (rien d'autre n'est stocké), ou `null` si la forme est fausse. */
const parseBackupBody = (b: Record<string, unknown>): Record<string, unknown> | null => {
  if (b.format !== 'pecule-backup' || typeof b.v !== 'number' || !Number.isInteger(b.v) || b.v < 1 || b.v > 99) return null;
  for (const k of ['salt', 'kcv', 'iv', 'ct']) if (typeof b[k] !== 'string' || !B64URL_FIELD.test(b[k] as string)) return null;
  for (const k of ['kdf', 'cipher', 'zip', 'createdAt']) if (typeof b[k] !== 'string' || (b[k] as string).length > 40) return null;
  const { format, v, kdf, cipher, zip, salt, kcv, iv, ct, createdAt } = b;
  return { format, v, kdf, cipher, zip, salt, kcv, iv, ct, createdAt };
};

const listBackupDates = async (env: Env, sub: string): Promise<string[]> => {
  const prefix = backupPrefix(sub);
  const dates: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.STORE.list({ prefix, cursor });
    for (const k of page.keys) dates.push(k.name.slice(prefix.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return dates.filter(d => BACKUP_DATE.test(d)).sort().reverse();
};

const readBackupDeletion = async (env: Env, sub: string): Promise<BackupDeletion | null> => {
  const d = await env.STORE.get<BackupDeletion>(backupDeletionKey(sub), 'json');
  return d ? { ...d, due: d.due && typeof d.due === 'object' ? d.due : {} } : null;
};

/** Écrit l'effacement programmé (`purgeAt` recalculé), ou l'efface s'il ne concerne plus aucune copie. */
const writeBackupDeletion = async (env: Env, sub: string, d: BackupDeletion, nowMs = Date.now()): Promise<BackupDeletion | null> => {
  const dues = Object.values(d.due);
  if (dues.length === 0) {
    await env.STORE.delete(backupDeletionKey(sub));
    return null;
  }
  const record: BackupDeletion = { ...d, purgeAt: dues.reduce((a, b) => (b > a ? b : a)) };
  await env.STORE.put(backupDeletionKey(sub), JSON.stringify(record), { expirationTtl: deletionTtl(record, nowMs) });
  return record;
};

/**
 * Programme l'effacement, dans 7 jours, des copies présentes maintenant, et prévient les
 * appareils. Une copie déjà programmée garde son échéance (redemander n'avance rien) ; une
 * copie envoyée depuis la demande précédente (réactivation avec un nouveau code, autre
 * appareil encore activé) est ajoutée, avec sa propre échéance à 7 jours, et les appareils
 * sont prévenus à nouveau. `null` s'il n'y a aucune copie. Les copies envoyées APRÈS cette
 * demande ne sont pas concernées.
 */
export const scheduleBackupDeletion = async (env: Env, sub: string, nowMs = Date.now()): Promise<BackupDeletion | null> => {
  const existing = await readBackupDeletion(env, sub);
  const due: Record<string, string> = { ...(existing?.due ?? {}) };
  const purgeAtMs = nowMs + BACKUP_DELETION_DELAY_MS;
  const added = (await listBackupDates(env, sub)).filter(d => !(d in due));
  for (const d of added) due[d] = new Date(purgeAtMs).toISOString();
  if (added.length === 0) return existing && Object.keys(existing.due).length > 0 ? existing : null;
  const deletion = await writeBackupDeletion(env, sub, { requestedAt: new Date(nowMs).toISOString(), purgeAt: '', due }, nowMs);
  await alertDevices(env, sub, {
    title: 'Pécule : effacement des copies de secours demandé',
    body: `Le ${parisDateTime(nowMs)}, l'effacement de vos copies de secours chiffrées a été demandé. Elles seront effacées le ${parisDay(purgeAtMs)}. `
      + 'Ce n\'est pas vous ? Ouvrez Pécule (reconnectez-vous si besoin) et annulez dans Paramètres.',
    url: settingsUrl(env, 'data'), tag: 'backup-deletion',
  }, { alsoRecentlyRemoved: true });
  return deletion;
};

/** Tâche quotidienne : efface les copies dont l'effacement programmé est arrivé à échéance. */
export const purgeDueBackupDeletions = async (env: Env, nowMs: number, errors: CronErrors): Promise<void> => {
  let cursor: string | undefined;
  do {
    const page = await env.STORE.list({ prefix: 'backup-deletion:', cursor });
    for (const k of page.keys) {
      const sub = k.name.slice('backup-deletion:'.length);
      try {
        const deletion = await readBackupDeletion(env, sub);
        if (!deletion) continue;
        const left: Record<string, string> = {};
        let changed = Object.keys(deletion.due).length === 0;
        for (const [d, at] of Object.entries(deletion.due)) {
          if (Date.parse(at) > nowMs) { left[d] = at; continue; }
          if (BACKUP_DATE.test(d)) await env.STORE.delete(`${backupPrefix(sub)}${d}`);
          changed = true;
        }
        if (changed) await writeBackupDeletion(env, sub, { ...deletion, due: left }, nowMs);
      } catch (e) {
        console.error('backup deletion failed', e);
        errors.add(e);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
};

const handleBackupPut = async (req: Request, env: Env, sub: string): Promise<Response> => {
  // En plus du limiteur par IP (point d'entrée), un limiteur par compte : protège le quota
  // d'écritures KV gratuit même depuis plusieurs adresses.
  if (await rateLimited(env.API_LIMITER, `backup:${sub}`)) return json(req, env, { error: 'RATE_LIMITED' }, 429, { 'Retry-After': '60' });
  const blob = parseBackupBody(await readJsonBody(req, BACKUP_MAX_BYTES));
  if (!blob) return json(req, env, { error: 'INVALID_BACKUP' }, 400);
  const c = parisCivilDate(new Date());
  const date = `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
  // Plafond quotidien par compte : l'envoi automatique a lieu au plus une fois par semaine.
  const countKey = `backup-puts:${sub}:${date}`;
  const count = Number(await env.STORE.get(countKey)) || 0;
  if (count >= BACKUP_PUTS_PER_DAY) return json(req, env, { error: 'RATE_LIMITED' }, 429, { 'Retry-After': '3600' });
  await env.STORE.put(countKey, String(count + 1), { expirationTtl: 2 * DAY });
  await env.STORE.put(`${backupPrefix(sub)}${date}`, JSON.stringify(blob), { expirationTtl: BACKUP_TTL });
  // Effacement programmé : la copie du jour vient d'être remplacée par une nouvelle, qui
  // n'est plus concernée.
  const deletion = await readBackupDeletion(env, sub);
  if (deletion && date in deletion.due) {
    const due = { ...deletion.due };
    delete due[date];
    await writeBackupDeletion(env, sub, { ...deletion, due });
  }
  const dates = await listBackupDates(env, sub);
  if (!dates.includes(date)) dates.unshift(date); // liste KV parfois en retard sur l'écriture
  const keep = backupsToKeep(dates);
  for (const old of dates) if (!keep.has(old)) await env.STORE.delete(`${backupPrefix(sub)}${old}`);
  return json(req, env, { ok: true, date, dates: dates.filter(d => keep.has(d)) });
};

/** Routes /backup, ou `null` si la requête ne les concerne pas. */
export const backupRoute = async (req: Request, env: Env, url: URL): Promise<Response | null> => {
  const m = /^\/backup(?:\/([^/]+))?$/.exec(url.pathname);
  if (!m) return null;
  const s = await requireSession(req, env);
  const sub = s.session.sub;
  const date = m[1];
  if (date === undefined) {
    if (req.method === 'PUT') return handleBackupPut(req, env, sub);
    if (req.method === 'GET') {
      const deletion = await readBackupDeletion(env, sub);
      return json(req, env, {
        dates: await listBackupDates(env, sub),
        ...(deletion ? { deletion: { requestedAt: deletion.requestedAt, purgeAt: deletion.purgeAt, copies: Object.keys(deletion.due).length } } : {}),
      });
    }
    if (req.method === 'DELETE') {
      const deletion = await scheduleBackupDeletion(env, sub);
      return json(req, env, deletion
        ? { ok: true, scheduled: true, purgeAt: deletion.purgeAt, copies: Object.keys(deletion.due).length }
        : { ok: true, scheduled: false, copies: 0 });
    }
  } else if (date === 'deletion') {
    // Lu par l'app à chaque ouverture (une seule lecture KV) : un effacement programmé reste
    // visible même si toutes les notifications ont été coupées.
    if (req.method === 'GET') {
      const deletion = await readBackupDeletion(env, sub);
      return json(req, env, {
        deletion: deletion ? { requestedAt: deletion.requestedAt, purgeAt: deletion.purgeAt, copies: Object.keys(deletion.due).length } : null,
      });
    }
    if (req.method === 'DELETE') {
      const cancelled = !!(await readBackupDeletion(env, sub));
      if (cancelled) await env.STORE.delete(backupDeletionKey(sub));
      return json(req, env, { ok: true, cancelled });
    }
  } else if (req.method === 'GET') {
    if (!BACKUP_DATE.test(date)) return json(req, env, { error: 'NOT_FOUND' }, 404);
    const stored = await env.STORE.get(`${backupPrefix(sub)}${date}`);
    if (!stored) return json(req, env, { error: 'NOT_FOUND' }, 404);
    return json(req, env, JSON.parse(stored));
  }
  return json(req, env, { error: 'METHOD_NOT_ALLOWED' }, 405);
};
