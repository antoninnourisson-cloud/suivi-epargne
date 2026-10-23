// Clés du stockage local utilisées par les données de l'app (document, synchronisation). Les
// noms et leur nature sont dans le registre lib/storageKeys.
import { storageKey } from '../../lib/storageKeys';

/**
 * Miroir local des modifications PAS ENCORE confirmées sur Drive (filet anti-crash). Effacé
 * dès que Drive est à jour : les données ne restent pas dans le navigateur au-delà du
 * nécessaire.
 */
export const BACKUP_KEY = storageKey('backup');
/**
 * Quarantaine : copie de modifications qui n'ont JAMAIS atteint Drive, détectée au
 * démarrage. Distincte du miroir, qui est réécrit en continu : sans cette séparation, la
 * première saisie suivant l'ouverture détruisait la trace des modifications non
 * synchronisées.
 */
export const PENDING_KEY = storageKey('pending');
/**
 * Copies jamais envoyées qui n'ont pas pu être relues faute de stockage protégé (IndexedDB
 * indisponible pour l'instant) : liste de copies chiffrées, gardées telles quelles. Sans cet
 * abri, la première saisie (miroir) ou la quarantaine les écrasait, et elles étaient perdues
 * le jour où le stockage revenait. Relues à chaque chargement (voir localCopies).
 */
export const HELD_KEY = storageKey('held');
/** Annonce des sauvegardes aux autres onglets (l'événement `storage` ne se déclenche que dans les AUTRES onglets). */
export const LAST_SAVE_KEY = storageKey('lastSave');
/** Clé Gemini : propre à l'appareil, jamais dans le fichier Drive ni dans un export. */
export const GEMINI_KEY = storageKey('geminiApiKey');
export const LAST_BACKUP_MONTH_KEY = storageKey('lastDriveBackupMonth');
/** Identifiant aléatoire de cet appareil (signature d'écriture : « cet appareil » ou un autre). */
export const DEVICE_ID_KEY = storageKey('deviceId');
/** Fichiers de données en double déjà signalés et laissés tels quels (id@date de modification). */
export const DUPLICATE_DISMISSED_KEY = storageKey('duplicateDismissed');
/**
 * Dernier état CONFIRMÉ sur Drive (chargé ou écrit), chiffré (voir localVault) : l'app installée
 * s'ouvre hors ligne sur ces données au lieu d'attendre le réseau. Effacé à la déconnexion.
 */
export const OFFLINE_KEY = storageKey('offlineCopy');
/** Dernier écran ouvert (propre à l'appareil, ne déclenche pas d'écriture Drive). */
export const LAST_VIEW_KEY = storageKey('lastView');
