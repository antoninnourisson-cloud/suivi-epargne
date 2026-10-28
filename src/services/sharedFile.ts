// ================================================
// FILE: src/services/sharedFile.ts
// Fichier reçu par « Partager vers Pécule » (public/share-sw.js le range dans un cache à
// part, sur l'appareil seulement). Lu une seule fois : il est effacé dès que l'app l'a pris,
// et un fichier reçu il y a plus d'une heure n'est jamais rendu. Chargé avec la fenêtre de
// partage, jamais au démarrage.
// ================================================

/** Cache du fichier partagé : même nom que dans public/share-sw.js et la déconnexion (useAuthSession). */
export const SHARE_CACHE = 'pecule-partage';
const ENTRY = 'partage/fichier';
/** Au-delà, un fichier reçu mais jamais lu est effacé sans être montré. */
export const SHARE_MAX_AGE_MS = 60 * 60 * 1000;

/** Résultat du partage laissé dans l'adresse par le service worker (`?partage=…`). */
export type ShareMarker = 'received' | 'type' | 'size' | 'failed';
export const parseShareMarker = (raw: string | null): ShareMarker | null => {
  if (raw === null) return null;
  if (raw === '1') return 'received';
  if (raw === 'type') return 'type';
  if (raw === 'taille') return 'size';
  return 'failed';
};

const entryUrl = () => new URL(ENTRY, new URL('./', window.location.href)).href;
const hasCaches = () => typeof caches !== 'undefined';

/**
 * Prend le fichier partagé : il est effacé du cache aussitôt lu. `null` s'il n'y en a pas,
 * s'il a plus d'une heure (effacé aussi) ou si le stockage est indisponible.
 */
export const takeSharedFile = async (now = Date.now()): Promise<File | null> => {
  if (!hasCaches()) return null;
  const cache = await caches.open(SHARE_CACHE);
  const url = entryUrl();
  const res = await cache.match(url);
  if (!res) return null;
  try {
    const at = Number(res.headers.get('X-Pecule-Recu'));
    if (!(at > 0) || now - at > SHARE_MAX_AGE_MS) return null;
    const type = res.headers.get('Content-Type') || 'application/octet-stream';
    let name = 'document';
    try { name = decodeURIComponent(res.headers.get('X-Pecule-Nom') || '') || name; } catch { /* nom illisible : nom par défaut */ }
    const blob = await res.blob();
    return new File([blob], name, { type, lastModified: at });
  } finally {
    await cache.delete(url);
  }
};

/** Efface le fichier partagé, lu ou non (annulation, partage refusé). */
export const discardSharedFile = async (): Promise<void> => {
  if (!hasCaches()) return;
  await caches.delete(SHARE_CACHE);
};
