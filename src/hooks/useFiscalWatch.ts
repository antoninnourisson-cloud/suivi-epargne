// Veille fiscale hebdomadaire. Deux sources, la première disponible l'emporte :
//  1. le SERVEUR (si l'app en a un) : chaque lundi, il relit les pages officielles de
//     service-public.gouv.fr et Cloudflare Workers AI en relève les valeurs
//     (worker/src/fiscalWatchJob.ts). Gratuit, sans clé : utilisé s'il date de 8 jours au plus ;
//  2. sinon GEMINI, avec la clé de cet appareil (une fois par semaine à l'ouverture).
// « Vérifier maintenant » passe par Gemini si une clé existe, sinon par le serveur.
// Dans tous les cas, les écarts avec les paramètres de l'app sont PROPOSÉS, jamais appliqués
// d'office (diffFiscalWatch).
// Le moteur (lecture, comparaison, détail du relevé : hooks/fiscalWatchEngine) est chargé à
// part, une fois l'app prête : il ne pèse pas sur le démarrage.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lsGetJSON, lsSetJSON } from '../lib/storage';
import type { FiscalConfig, SavingsAccount } from '../types';
import type { FiscalProposal, FiscalWatchResult } from '../lib/fiscalWatch';
import { getFiscalSources, getServerFiscalWatch, hasBackendSession, isBackendEnabled, runServerFiscalWatch, type ServerFiscalWatch } from '../services/backendService';
import { recordError } from '../lib/errorJournal';

export type { ServerWatchReport, ServerWatchRow } from './fiscalWatchEngine';
type Engine = typeof import('./fiscalWatchEngine');
let engine: Promise<Engine> | null = null;
/** Moteur de la veille, chargé une fois (un échec est retenté au prochain appel). */
const loadFiscalWatchEngine = (): Promise<Engine> =>
  (engine ??= import('./fiscalWatchEngine').catch((e: unknown) => { engine = null; throw e; }));

const KEY = 'fiscal_watch';
export type WatchSource = 'server' | 'gemini';
export interface StoredWatch {
  /** Gemini : dernière tentative (ou date de nouvel essai), résultat et date du dernier succès. */
  checkedAt?: string; result?: FiscalWatchResult; lastSuccessAt?: string; lastAttemptAt?: string; lastError?: string;
  /** Dernier résultat connu de la veille du serveur. */
  server?: ServerFiscalWatch;
  dismissed?: string[];
}

