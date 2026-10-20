// Calcul du simulateur « Et si… » dans un Web Worker : les 1 000 tirages de la fourchette
// figeaient l'écran jusqu'à 3 s sur un téléphone moyen. Sans Worker (tests, navigateur
// ancien, script introuvable ou bloqué), le même calcul se fait sur place. Une demande
// dépassée par une plus récente est abandonnée : le Worker est arrêté, puis relancé pour
// la suivante, au lieu de finir un calcul devenu inutile.
import { useEffect, useRef, useState } from 'react';
import { simulate, type SimulatorResult } from '../lib/simulator';
import type { BackgroundSimInput, SimulatorRequest, SimulatorResponse } from '../workers/simulator.worker';

export type { BackgroundSimInput };

const createWorker = (): Worker | null => {
  if (typeof Worker === 'undefined') return null;
  try {
    // Forme reconnue par Vite (fichier du Worker compilé à part, précaché par le service worker).
    return new Worker(new URL('../workers/simulator.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
};

/**
 * Résultat de `simulate(input)`, calculé hors du fil de l'interface. `input` doit être
 * mémoïsé : chaque nouvel objet relance un calcul. `result` reste le dernier calcul terminé
 * (éventuellement d'une demande précédente) ; `pending` dit qu'un calcul plus récent est en cours.
 */
export const useBackgroundSimulation = (input: BackgroundSimInput): { result: SimulatorResult | null; pending: boolean } => {
  const [done, setDone] = useState<{ input: BackgroundSimInput; result: SimulatorResult } | null>(null);
  const worker = useRef<Worker | null>(null);
  /** Le Worker a échoué une fois (script bloqué, hors ligne…) : calcul sur place ensuite. */
  const unavailable = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    let answered = false;
    const finish = (result: SimulatorResult) => {
      answered = true;
      if (id === seq.current) setDone({ input, result });
    };
    const local = () => finish(simulate(input));

    if (!unavailable.current && !worker.current) worker.current = createWorker();
    const w = worker.current;
    if (unavailable.current || !w) {
      unavailable.current = true;
      local();
      return;
    }

    const detach = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      w.removeEventListener('messageerror', onError);
    };
    const fail = () => {
      unavailable.current = true;
      detach();
      w.terminate();
      if (worker.current === w) worker.current = null;
      if (id === seq.current) local();
    };
    function onMessage(e: MessageEvent<SimulatorResponse>) {
      if (e.data?.id !== id) return;
      if ('result' in e.data) finish(e.data.result);
      else fail();
    }
    function onError(e: Event) {
      e.preventDefault();
      fail();
    }
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.addEventListener('messageerror', onError);
    try {
      w.postMessage({ id, input } satisfies SimulatorRequest);
    } catch {
      // Donnée impossible à copier vers le Worker : calcul sur place.
      fail();
    }

    return () => {
      detach();
      // Demande dépassée encore en cours : on arrête ce calcul plutôt que de l'attendre.
      if (!answered && worker.current === w) {
        w.terminate();
        worker.current = null;
      }
    };
  }, [input]);

  useEffect(() => () => {
    worker.current?.terminate();
    worker.current = null;
  }, []);

  return { result: done?.result ?? null, pending: done?.input !== input };
};
