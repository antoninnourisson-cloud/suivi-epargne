// Signature d'écriture : chaque enregistrement sur Drive porte la date et l'appareil qui l'a
// fait (champ `lastWrite` du fichier). Elle sert seulement à dire, lors d'un conflit entre
// appareils, « enregistrée à 9 h 30 depuis un téléphone Android ».
//
// Ce n'est pas une donnée : migrate() la retire (comme `lastView`), donc elle ne compte
// jamais dans la comparaison « y a-t-il quelque chose à écrire ? », et chaque écriture en
// pose une nouvelle. Une ancienne version de l'app la recopie telle quelle sans la mettre à
// jour : d'où le contrôle de vraisemblance (`stampDevice`) avant de l'afficher.

export interface WriteStamp {
  /** Date de l'écriture (ISO). */
  at: string;
  /** Type d'appareil, en clair (« téléphone Android (Chrome) »). */
  device?: string;
  /** Identifiant aléatoire propre à l'appareil : reconnaît « cet appareil ». */
  deviceId?: string;
}

const WRITE_STAMP_FIELD = 'lastWrite';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Signature lue dans un contenu brut (avant migrate), ou null si absente ou illisible. */
export const readWriteStamp = (raw: unknown): WriteStamp | null => {
  if (!isObj(raw)) return null;
  const s = raw[WRITE_STAMP_FIELD];
  if (!isObj(s) || typeof s.at !== 'string' || Number.isNaN(Date.parse(s.at))) return null;
  return {
    at: s.at,
    device: typeof s.device === 'string' && s.device ? s.device.slice(0, 80) : undefined,
    deviceId: typeof s.deviceId === 'string' && s.deviceId ? s.deviceId.slice(0, 64) : undefined,
  };
};

/** Contenu prêt à partir sur Drive : le même, signé. */
export const withWriteStamp = <T extends object>(data: T, stamp: WriteStamp): T & { lastWrite: WriteStamp } =>
  ({ ...data, [WRITE_STAMP_FIELD]: stamp }) as T & { lastWrite: WriteStamp };

/**
 * Type d'appareil en clair, à partir de l'identification du navigateur. Volontairement
 * grossier (pas de modèle ni de version) : assez pour reconnaître « le téléphone » ou
 * « l'ordinateur du bureau ».
 */
export const describeDevice = (ua: string): string => {
  const u = ua || '';
  let device = 'appareil';
  if (/iPhone/i.test(u)) device = 'iPhone';
  else if (/iPad/i.test(u)) device = 'iPad';
  else if (/Android/i.test(u)) device = /Mobile/i.test(u) ? 'téléphone Android' : 'tablette Android';
  else if (/CrOS/i.test(u)) device = 'Chromebook';
  else if (/Windows/i.test(u)) device = 'ordinateur Windows';
  else if (/Macintosh|Mac OS X/i.test(u)) device = 'Mac';
  else if (/Linux/i.test(u)) device = 'ordinateur Linux';
  let browser = '';
  if (/Edg\//i.test(u)) browser = 'Edge';
  else if (/SamsungBrowser/i.test(u)) browser = 'Samsung Internet';
  else if (/Firefox|FxiOS/i.test(u)) browser = 'Firefox';
  else if (/Chrome|CriOS|Chromium/i.test(u)) browser = 'Chrome';
  else if (/Safari/i.test(u)) browser = 'Safari';
  return browser ? `${device} (${browser})` : device;
};

// Au-delà de cet écart avec la date connue par Drive, la signature est jugée périmée
// (recopiée par une ancienne version de l'app) et l'appareil n'est pas affiché.
const STAMP_TOLERANCE_MS = 10 * 60_000;

/**
 * Appareil à afficher pour une version, ou null si inconnu ou douteux. `referenceISO` :
 * la date d'enregistrement donnée par Drive si on la connaît (sinon, maintenant).
 */
export const stampDevice = (stamp: WriteStamp | null, referenceISO: string | null, nowMs = Date.now()): string | null => {
  if (!stamp?.device) return null;
  const ref = referenceISO && !Number.isNaN(Date.parse(referenceISO)) ? Date.parse(referenceISO) : nowMs;
  return Math.abs(ref - Date.parse(stamp.at)) <= STAMP_TOLERANCE_MS ? stamp.device : null;
};

/** La signature (jugée fiable) vient-elle de cet appareil-ci ? */
export const stampIsFromDevice = (stamp: WriteStamp | null, deviceId: string, referenceISO: string | null, nowMs = Date.now()): boolean =>
  !!stamp?.deviceId && stamp.deviceId === deviceId && stampDevice({ ...stamp, device: stamp.device || '?' }, referenceISO, nowMs) !== null;