const read = (): StoredWatch => lsGetJSON<StoredWatch>(KEY, {});
const write = (s: StoredWatch) => lsSetJSON(KEY, s);
const signature = (p: FiscalProposal) => `${p.key}=${p.proposed}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const SERVER_RESULT_MAX_AGE_DAYS = 8;
const NO_PROPOSALS: FiscalProposal[] = [];

/** Résultat du serveur utilisable : réussi et vieux de 8 jours au plus. */
export const isServerResultFresh = (s: Pick<ServerFiscalWatch, 'checkedAt' | 'ok'> | null | undefined, now: Date = new Date()): s is ServerFiscalWatch => {
  if (!s || s.ok === false || !s.checkedAt) return false;
  const age = now.getTime() - new Date(s.checkedAt).getTime();
  return Number.isFinite(age) && age <= SERVER_RESULT_MAX_AGE_DAYS * 86_400_000;
};

/**
 * Résultat à comparer aux paramètres : celui du serveur s'il est récent, sauf si l'utilisateur
 * a lancé depuis une vérification Gemini (plus récente) ; sinon le dernier résultat Gemini.
 */
export const pickWatchResult = (s: StoredWatch, now: Date = new Date()): { result?: FiscalWatchResult; source?: WatchSource; checkedAt?: string } => {
  const server = isServerResultFresh(s.server, now) ? s.server : undefined;
  const geminiAt = s.result ? s.lastSuccessAt : undefined;
  if (server && !(geminiAt && geminiAt > server.checkedAt)) return { result: server.values as FiscalWatchResult, source: 'server', checkedAt: server.checkedAt };
  if (s.result) return { result: s.result, source: 'gemini', checkedAt: s.lastSuccessAt };
  return {};
};

// ---------- Hook ----------

const serverAvailable = () => isBackendEnabled() && hasBackendSession();

export const useFiscalWatch = (geminiApiKey: string, fiscal: FiscalConfig | undefined, accounts: SavingsAccount[], enabled: boolean) => {
  const [stored, setStored] = useState<StoredWatch>(read);
  // Moteur chargé une fois l'app prête : avant, ni proposition ni détail (rien n'est affiché).
  const [eng, setEng] = useState<Engine | null>(null);
  useEffect(() => {
    if (!enabled || eng) return;
    let alive = true;
    loadFiscalWatchEngine().then(m => { if (alive) setEng(m); }).catch((e: unknown) => {
      console.warn('Veille fiscale : module indisponible', e);
      recordError('chargement', e);
    });
    return () => { alive = false; };
  }, [enabled, eng]);
  const [runningVia, setRunningVia] = useState<WatchSource | undefined>();
  const running = runningVia !== undefined;

  const update = (patch: Partial<StoredWatch>) => setStored(prev => { const next = { ...prev, ...patch }; write(next); return next; });

  const runGemini = useCallback(async () => {
    if (!geminiApiKey) return;
    setRunningVia('gemini');
    try {
      // Chargé seulement quand la veille passe par Gemini : rien de plus au démarrage.
      const [{ askFiscalWatch }, { parseFiscalWatch }] = await Promise.all([import('../services/fiscalWatchGemini'), loadFiscalWatchEngine()]);
      const sources = isBackendEnabled() ? await getFiscalSources().catch(() => []) : [];
      const text = await askFiscalWatch(geminiApiKey, sources.filter(x => x.ok && x.text));
      const result = parseFiscalWatch(text);
      if (!result) { console.warn('Veille fiscale : réponse illisible', text.slice(0, 500)); throw new Error('Réponse de Gemini illisible'); }
      const now = new Date().toISOString();
      update({ checkedAt: now, lastSuccessAt: now, lastAttemptAt: now, result, lastError: undefined });
    } catch (e) {
      // Échec : on retentera à la prochaine ouverture, au plus tôt dans un jour.
      const retryAt = new Date(Date.now() - 6 * 86_400_000).toISOString();
      console.warn('Veille fiscale : échec', e);
      update({ checkedAt: retryAt, lastAttemptAt: new Date().toISOString(), lastError: errorText(e) });
    } finally {
      setRunningVia(undefined);
    }
  }, [geminiApiKey]);

  /** Demande au serveur de relancer sa veille (il la limite lui-même à une toutes les 20 h). */
  const runServer = useCallback(async (): Promise<ServerFiscalWatch | null> => {
    setRunningVia('server');
    try {
      const s = await runServerFiscalWatch();
      if (s) update({ server: s, lastError: undefined, lastAttemptAt: new Date().toISOString() });
      return s;
    } catch (e) {
      console.warn('Veille fiscale du serveur : échec', e);
      update({ lastError: errorText(e), lastAttemptAt: new Date().toISOString() });
      return null;
    } finally {
      setRunningVia(undefined);
    }
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    if (geminiApiKey) await runGemini();
    else if (serverAvailable()) await runServer();
  }, [running, geminiApiKey, runGemini, runServer]);

  // À l'ouverture : résultat du serveur d'abord (relancé s'il manque ou date de plus de
  // 8 jours), une seule fois par session. Cette étape ne dépend pas de la clé Gemini : la
  // clé arrive souvent juste après le premier rendu, et relancer l'effet annulait la
  // demande au serveur à mi-chemin (on retombait alors sur Gemini sans relevé du serveur).
  const serverDone = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    if (!enabled || serverDone.current || !serverAvailable()) return;
    serverDone.current = (async () => {
      try {
        let s = await getServerFiscalWatch();
        if (s) update({ server: s });
        if (!isServerResultFresh(s)) s = (await runServer()) ?? s;
        return isServerResultFresh(s);
      } catch (e) {
        console.warn('Veille fiscale du serveur indisponible', e);
        return false;
      }
    })();
  }, [enabled, runServer]);

  // Gemini seulement s'il n'y a rien de récent côté serveur (une fois l'étape serveur finie).
  useEffect(() => {
    if (!enabled || !geminiApiKey) return;
    let cancelled = false;
    void (async () => {
      const fresh = serverDone.current ? await serverDone.current : isServerResultFresh(read().server);
      if (cancelled || fresh || isServerResultFresh(read().server)) return;
      const { isWatchDue } = await loadFiscalWatchEngine();
      if (!cancelled && isWatchDue(read().checkedAt)) void runGemini();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runGemini change avec la clé, déjà dans les dépendances
  }, [enabled, geminiApiKey]);

  const picked = useMemo(() => pickWatchResult(stored), [stored]);

  const proposals = useMemo(() => {
    if (!eng || !picked.result || !fiscal) return NO_PROPOSALS;
    const dismissed = new Set(stored.dismissed || []);
    return eng.diffFiscalWatch(picked.result, fiscal, accounts).filter(p => !dismissed.has(signature(p)));
  }, [eng, picked.result, stored.dismissed, fiscal, accounts]);

  const serverReport = useMemo(
    () => (eng && picked.source === 'server' && stored.server && fiscal ? eng.describeServerWatch(stored.server, fiscal, accounts) : undefined),
    [eng, picked.source, stored.server, fiscal, accounts],
  );

  const dismiss = useCallback((p: FiscalProposal) => setStored(prev => {
    const next = { ...prev, dismissed: [...(prev.dismissed || []), signature(p)] };
    write(next);
    return next;
  }), []);

  // Objet stable tant que rien ne change : les écrans qui l'affichent ne sont pas re-rendus
  // à chaque rendu d'App.
  const canRun = !!geminiApiKey || serverAvailable();
  return useMemo(() => ({
    proposals, running, runningVia, run, dismiss,
    checkedAt: picked.checkedAt, source: picked.source, serverReport,
    lastAttemptAt: stored.lastAttemptAt, lastError: stored.lastError,
    hasKey: !!geminiApiKey, canRun,
  }), [proposals, running, runningVia, run, dismiss, picked.checkedAt, picked.source, serverReport, stored.lastAttemptAt, stored.lastError, geminiApiKey, canRun]);
};

export type FiscalWatch = ReturnType<typeof useFiscalWatch>;
