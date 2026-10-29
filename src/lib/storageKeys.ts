// Registre des clés du stockage local de l'appareil (localStorage, sessionStorage) : un seul
// endroit pour leurs noms et leur nature, utilisé par le ménage au démarrage et par les
// effacements (déconnexion, « Code oublié »). Un test (storageKeys.test.ts) vérifie qu'aucune clé du code
// n'échappe à ce registre.
//
// Nature d'une clé :
// - 'data'       copie de vos données (toujours chiffrée, voir localVault) ;
// - 'secret'     clé, jeton ou empreinte : jamais affiché, jamais exporté ;
// - 'trace'      trace d'usage liée à vos données (identifiants de comptes ou de fichiers,
//                choix faits sur l'Accueil) : effacée à la déconnexion (donc aussi par
//                « Code oublié ») ;
// - 'device'     état propre à cet appareil (son identifiant, ses tâches de fond), gardé ;
// - 'preference' réglage d'affichage sans rapport avec vos données (thème, cartes ouvertes).
import { lsDel, lsGetJSON, lsSetJSON } from './storage';

export type StorageKeyKind = 'data' | 'secret' | 'trace' | 'device' | 'preference';

export const STORAGE_KEYS = {
  // --- Vos données (chiffrées) ---
  /** Miroir des modifications pas encore sur Drive. */
  backup: { key: 'suivi_epargne_backup', kind: 'data' },
  /** Quarantaine : modifications qui n'ont jamais atteint Drive, détectées au démarrage. */
  pending: { key: 'suivi_epargne_pending', kind: 'data' },
  /**
   * Copies jamais envoyées illisibles pour l'instant (stockage protégé indisponible), mises à
   * l'abri telles quelles avant que le miroir ou la quarantaine ne les réécrivent.
   */
  held: { key: 'suivi_epargne_held', kind: 'data' },
  /** Dernier état confirmé sur Drive (ouverture hors ligne). */
  offlineCopy: { key: 'pecule_offline_copy', kind: 'data' },
  /** Versions mises de côté (30 jours). */
  setAside: { key: 'suivi_epargne_set_aside', kind: 'data' },

  // --- Secrets et sessions ---
  geminiApiKey: { key: 'gemini_api_key', kind: 'secret' },
  googleToken: { key: 'google_token', kind: 'secret' },
  googleTokenExpiry: { key: 'token_expiry', kind: 'secret' },
  googleAuthPersistence: { key: 'auth_persistence', kind: 'secret' },
  backendSession: { key: 'backend_session', kind: 'secret' },
  lockCredentialId: { key: 'app_lock_credential_id', kind: 'secret' },
  lockPinHash: { key: 'app_lock_pin_hash', kind: 'secret' },
  lockPinSalt: { key: 'app_lock_pin_salt', kind: 'secret' },
  lockPinIterations: { key: 'app_lock_pin_iterations', kind: 'secret' },
  lockPinFails: { key: 'app_lock_pin_fails', kind: 'secret' },
  lockResetRequested: { key: 'app_lock_reset_requested', kind: 'secret' },
  lockResetPending: { key: 'app_lock_reset_pending', kind: 'secret' },
  lockResetAlerted: { key: 'app_lock_reset_alerted', kind: 'secret' },
  lockResetAlertPending: { key: 'app_lock_reset_alert_pending', kind: 'secret' },
  lockLastReset: { key: 'app_lock_last_reset', kind: 'secret' },

  // --- Traces d'usage liées à vos données ---
  /** Annonce des sauvegardes aux autres onglets (identifiant du fichier Drive). */
  lastSave: { key: 'suivi_epargne_last_save', kind: 'trace' },
  /** Dernier écran ouvert. */
  lastView: { key: 'last_view', kind: 'trace' },
  lastDriveBackupMonth: { key: 'last_drive_backup_month', kind: 'trace' },
  duplicateDismissed: { key: 'pecule_duplicate_dismissed', kind: 'trace' },
  quickAddLastAccount: { key: 'quickadd_last_account', kind: 'trace' },
  /** Alertes de l'Accueil mises en « Plus tard » (clé de l'alerte → fin du report). */
  todoSnoozed: { key: 'todo_snoozed', kind: 'trace' },
  /** Choix datés de l'Accueil (échéance passée ce mois-ci, taux d'AV vérifié, hausse de salaire vue), élagués. */
  homeMarks: { key: 'home_marks', kind: 'trace' },
  dismissedRateRevision: { key: 'dismissed_rate_revision', kind: 'trace' },
  taxReturnFiled: { key: 'tax_return_filed', kind: 'trace' },
  /** Saisies d'Actualiser gardées le temps de la session (sessionStorage). */
  updateDrafts: { key: 'pecule.updateDrafts', kind: 'trace' },

  // --- État de cet appareil ---
  /** Identifiant aléatoire de cet appareil (signature des écritures). */
  deviceId: { key: 'pecule_device_id', kind: 'device' },
  /** Dernière sauvegarde de secours chiffrée envoyée au serveur. */
  cloudBackupStatus: { key: 'cloud_backup_status', kind: 'device' },
  /** Dernière veille fiscale (valeurs publiques relevées, propositions écartées). */
  fiscalWatch: { key: 'fiscal_watch', kind: 'device' },
  /** 20 dernières erreurs de l'app, nettoyées de toute donnée (lib/errorJournal). */
  errorJournal: { key: 'pecule_error_journal', kind: 'device' },
  /** Délai avant le verrouillage après un passage en arrière-plan (réglage de cet appareil). */
  lockDelay: { key: 'app_lock_delay', kind: 'device' },

  // --- Préférences d'affichage ---
  /** Thème choisi (« Clair » ou « Sombre ») ; absent = « Automatique », comme le système. */
  themeChoice: { key: 'theme_choice', kind: 'preference' },
  /** Ancienne clé du thème, écrite même sans choix : reprise une fois par useTheme, puis effacée. */
  theme: { key: 'theme', kind: 'preference' },
  /** Mode discret (« 1 ») : montants affichés en « •••• € » ; absent = montants visibles. */
  discreetAmounts: { key: 'discreet_amounts', kind: 'preference' },
  dashboardDateRange: { key: 'dashboard_date_range', kind: 'preference' },
  homeMoreOpen: { key: 'home_more_open', kind: 'preference' },
  todoOpen: { key: 'todo_open', kind: 'preference' },
  settingsOpenCards: { key: 'settings_open_cards', kind: 'preference' },
  installPromptDismissedAt: { key: 'install_prompt_dismissed_at', kind: 'preference' },
  lastSeenVersion: { key: 'last_seen_version', kind: 'preference' },
  geminiModel: { key: 'gemini_model', kind: 'preference' },
  /** Dernier rechargement après un fichier de l'app introuvable (sessionStorage). */
  chunkReloadAt: { key: 'chunk_reload_at', kind: 'preference' },
} as const satisfies Record<string, { key: string; kind: StorageKeyKind }>;

