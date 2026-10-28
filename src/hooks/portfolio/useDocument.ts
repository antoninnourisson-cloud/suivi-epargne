// Le document de l'app (contenu du fichier Drive, normalisé par migrate()) et ses
// modifications. Rien sur la synchronisation ici (voir useDriveSync) : l'état, ses setters et
// ce qui reste sur l'appareil (clé Gemini, dernier écran). Les soldes ne changent que par les
// commandes de lib/commands (annulation exacte), appliquées par useAccountActions.commit.
import { useState, useCallback, useRef, useMemo } from 'react';
import { lsDel, lsGet, lsSet } from '../../lib/storage';
import { migrate, emptyData, withoutDeviceOnlyFields, APP_SCHEMA_VERSION } from '../../lib/schema';
import { downloadJSON } from '../../services/fileDownload';
import { localTodayISO } from '../../lib/dates';
import type { AppDoc, WorkBenefits } from '../../types';
import { GEMINI_KEY, LAST_VIEW_KEY } from './keys';

type Config = AppDoc['config'];
type Updater<T> = T | ((prev: T) => T);
const resolve = <T,>(u: Updater<T>, prev: T): T => (typeof u === 'function' ? (u as (p: T) => T)(prev) : u);

export const useDocument = () => {
  const [doc, setDoc] = useState<AppDoc>(emptyData);
  // État le plus récent pour le code asynchrone et les écouteurs (sans les réabonner).
  const docRef = useRef(doc);
  docRef.current = doc;

  const [geminiApiKey, setGeminiKeyState] = useState<string>(() => lsGet(GEMINI_KEY) || '');
  const setGeminiApiKey = useCallback((k: string) => {
    setGeminiKeyState(k);
    if (k) lsSet(GEMINI_KEY, k); else lsDel(GEMINI_KEY);
  }, []);

  const [lastView, setLastViewState] = useState<string>(() => lsGet(LAST_VIEW_KEY) || 'dashboard');
  const lastViewRef = useRef(lastView);
  // Persiste la vue localement SANS déclencher de réécriture Drive à chaque changement d'onglet.
  const setLastView = useCallback((v: string) => {
    lsSet(LAST_VIEW_KEY, v);
    lastViewRef.current = v;
    setLastViewState(v);
  }, []);

  /**
   * Remplace tout le document (chargement, import, restauration) : toujours par migrate().
   * `adoptLegacyGeminiKey` : chargement du fichier Drive de l'utilisateur seulement. Une
   * ancienne version y gardait la clé Gemini : elle est reprise sur l'appareil s'il n'en a
   * pas. Jamais depuis un fichier importé ou une copie : un fichier piégé ferait sinon
   * envoyer les documents suivants (fiches de paie, relevés) au projet Gemini d'un tiers.
   */
  const applyData = useCallback((raw: unknown, opts?: { adoptLegacyGeminiKey?: boolean }) => {
    const k = (raw as { config?: { geminiApiKey?: unknown } } | null)?.config?.geminiApiKey;
    if (opts?.adoptLegacyGeminiKey && typeof k === 'string' && k && !lsGet(GEMINI_KEY)) setGeminiApiKey(k);
    setDoc(withoutDeviceOnlyFields(migrate(raw)));
  }, [setGeminiApiKey]);

  // Ce qui part sur Drive : le document, sans secret d'appareil, avec la vue courante.
  const buildData = useCallback((): AppDoc => ({
    ...withoutDeviceOnlyFields(doc), schemaVersion: APP_SCHEMA_VERSION, lastView: lastViewRef.current,
  }), [doc]);
  /** Même chose, pour l'état le plus récent (écouteurs, fin d'écriture, déconnexion). */
  const currentData = useCallback((): AppDoc => ({
    ...withoutDeviceOnlyFields(docRef.current), schemaVersion: APP_SCHEMA_VERSION, lastView: lastViewRef.current,
  }), []);

  // --- SETTERS (stables) ---
  const setters = useMemo(() => {
    const top = <K extends keyof AppDoc>(k: K) => (u: Updater<AppDoc[K]>) => setDoc(d => ({ ...d, [k]: resolve(u, d[k]) }));
    return {
      setAccounts: top('accounts'),
      setExpenses: top('expenses'),
      setPayslips: top('payslips'),
      setRecurringMovements: top('recurringMovements'),
      setSubscriptions: top('subscriptions'),
      setDonations: top('donations'),
      setPayChecklist: top('payChecklist'),
      setParentalRestitution: top('parentalRestitution'),
      setActivePayslipId: top('activePayslipId'),
      setFiscalConfig: top('fiscalConfig'),
      /** Modifie les avantages à partir de leur état le plus récent (seuls les champs touchés changent). */
      updateWorkBenefits: (update: (prev: WorkBenefits) => WorkBenefits) => setDoc(d => ({ ...d, workBenefits: update(d.workBenefits) })),
      /** Modifie un ou plusieurs réglages (les autres restent tels quels). */
      patchConfig: (patch: Partial<Config>) => setDoc(d => ({ ...d, config: { ...d.config, ...patch } })),
    };
  }, []);

  const exportData = useCallback(() => {
    downloadJSON(`pecule-${localTodayISO()}.json`, currentData());
  }, [currentData]);

  return {
    doc, setDoc, docRef, applyData, buildData, currentData,
    geminiApiKey, setGeminiApiKey, lastView, setLastView,
    setters, exportData,
  };
};

export type DocumentState = ReturnType<typeof useDocument>;
