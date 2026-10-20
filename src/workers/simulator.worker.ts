// Web Worker du simulateur « Et si… » : la fourchette (1 000 tirages au sort de vos mois
// passés) se calcule ici, hors du fil de l'interface, pour que la saisie reste fluide.
// Même fonction pure que l'écran (simulate) et même graine : résultat identique au calcul
// direct. Lancé par src/hooks/useBackgroundSimulation.ts ; CSP : worker-src 'self'.
import { simulate, type SimulatorInput, type SimulatorResult } from '../lib/simulator';

/** Ce qui traverse vers le Worker : tout sauf `rng` (une fonction ne se copie pas). */
export type BackgroundSimInput = Omit<SimulatorInput, 'rng'>;
export interface SimulatorRequest { id: number; input: BackgroundSimInput }
export type SimulatorResponse = { id: number; result: SimulatorResult } | { id: number; error: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SimulatorRequest>) => void) | null;
  postMessage: (m: SimulatorResponse) => void;
};

scope.onmessage = e => {
  const { id, input } = e.data;
  try {
    scope.postMessage({ id, result: simulate(input) });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