export type StorageKeyName = keyof typeof STORAGE_KEYS;

/** Nom de la clé. */
export const storageKey = (name: StorageKeyName): string => STORAGE_KEYS[name].key;

/** Clés d'une nature donnée. */
export const keysOfKind = (kind: StorageKeyKind): string[] =>
  Object.values(STORAGE_KEYS).filter(k => k.kind === kind).map(k => k.key);

/**
 * Clés d'anciennes versions de l'app, devenues inutiles : effacées une fois au démarrage.
 * Les clés datées d'avant `home_marks` (une par mois, par année ou par fiche de paie) y sont
 * reprises avant d'être effacées.
 */
export const OBSOLETE_KEYS = ['auth_timestamp', 'financing_insurance', 'financing_interest', 'goal_prompt', 'dashboard_todo_open'];
const LEGACY_SKIPPED = /^skipped_recurring_(\d{4}-\d{2})$/;
const LEGACY_AV_RATE = /^av_rate_checked_(\d{4})$/;
const LEGACY_PAY_RAISE = /^pay_raise_seen_(.+)$/;

// ---------------------------------------------------------------------------
// Choix datés de l'Accueil : un seul objet, élagué
// ---------------------------------------------------------------------------

/** Repère → date (AAAA-MM-JJ) à laquelle il a été posé. */
export type Marks = Record<string, string>;
/** Repères gardés un peu plus d'un an : au-delà, ils ne servent plus (mois, année, fiche passés). */
const MARK_RETENTION_DAYS = 400;

const isMarks = (v: unknown): v is Marks =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as Record<string, unknown>).every(x => typeof x === 'string');

/**
 * Repères jamais élagués par l'âge : la hausse de salaire vue pour une fiche de paie. La
 * détection (detectPayRaise) compare les deux dernières fiches quelle que soit leur date : sans
 * nouvelle fiche pendant plus de 400 jours, un repère élagué ferait proposer, et ajouter, la même
 * hausse une seconde fois. Il n'y en a qu'un par hausse acceptée ou écartée : la liste reste courte.
 */
const PERMANENT_MARK_PREFIXES = ['pay-raise:'];
const isPermanentMark = (id: string): boolean => PERMANENT_MARK_PREFIXES.some(p => id.startsWith(p));

/** Repères encore utiles à la date `today` (AAAA-MM-JJ) ; les dates illisibles sont retirées. */
export const pruneMarks = (marks: Marks, today: string): Marks => {
  const limit = Date.parse(today) - MARK_RETENTION_DAYS * 86_400_000;
  return Object.fromEntries(Object.entries(marks).filter(([id, at]) => {
    if (isPermanentMark(id)) return true;
    const t = Date.parse(at);
    return Number.isFinite(t) && t >= limit;
  }));
};

export const readMarks = (): Marks => lsGetJSON<Marks>(STORAGE_KEYS.homeMarks.key, {}, isMarks);
export const hasMark = (id: string): boolean => id in readMarks();
/** Pose un repère (daté `today`) et élague les anciens. */
export const setMark = (id: string, today: string): void =>
  lsSetJSON(STORAGE_KEYS.homeMarks.key, pruneMarks({ ...readMarks(), [id]: today }, today));

