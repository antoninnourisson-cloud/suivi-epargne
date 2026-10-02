// Veille fiscale hebdomadaire : une fois par semaine (à l'ouverture de l'app, avec la clé
// Gemini de cet appareil), Gemini cherche sur le web les valeurs officielles en vigueur. Les
// écarts avec les paramètres de l'app sont PROPOSÉS, jamais appliqués d'office.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiscalConfig, SavingsAccount } from '../types';
import { diffFiscalWatch, FiscalProposal, FiscalWatchResult, isWatchDue, parseFiscalWatch, FISCAL_WATCH_PROMPT } from '../lib/fiscalWatch';
import { askGeminiWithSearch } from '../services/geminiService';

const KEY = 'fiscal_watch';
interface Stored { checkedAt?: string; result?: FiscalWatchResult; dismissed?: string[]; lastError?: string; lastSuccessAt?: string; lastAttemptAt?: string }

const read = (): Stored => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = (s: Stored) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* non mémorisé */ } };
const signature = (p: FiscalProposal) => `${p.key}=${p.proposed}`;

export const useFiscalWatch = (geminiApiKey: string, fiscal: FiscalConfig | undefined, accounts: SavingsAccount[], enabled: boolean) => {
  const [stored, setStored] = useState<Stored>(read);
  const [running, setRunning] = useState(false);

  const update = (patch: Partial<Stored>) => setStored(prev => { const next = { ...prev, ...patch }; write(next); return next; });

  const run = useCallback(async () => {
    if (!geminiApiKey || running) return;
    setRunning(true);
    try {
      const text = await askGeminiWithSearch(geminiApiKey, FISCAL_WATCH_PROMPT);
      const result = parseFiscalWatch(text);
      if (!result) { console.warn('Veille fiscale : réponse illisible', text.slice(0, 500)); throw new Error('Réponse de Gemini illisible'); }
      const now = new Date().toISOString();
      update({ checkedAt: now, lastSuccessAt: now, lastAttemptAt: now, result, lastError: undefined });
    } catch (e) {
      // Échec : on retentera à la prochaine ouverture, au plus tôt dans un jour.
      const retryAt = new Date(Date.now() - 6 * 86_400_000).toISOString();
      console.warn('Veille fiscale : échec', e);
      update({ checkedAt: retryAt, lastAttemptAt: new Date().toISOString(), lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
     
  }, [geminiApiKey, running]);

  useEffect(() => {
    if (enabled && geminiApiKey && isWatchDue(stored.checkedAt)) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geminiApiKey]);

  const proposals = useMemo(() => {
    if (!stored.result || !fiscal) return [];
    const dismissed = new Set(stored.dismissed || []);
    return diffFiscalWatch(stored.result, fiscal, accounts).filter(p => !dismissed.has(signature(p)));
  }, [stored.result, stored.dismissed, fiscal, accounts]);

  const dismiss = (p: FiscalProposal) => update({ dismissed: [...(stored.dismissed || []), signature(p)] });

  return { proposals, running, run, dismiss, checkedAt: stored.lastSuccessAt, lastAttemptAt: stored.lastAttemptAt, lastError: stored.lastError, hasKey: !!geminiApiKey };
};
