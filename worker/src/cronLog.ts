// Suivi des tâches planifiées pour GET /status (sonde publique, .github/workflows/monitor.yml).
// Rien sur les utilisateurs : des heures, des oui/non et des CATÉGORIES d'erreur, jamais un
// message (qui pourrait citer un compte ou un fichier).
//   health:fiscal-watch   dernier succès et dernier échec de la veille fiscale du lundi (cron)
//   health:cron-log       les CRON_LOG_SIZE derniers passages des deux crons, le plus récent d'abord
import { GoogleAuthError } from './google';

/** Les deux tâches planifiées (wrangler.toml) : rappels quotidiens et veille fiscale du lundi. */
export type CronName = 'daily' | 'fiscal-watch';
/** Catégorie d'erreur : lecture Drive, envoi de notification, jeton Google, veille, autre. */
export type CronErrorCategory = 'drive' | 'notification' | 'token' | 'watch' | 'other';

export interface CronLogEntry { at: string; cron: CronName; ok: boolean; errors?: CronErrorCategory[] }
export interface FiscalWatchHealth { lastSuccessAt: string | null; lastFailureAt: string | null; ok: boolean | null }

export const CRON_LOG_KEY = 'health:cron-log';
export const FISCAL_WATCH_HEALTH_KEY = 'health:fiscal-watch';
/** Taille bornée de l'historique : une semaine de rappels et la dernière veille, à peu près. */
export const CRON_LOG_SIZE = 10;

const CATEGORIES: readonly CronErrorCategory[] = ['drive', 'notification', 'token', 'watch', 'other'];

/** Classe une erreur sans garder son texte : jeton Google, lecture Drive, envoi push, sinon « autre ». */
export const categorizeCronError = (e: unknown): CronErrorCategory => {
  if (e instanceof GoogleAuthError) return 'token';
  const message = e instanceof Error ? e.message : String(e);
  if (/^DRIVE_/.test(message)) return 'drive';
  if (/PUSH|VAPID|P256/i.test(message)) return 'notification';
  return 'other';
};

/**
 * Erreurs d'un passage de la tâche quotidienne : les messages (gardés pour /health, réservé à
 * l'app connectée) et leurs catégories (seules publiées dans /status).
 */
export class CronErrors {
  readonly messages: string[] = [];
  private readonly found = new Set<CronErrorCategory>();
  add(e: unknown): void {
    this.messages.push(e instanceof Error ? e.message : String(e));
    this.found.add(categorizeCronError(e));
  }
  get count(): number { return this.messages.length; }
  /** Catégories rencontrées, dans un ordre stable. */
  get categories(): CronErrorCategory[] { return CATEGORIES.filter(c => this.found.has(c)); }
}

const isEntry = (x: unknown): x is CronLogEntry =>
  !!x && typeof x === 'object' && typeof (x as CronLogEntry).at === 'string' && typeof (x as CronLogEntry).ok === 'boolean';

export const readCronLog = async (store: KVNamespace): Promise<CronLogEntry[]> => {
  const raw = await store.get<unknown>(CRON_LOG_KEY, 'json').catch(() => null);
  return Array.isArray(raw) ? raw.filter(isEntry).slice(0, CRON_LOG_SIZE) : [];
};

/** Ajoute un passage en tête de l'historique, borné à CRON_LOG_SIZE entrées. */
export const appendCronLog = async (store: KVNamespace, entry: CronLogEntry): Promise<void> => {
  const clean: CronLogEntry = { at: entry.at, cron: entry.cron, ok: entry.ok, ...(!entry.ok && entry.errors?.length ? { errors: entry.errors } : {}) };
  const log = [clean, ...(await readCronLog(store))].slice(0, CRON_LOG_SIZE);
  await store.put(CRON_LOG_KEY, JSON.stringify(log));
};

export const readFiscalWatchHealth = (store: KVNamespace): Promise<FiscalWatchHealth | null> =>
  store.get<FiscalWatchHealth>(FISCAL_WATCH_HEALTH_KEY, 'json').catch(() => null);

/** Passage du cron de la veille fiscale : dernier succès ou dernier échec, et l'historique. */
export const recordFiscalWatchCron = async (store: KVNamespace, at: Date, ok: boolean): Promise<void> => {
  const iso = at.toISOString();
  const prev = await readFiscalWatchHealth(store);
  const health: FiscalWatchHealth = {
    lastSuccessAt: ok ? iso : prev?.lastSuccessAt ?? null,
    lastFailureAt: ok ? prev?.lastFailureAt ?? null : iso,
    ok,
  };
  await store.put(FISCAL_WATCH_HEALTH_KEY, JSON.stringify(health));
  await appendCronLog(store, { at: iso, cron: 'fiscal-watch', ok, ...(ok ? {} : { errors: ['watch'] }) });
};