/** Repères de l'Accueil, par usage. */
export const MARK = {
  /** « Pas ce mois-ci » sur une échéance récurrente. */
  skippedRecurring: (month: string, recurringId: string) => `skip:${month}:${recurringId}`,
  /**
   * Ancien repère « Taux servi de l'assurance vie vérifié » (plus posé : le « Taux inchangé »
   * est noté sur le compte, `rateReviewedAt`). Gardé pour reprendre et élaguer les anciennes clés.
   */
  avRateChecked: (year: number) => `av-rate:${year}`,
  /** Hausse de salaire déjà proposée pour cette fiche de paie. */
  payRaiseSeen: (payslipId: string) => `pay-raise:${payslipId}`,
};

/** Échéances récurrentes écartées (« Pas ce mois-ci ») pour le mois `month` (AAAA-MM). */
export const skippedRecurringIds = (marks: Marks, month: string): Set<string> => {
  const prefix = MARK.skippedRecurring(month, '');
  return new Set(Object.keys(marks).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)));
};

/** Alertes « Plus tard » dont le report est fini : retirées (elles s'accumulaient sans fin). */
export const pruneSnoozed = (snoozed: Record<string, number>, now: number): Record<string, number> =>
  Object.fromEntries(Object.entries(snoozed).filter(([, until]) => typeof until === 'number' && until > now));

// ---------------------------------------------------------------------------
// Ménage au démarrage
// ---------------------------------------------------------------------------

/**
 * Ménage fait une fois au démarrage : clés d'anciennes versions effacées, clés datées reprises
 * dans `home_marks` (puis effacées), repères et reports expirés retirés. Ne lève jamais.
 */
export const cleanUpStorage = (storage: Storage, today: string, now: number = Date.now()): void => {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k) keys.push(k); }
    const marks: Marks = {};
    for (const k of keys) {
      const skipped = LEGACY_SKIPPED.exec(k);
      const av = LEGACY_AV_RATE.exec(k);
      const raise = LEGACY_PAY_RAISE.exec(k);
      if (skipped) {
        try {
          const ids: unknown = JSON.parse(storage.getItem(k) || '[]');
          if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') marks[MARK.skippedRecurring(skipped[1], id)] = `${skipped[1]}-01`;
        } catch { /* illisible : simplement effacée */ }
      } else if (av) marks[MARK.avRateChecked(Number(av[1]))] = `${av[1]}-01-01`;
      else if (raise) marks[MARK.payRaiseSeen(raise[1])] = today;
      if (skipped || av || raise || OBSOLETE_KEYS.includes(k)) storage.removeItem(k);
    }
    const homeMarks = STORAGE_KEYS.homeMarks.key;
    let current: Marks = {};
    try { const raw: unknown = JSON.parse(storage.getItem(homeMarks) || '{}'); if (isMarks(raw)) current = raw; } catch { /* repris à zéro */ }
    const merged = pruneMarks({ ...marks, ...current }, today);
    if (Object.keys(merged).length > 0) storage.setItem(homeMarks, JSON.stringify(merged));
    else storage.removeItem(homeMarks);

    const snoozeKey = STORAGE_KEYS.todoSnoozed.key;
    const rawSnoozed = storage.getItem(snoozeKey);
    if (rawSnoozed) {
      try {
        const parsed: unknown = JSON.parse(rawSnoozed);
        const kept = parsed && typeof parsed === 'object' ? pruneSnoozed(parsed as Record<string, number>, now) : {};
        if (Object.keys(kept).length > 0) storage.setItem(snoozeKey, JSON.stringify(kept)); else storage.removeItem(snoozeKey);
      } catch { storage.removeItem(snoozeKey); }
    }
  } catch { /* stockage bloqué : rien à faire */ }
};

/**
 * Traces d'usage liées aux données (voir 'trace') : effacées à chaque déconnexion de cet
 * appareil (« Se déconnecter », « Déconnecter tous les appareils », « Code oublié »), après la
 * fermeture de session et l'effacement des copies de données (resetData).
 *
 * Seule exception : les repères permanents (hausse de salaire déjà acceptée ou écartée, voir
 * PERMANENT_MARK_PREFIXES) sont gardés. Ce sont des identifiants de fiche de paie sans montant ;
 * les effacer ferait proposer, et ajouter à l'épargne prévue, la même hausse une seconde fois
 * après la reconnexion. Avant le registre, « Code oublié » les gardait déjà.
 */
export const clearTraces = (): void => {
  const permanent = Object.fromEntries(Object.entries(readMarks()).filter(([id]) => isPermanentMark(id)));
  for (const key of keysOfKind('trace')) lsDel(key);
  try { for (const key of keysOfKind('trace')) sessionStorage.removeItem(key); } catch { /* stockage bloqué */ }
  if (Object.keys(permanent).length > 0) lsSetJSON(STORAGE_KEYS.homeMarks.key, permanent);
};
