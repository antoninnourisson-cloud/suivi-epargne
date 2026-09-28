// ================================================
// FILE: src/services/pushService.ts
// Abonnement de CET appareil aux notifications push (reçues même app fermée).
// L'abonnement est propre à chaque navigateur/appareil : l'activer sur le téléphone ne
// l'active pas sur l'ordinateur, et inversement.
// ================================================
import {
  isBackendEnabled, getVapidPublicKey, registerPushSubscription, unregisterPushSubscription, sendTestPush,
} from './backendService';

export type PushState =
  | 'unavailable'   // pas de serveur configuré
  | 'unsupported'   // navigateur sans Push API (ou iPhone hors écran d'accueil)
  | 'denied'        // l'utilisateur a bloqué les notifications pour ce site
  | 'enabled'
  | 'disabled';

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const sameBytes = (a: ArrayBuffer | null | undefined, b: Uint8Array): boolean => {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

const isSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Sur iPhone, la Push API n'existe que dans l'app installée sur l'écran d'accueil. */
export const isIosOutsideHomeScreen = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window.navigator as any).standalone;

const getRegistration = async (): Promise<ServiceWorkerRegistration | undefined> => {
  // `serviceWorker.ready` ne se résout JAMAIS sans service worker (ex. `npm run dev`) :
  // on interroge l'enregistrement existant plutôt que de risquer d'attendre indéfiniment.
  return navigator.serviceWorker.getRegistration();
};

export const getPushState = async (): Promise<PushState> => {
  if (!isBackendEnabled()) return 'unavailable';
  if (!isSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await getRegistration();
  if (!reg) return 'unsupported';
  return (await reg.pushManager.getSubscription()) ? 'enabled' : 'disabled';
};

export const enablePush = async (): Promise<void> => {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('PERMISSION_DENIED');
  const reg = await getRegistration();
  if (!reg) throw new Error('NO_SERVICE_WORKER');

  const key = b64urlToBytes(await getVapidPublicKey());
  let subscription = await reg.pushManager.getSubscription();
  // Clé serveur changée depuis (rotation des clés VAPID) : l'ancien abonnement est mort.
  if (subscription && !sameBytes(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  await registerPushSubscription(subscription.toJSON());
};

export const disablePush = async (): Promise<void> => {
  const reg = await getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  // Côté serveur d'abord : même si la désinscription locale échoue, le serveur n'enverra
  // plus rien à cet appareil.
  await unregisterPushSubscription(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
};

export { sendTestPush };
