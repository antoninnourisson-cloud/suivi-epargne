// Types, erreurs et petites règles communs au moteur de synchronisation (useDriveSync) et à
// ses aides (copies locales, écran de choix).
import { canonicalize } from '../../lib/schema';
import type { FailureLike } from '../../lib/syncErrors';
import type { GlobalAppData } from '../../types';
import { ConflictError, ApiError, type DriveFileInfo, type FileMeta } from '../../services/googleDriveService';

/** Copie locale de l'état affiché (miroir, quarantaine) : `fileId` = fichier Drive auquel elle se rattache. */
export type StoredSnapshot = { savedAt: string; fileId?: string; data: GlobalAppData };
/** Copie hors ligne : `savedAt` = dernière fois que cet appareil a vu Drive à jour. */
export type OfflineCopy = { savedAt: string; fileId: string; data: unknown };

// Forme canonique par version du document : l'état React n'est jamais modifié en place (chaque
// modification crée un nouvel objet), la chaîne calculée pour un objet reste donc valable.
const canonicalCache = new WeakMap<object, string>();

/**
 * `canonicalize` d'un état du DOCUMENT (état React, jamais modifié en place), calculée une
 * seule fois par version : sans ce cache, la comparaison à Drive serait refaite 3 à 4 fois
 * par saisie (sauvegarde auto, miroir, écriture, fin d'écriture), avec un tri récursif des clés.
 * Égale à `canonicalize(currentData())` : la vue affichée, la signature d'écriture et la clé
 * Gemini ne comptent pas dans la forme canonique.
 */
export const canonicalDoc = (doc: GlobalAppData): string => {
  let c = canonicalCache.get(doc);
  if (c === undefined) { c = canonicalize(doc); canonicalCache.set(doc, c); }
  return c;
};

/** Contenu comparable sans l'écran affiché (changer d'écran hors ligne n'est pas une modification). */
export const canonicalWithoutView = (data: unknown): string =>
  data && typeof data === 'object' ? canonicalize({ ...(data as Record<string, unknown>), lastView: undefined }) : '';

export const localMonthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Nouvelles tentatives après un échec PASSAGER (délai dépassé, Drive saturé…) alors que le
 * navigateur se croit en ligne : il n'émettra jamais l'événement `online`. Un échec durable
 * (droits, espace plein, fichier illisible) n'est jamais retenté seul (voir lib/syncErrors).
 */
export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
export const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
/**
 * Relecture de la révision Drive au retour dans l'app : au plus toutes les 30 s ; et, après
 * 5 min sans contrôle, dès la première touche ou le premier clic (avant la première écriture).
 */
export const REMOTE_CHECK_THROTTLE_MS = 30_000;
export const LONG_PAUSE_MS = 5 * 60_000;

export type SyncFailure = 'conflict' | 'session' | 'offline' | 'notfound' | 'error';
/** Classe une erreur de Drive en une seule catégorie, la même pour tous les chemins. */
export const classifySyncError = (err: unknown): SyncFailure => {
  if (err instanceof ConflictError) return 'conflict';
  if (err instanceof Error && err.message === 'SESSION_EXPIRED') return 'session';
  if (err instanceof ApiError && err.status === 404) return 'notfound';
  // fetch échoue par TypeError quand la requête ne peut pas partir (réseau coupé, DNS,
  // délai) : navigator.onLine n'est pas toujours fiable (portail captif).
  if (err instanceof TypeError) return 'offline';
  return 'error';
};
export const failureOf = (err: unknown): FailureLike => (typeof err === 'object' && err !== null ? err as FailureLike : {});

/** Drive a changé depuis le dernier chargement alors que la révision de référence était inconnue. */
export class RemoteChanged extends Error {
  meta: FileMeta;
  raw: unknown;
  constructor(meta: FileMeta, raw: unknown) { super('REMOTE_CHANGED'); this.name = 'RemoteChanged'; this.meta = meta; this.raw = raw; }
}
/** Écriture abandonnée avant de partir (conflit ouvert, autre fichier) : pas une panne. */
export class SaveSkipped extends Error { constructor() { super('SAVE_SKIPPED'); this.name = 'SaveSkipped'; } }

/** Une des deux versions montrées lors d'un conflit. */
export interface ConflictVersion {
  data: GlobalAppData;
  /** Date d'enregistrement (ISO), si connue. */
  savedAt: string | null;
  /** Appareil, en clair, si connu (« téléphone Android (Chrome) »). */
  device: string | null;
  /** Écrite depuis cet appareil (dans un autre onglet, par exemple). */
  fromThisDevice: boolean;
}

/** Ce que l'écran de choix affiche. */
export interface SyncConflictView {
  /** 'conflict' : modifiées des deux côtés ; 'duplicate' : deux fichiers de données sur Drive. */
  kind: 'conflict' | 'duplicate';
  local: ConflictVersion;
  /** null tant que l'autre version n'a pas été relue (voir `remoteStatus`). */
  remote: ConflictVersion | null;
  remoteStatus: 'loading' | 'ready' | 'error';
  /** L'autre version vient d'une version plus récente de Pécule : elle ne peut pas être écrasée d'ici. */
  remoteFromNewerApp: boolean;
}

/** Résultat d'un import : `undoId`, la version mise de côté juste avant (pour « Annuler »), si elle a pu l'être. */
export interface ImportOutcome { ok: boolean; undoId?: string }

export type ConflictChoice = 'local' | 'remote';
export type ConflictResolution = 'done' | 'copy-failed' | 'unavailable';

/**
 * Conflit en attente du choix de l'utilisateur. `headIs` : ce que porte la tête du fichier
 * Drive (`headRevision`) : notre version ('local', après une course d'écriture) ou l'autre
 * ('remote'). `source` : où relire l'autre version (révision précise, ou tête d'un fichier).
 */
export type ConflictCtx = {
  kind: 'conflict' | 'duplicate';
  fileId: string;
  headRevision: string | null;
  headIs: 'local' | 'remote';
  source: { fileId: string; revisionId?: string };
  remoteRaw: unknown;
  remoteSavedAt: string | null;
  remoteStatus: 'loading' | 'ready' | 'error';
  localSavedAt: string | null;
  /** Version qui n'est pas en tête de Drive, gardée en quarantaine jusqu'au choix (voir openConflict). */
  offDrive?: unknown;
};
export type ConflictInit = Omit<ConflictCtx, 'remoteStatus' | 'localSavedAt' | 'offDrive'> & { localSavedAt?: string | null };

export type SaveResult = 'saved' | 'nothing' | 'failed';
export const duplicateKey = (f: DriveFileInfo) => `${f.id}@${f.modifiedTime ?? ''}`;
