// Mode discret : les montants affichés deviennent « •••• € » (transports, écran partagé,
// capture). Réglage de cet appareil seulement, désactivé par défaut, partagé par l'en-tête
// (bouton œil) et Paramètres › Affichage. Le masquage lui-même est dans lib/format ; ici on
// garde l'état, on l'enregistre et on prévient les composants abonnés.
import { useSyncExternalStore } from 'react';
import { lsDel, lsGet, lsSet } from '../lib/storage';
import { storageKey } from '../lib/storageKeys';
import { setDiscreetAmounts } from '../lib/format';

const KEY = storageKey('discreetAmounts');

let state: boolean | null = null;
const listeners = new Set<() => void>();

const apply = (on: boolean) => {
  state = on;
  setDiscreetAmounts(on);
  listeners.forEach(l => l());
};

const init = (): boolean => {
  if (state === null) apply(lsGet(KEY) === '1');
  return state as boolean;
};

const subscribe = (listener: () => void) => {
  init();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Active ou coupe le mode discret, et l'enregistre sur cet appareil (rien si le stockage est bloqué). */
const setDiscreetMode = (on: boolean) => {
  if (on) lsSet(KEY, '1');
  else lsDel(KEY);
  apply(on);
};

/** Pour les tests : oublie l'état et rend les montants visibles. */
export const resetDiscreetModeForTests = () => { state = null; listeners.clear(); setDiscreetAmounts(false); };

export const useDiscreetMode = () => {
  const discreet = useSyncExternalStore(subscribe, init, init);
  return { discreet, setDiscreet: setDiscreetMode, toggleDiscreet: () => setDiscreetMode(!discreet) };
};
