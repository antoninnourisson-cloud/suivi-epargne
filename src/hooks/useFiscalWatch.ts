// Veille fiscale hebdomadaire. Deux sources, la première disponible l'emporte :
//  1. le SERVEUR (si l'app en a un) : chaque lundi, il relit les pages officielles de
//     service-public.gouv.fr et Cloudflare Workers AI en relève les valeurs
//     (worker/src/fiscalWatchJob.ts). Gratuit, sans clé : utilisé s'il date de 8 jours au plus ;
//  2. sinon GEMINI, avec la clé de cet appareil (une fois par semaine à l'ouverture).
// « Vérifier maintenant » passe par Gemini si une clé existe, sinon par le serveur.
// Dans tous les cas, les écarts avec les paramètres de l'app sont PROPOSÉS, jamais appliqués
// d'office (diffFiscalWatch).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiscalConfig, SavingsAccount, TaxBracket } from '../types';
import { diffFiscalWatch, FiscalProposal, FiscalWatchResult, isWatchDue, parseFiscalWatch, FISCAL_WATCH_PROMPT, buildSourcesPrompt } from '../lib/fiscalWatch';
import { getFiscalSources, getServerFiscalWatch, hasBackendSession, isBackendEnabled, runServerFiscalWatch, ServerFiscalWatch } from '../services/backendService';
import { askGeminiWithSearch } from '../services/geminiService';

const KEY = 'fiscal_watch';
export type WatchSource = 'server' | 'gemini';
export interface StoredWatch {
  /** Gemini : dernière tentative (ou date de nouvel essai), résultat et date du dernier succès. */
  checkedAt?: string; result?: FiscalWatchResult; lastSuccessAt?: string; lastAttemptAt?: string; lastError?: string;
  /** Dernier résultat connu de la veille du serveur. */
  server?: ServerFiscalWatch;
  dismissed?: string[];
}

