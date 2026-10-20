// « Quoi de neuf » (WhatsNew.tsx) n'est chargé, avec tout l'historique des versions, que s'il
// a quelque chose à montrer ou à noter : la version courante n'a pas encore été vue.
import { lsGet } from '../lib/storage';
import { APP_VERSION } from '../appVersion';

/** Dernière version dont « Quoi de neuf » a été vu sur cet appareil. */
export const SEEN_VERSION_KEY = 'last_seen_version';

export const whatsNewPending = (): boolean => lsGet(SEEN_VERSION_KEY) !== APP_VERSION;
