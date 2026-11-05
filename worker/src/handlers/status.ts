// ================================================
// FILE: worker/src/handlers/status.ts
// Routes de veille fiscale, de santé (/health) et de sonde publique (/status).
// Découpé de worker/src/index.ts sans changement de comportement.
// ================================================
import { fetchFiscalSources, FiscalSource } from '../fiscalSources';
import { cachedSiteCheck } from '../siteCheck';
import { readCronLog, readFiscalWatchHealth } from '../cronLog';
import { LATEST_KEY, FAILURE_KEY, FiscalWatchRun, runAndStoreFiscalWatch, canRunOnDemand } from '../fiscalWatchJob';
import { json } from './http';
import { requireSession } from './session';
import { CronHealth } from './cron';
import type { Env } from '../index';

// Pages officielles pour la veille fiscale (mises en cache 3 jours : une lecture par semaine
// et par appareil suffit, et le cache évite de solliciter les sites publics).
export const handleFiscalSources = async (req: Request, env: Env): Promise<Response> => {
  await requireSession(req, env);
  const cached = await env.STORE.get<{ fetchedAt: string; sources: FiscalSource[] }>('fiscal-sources', 'json');
  if (cached && cached.sources.some(x => x.ok)) return json(req, env, cached);
  const sources = await fetchFiscalSources();
  const payload = { fetchedAt: new Date().toISOString(), sources };
  if (sources.filter(x => x.ok).length >= 4) await env.STORE.put('fiscal-sources', JSON.stringify(payload), { expirationTtl: 3 * 86400 });
  return json(req, env, payload);
};

// Veille fiscale du serveur (Workers AI) : dernier résultat, et exécution à la demande
// (limitée : une toutes les 20 h après un succès, 6 h après un essai, pour le quota gratuit).
export const handleFiscalWatch = async (req: Request, env: Env): Promise<Response> => {
  await requireSession(req, env);
  const latest = await env.STORE.get<FiscalWatchRun>(LATEST_KEY, 'json');
  const lastFailure = await env.STORE.get<FiscalWatchRun>(FAILURE_KEY, 'json');
  const failure = lastFailure && (!latest || lastFailure.checkedAt > latest.checkedAt) ? { lastFailure } : {};
  if (!latest) return json(req, env, { error: 'NOT_YET_RUN', ...failure }, 404);
  return json(req, env, { ...latest, ...failure });
};

export const handleFiscalWatchRun = async (req: Request, env: Env): Promise<Response> => {
  await requireSession(req, env);
  if (!env.AI) return json(req, env, { error: 'AI_UNAVAILABLE' }, 503);
  if (!(await canRunOnDemand(env.STORE))) {
    const latest = await env.STORE.get<FiscalWatchRun>(LATEST_KEY, 'json');
    return json(req, env, { error: 'TOO_SOON', ...(latest ? { latest } : {}) }, 429, { 'Retry-After': '3600' });
  }
  const run = await runAndStoreFiscalWatch(env.STORE, env.AI);
  return json(req, env, run, run.ok ? 200 : 502);
};

export const handleHealth = async (req: Request, env: Env): Promise<Response> => {
  await requireSession(req, env);
  const health = await env.STORE.get<CronHealth>('health:cron', 'json');
  return json(req, env, health ?? { lastRunAt: null, ok: null, usersProcessed: 0 });
};

/**
 * Sonde publique de la surveillance quotidienne (.github/workflows/monitor.yml) : le serveur
 * répond, la dernière tâche quotidienne a-t-elle réussi, à quand remonte la dernière veille
 * fiscale réussie ? Volontairement sans session et sans détail (ni message d'erreur, ni nombre
 * d'utilisateurs, seulement des catégories d'erreur) : rien sur les utilisateurs.
 */
export const handleStatus = async (req: Request, env: Env): Promise<Response> => {
  const [health, watch, history] = await Promise.all([
    env.STORE.get<CronHealth>('health:cron', 'json'),
    readFiscalWatchHealth(env.STORE),
    readCronLog(env.STORE),
  ]);
  // Avant le premier passage suivi du cron, le dernier relevé réussi tient lieu de dernier succès.
  const latest = watch ? null : await env.STORE.get<FiscalWatchRun>(LATEST_KEY, 'json').catch(() => null);
  const fiscalWatch = watch
    ? { lastSuccessAt: watch.lastSuccessAt, lastFailureAt: watch.lastFailureAt, ok: watch.ok }
    : { lastSuccessAt: latest?.checkedAt ?? null, lastFailureAt: null, ok: latest ? true : null };
  // Contrôle du site publié par le serveur (la surveillance GitHub est bloquée par la
  // protection anti-robots de Cloudflare) ; résultat réutilisé 15 min.
  const site = await cachedSiteCheck(env.STORE, env.APP_URL).catch(() => null);
  return json(req, env, {
    ok: true, cron: { lastRunAt: health?.lastRunAt ?? null, ok: health?.ok ?? null }, site,
    // Envois de notifications du dernier passage quotidien (nombres seulement) : la
    // surveillance n'alerte que si tous ont échoué, ou si 3 passages de suite en ont eu.
    notifications: health?.notifications ? { ...health.notifications } : null,
    // Veille fiscale du lundi et derniers passages des deux crons (heure, tâche, résultat,
    // catégorie d'erreur) : worker/src/cronLog.ts.
    fiscalWatch, history,
  });
};