const read = (): StoredWatch => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = (s: StoredWatch) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* non mémorisé */ } };
const signature = (p: FiscalProposal) => `${p.key}=${p.proposed}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const SERVER_RESULT_MAX_AGE_DAYS = 8;

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

// ---------- Détail du relevé du serveur (contrôle de qualité visible dans l'app) ----------

const pct = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const brackets = (v: unknown) => (Array.isArray(v) ? (v as TaxBracket[]).map(b => `${b.limit === null || b.limit === undefined ? '…' : eur(b.limit as number)} : ${pct(b.rate * 100)}`).join(' · ') : '?');

/** Champ du relevé → libellé, mise en forme et clé de la proposition correspondante (diffFiscalWatch). */
const FIELDS: Record<string, { label: string; fmt: (v: unknown) => string; proposal: string }> = {
  livretARate: { label: 'Taux du Livret A', fmt: v => pct(v as number), proposal: 'rate.livretA' },
  lepRate: { label: 'Taux du LEP', fmt: v => pct(v as number), proposal: 'rate.lep' },
  livretACeiling: { label: 'Plafond du Livret A', fmt: v => eur(v as number), proposal: 'ceiling.livretA' },
  lddsCeiling: { label: 'Plafond du LDDS', fmt: v => eur(v as number), proposal: 'ceiling.ldds' },
  lepCeiling: { label: 'Plafond du LEP', fmt: v => eur(v as number), proposal: 'ceiling.lep' },
  lepIncomeCeilingOnePart: { label: 'Plafond de revenus LEP (1 part)', fmt: v => eur(v as number), proposal: 'lepIncomeCeiling' },
  lepPerHalfPart: { label: 'Plafond LEP : ajout par demi-part', fmt: v => eur(v as number), proposal: 'lepCeilingPerHalfPart' },
  socialChargesGeneral: { label: 'Prélèvements sociaux (placements)', fmt: v => pct((v as number) * 100), proposal: 'socialChargesCapital' },
  socialChargesLifeInsurance: { label: 'Prélèvements sociaux (assurance vie)', fmt: v => pct((v as number) * 100), proposal: 'socialChargesLifeInsurance' },
  allowanceCap: { label: "Plafond de l'abattement de 10 %", fmt: v => eur(v as number), proposal: 'standardAllowanceCap' },
  allowanceMin: { label: "Minimum de l'abattement de 10 %", fmt: v => eur(v as number), proposal: 'standardAllowanceMin' },
  decoteSingle: { label: 'Décote (personne seule)', fmt: v => eur(v as number), proposal: 'decote.single' },
  decoteThreshold: { label: 'Seuil de la décote', fmt: v => eur(v as number), proposal: 'decote.threshold' },
  donation75Ceiling: { label: 'Plafond des dons à 75 %', fmt: v => eur(v as number), proposal: 'donation75Ceiling' },
  taxBrackets: { label: "Barème de l'impôt", fmt: brackets, proposal: 'taxBrackets' },
};

const STATUS_LABEL: Record<string, string> = {
  fetch_failed: 'page injoignable', invalid_json: 'réponse illisible', ai_error: "erreur de l'IA", skipped_budget: 'sautée (budget)', no_fields: 'rien à relever',
};

export interface ServerWatchRow { key: string; label: string; value: string; sameAsApp: boolean; quote?: string; source?: string }
export interface ServerWatchReport { rows: ServerWatchRow[]; issues: string[]; model: string; neurons?: number; checkedAt: string }

/** Chaque valeur relevée par le serveur, comparée aux paramètres de l'app, et les pages en défaut. */
export const describeServerWatch = (s: ServerFiscalWatch, fiscal: FiscalConfig, accounts: SavingsAccount[]): ServerWatchReport => {
  const differing = new Set(diffFiscalWatch(s.values as FiscalWatchResult, fiscal, accounts).map(p => p.key));
  const rows: ServerWatchRow[] = [];
  for (const [key, meta] of Object.entries(FIELDS)) {
    const w = (s.values as Record<string, { value?: unknown; quote?: string; source?: string } | undefined>)[key];
    if (!w || w.value === undefined) continue;
    rows.push({ key, label: meta.label, value: meta.fmt(w.value), sameAsApp: !differing.has(meta.proposal), quote: w.quote, source: w.source });
  }
  const issues: string[] = [];
  for (const src of s.sources || []) {
    if (src.status !== 'ok' && src.status !== 'no_fields') issues.push(`${src.topic} : ${STATUS_LABEL[src.status] || src.status}`);
    for (const r of src.rejected || []) issues.push(`${FIELDS[r.field]?.label || r.field} écarté : ${r.reason}`);
  }
  return { rows, issues, model: s.model, neurons: s.neuronsUsed ?? s.neuronsEstimate, checkedAt: s.checkedAt };
};

// ---------- Hook ----------

const serverAvailable = () => isBackendEnabled() && hasBackendSession();

export const useFiscalWatch = (geminiApiKey: string, fiscal: FiscalConfig | undefined, accounts: SavingsAccount[], enabled: boolean) => {
  const [stored, setStored] = useState<StoredWatch>(read);
  const [runningVia, setRunningVia] = useState<WatchSource | undefined>();
  const serverChecked = useRef(false);
  const running = runningVia !== undefined;

  const update = (patch: Partial<StoredWatch>) => setStored(prev => { const next = { ...prev, ...patch }; write(next); return next; });

  const runGemini = useCallback(async () => {
    if (!geminiApiKey) return;
    setRunningVia('gemini');
    try {
      let text: string;
      const sources = isBackendEnabled() ? await getFiscalSources().catch(() => []) : [];
      const readable = sources.filter(x => x.ok && x.text);
      if (readable.length >= 3) text = await askGeminiWithSearch(geminiApiKey, buildSourcesPrompt(readable), 90_000, false);
      else text = await askGeminiWithSearch(geminiApiKey, FISCAL_WATCH_PROMPT);
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
  // 8 jours) ; Gemini seulement s'il n'y a rien de récent côté serveur.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      let fresh = isServerResultFresh(read().server);
      if (!serverChecked.current && serverAvailable()) {
        serverChecked.current = true;
        try {
          let s = await getServerFiscalWatch();
          if (s) update({ server: s });
          if (!isServerResultFresh(s) && !cancelled) s = (await runServer()) ?? s;
          fresh = isServerResultFresh(s);
        } catch (e) {
          console.warn('Veille fiscale du serveur indisponible', e);
        }
      }
      if (!cancelled && !fresh && geminiApiKey && isWatchDue(read().checkedAt)) void runGemini();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geminiApiKey]);

  const picked = useMemo(() => pickWatchResult(stored), [stored]);

  const proposals = useMemo(() => {
    if (!picked.result || !fiscal) return [];
    const dismissed = new Set(stored.dismissed || []);
    return diffFiscalWatch(picked.result, fiscal, accounts).filter(p => !dismissed.has(signature(p)));
  }, [picked.result, stored.dismissed, fiscal, accounts]);

  const serverReport = useMemo(
    () => (picked.source === 'server' && stored.server && fiscal ? describeServerWatch(stored.server, fiscal, accounts) : undefined),
    [picked.source, stored.server, fiscal, accounts],
  );

  const dismiss = (p: FiscalProposal) => update({ dismissed: [...(stored.dismissed || []), signature(p)] });

  return {
    proposals, running, runningVia, run, dismiss,
    checkedAt: picked.checkedAt, source: picked.source, serverReport,
    lastAttemptAt: stored.lastAttemptAt, lastError: stored.lastError,
    hasKey: !!geminiApiKey, canRun: !!geminiApiKey || serverAvailable(),
  };
};
