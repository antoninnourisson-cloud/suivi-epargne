// @vitest-environment jsdom
// Fourchette du simulateur calculée dans un Web Worker : même résultat que le calcul direct,
// demandes dépassées abandonnées, et calcul sur place quand le Worker manque ou échoue.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook, act, cleanup } from '@testing-library/react';
import { simulate } from '../lib/simulator';
import { DEFAULT_FISCAL_CONFIG as CFG } from '../constants';
import { AccountType, SavingsAccount } from '../types';
import { useBackgroundSimulation, type BackgroundSimInput } from './useBackgroundSimulation';
import type { SimulatorRequest } from '../workers/simulator.worker';

const accounts: SavingsAccount[] = [
  { id: 'cc', name: 'Compte courant', institution: 'B', type: AccountType.COMPTE_COURANT, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [] },
  { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 8000, ownedAmount: 5000, parentalCapital: 3000, interestRate: 1.7, movements: [] },
  { id: 'av', name: 'AV', institution: 'B', type: AccountType.ASSURANCE_VIE, totalAmount: 2000, ownedAmount: 2000, parentalCapital: 0, interestRate: 2.5, movements: [] },
];
const makeInput = (horizon = 24): BackgroundSimInput => ({
  accounts, fiscal: CFG, monthlyPlan: 500, horizon, today: '2026-10-14', history: [200, 450, 500, 600, 900, -100, 520],
  restitution: { plannedDate: '2027-01-01' }, scenarios: [{ kind: 'purchase', id: 'p', amount: 3000, month: 6 }],
  seed: 2026, runs: 60,
});

/** Worker factice : garde les demandes (copiées comme le ferait le navigateur) et répond à la demande. */
class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  posted: SimulatorRequest[] = [];
  terminated = false;
  constructor(public url: URL | string, public options?: WorkerOptions) {
    super();
    FakeWorker.instances.push(this);
  }
  postMessage(data: SimulatorRequest) { this.posted.push(structuredClone(data)); }
  terminate() { this.terminated = true; }
  respond(i = this.posted.length - 1) {
    const req = this.posted[i];
    this.dispatchEvent(new MessageEvent('message', { data: { id: req.id, result: simulate(req.input) } }));
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe('useBackgroundSimulation', () => {
  it('sans Worker : calcul sur place, identique à simulate', () => {
    vi.stubGlobal('Worker', undefined);
    const input = makeInput();
    const { result } = renderHook(() => useBackgroundSimulation(input));
    expect(result.current.pending).toBe(false);
    expect(result.current.result).toEqual(simulate(input));
    expect(result.current.result?.band).toEqual({ runs: 60, historyMonths: 7 });
  });

  it('avec Worker : module dédié, demande copiable, résultat identique au calcul direct', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const input = makeInput();
    const { result } = renderHook(() => useBackgroundSimulation(input));
    expect(result.current).toEqual({ result: null, pending: true });
    const w = FakeWorker.instances[0];
    expect(String(w.url)).toMatch(/simulator\.worker\.ts/);
    expect(w.options).toEqual({ type: 'module' });
    expect(w.posted).toHaveLength(1);
    act(() => w.respond());
    expect(result.current.pending).toBe(false);
    expect(result.current.result).toEqual(simulate(input));
  });

  it('une demande dépassée est abandonnée : Worker arrêté, seule la dernière réponse compte', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const first = makeInput(24);
    const { result, rerender } = renderHook(({ input }) => useBackgroundSimulation(input), { initialProps: { input: first } });
    const w1 = FakeWorker.instances[0];
    const second = makeInput(60);
    rerender({ input: second });
    expect(w1.terminated).toBe(true);
    const w2 = FakeWorker.instances[1];
    expect(w2.posted).toHaveLength(1);
    // Réponse tardive de l'ancien Worker : ignorée.
    act(() => w1.respond());
    expect(result.current).toEqual({ result: null, pending: true });
    act(() => w2.respond());
    expect(result.current.result?.horizon).toBe(60);
    expect(result.current.pending).toBe(false);
    // Nouvelle demande une fois la précédente servie : le Worker reste en place.
    rerender({ input: makeInput(36) });
    expect(w2.terminated).toBe(false);
    expect(w2.posted).toHaveLength(2);
    // Pendant le calcul, l'ancien résultat reste affiché.
    expect(result.current.result?.horizon).toBe(60);
    expect(result.current.pending).toBe(true);
  });

  it('Worker en échec (script bloqué, hors ligne) : calcul sur place, puis plus de Worker', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const input = makeInput();
    const { result, rerender } = renderHook(({ i }) => useBackgroundSimulation(i), { initialProps: { i: input } });
    const w = FakeWorker.instances[0];
    act(() => { w.dispatchEvent(new Event('error', { cancelable: true })); });
    expect(w.terminated).toBe(true);
    expect(result.current.result).toEqual(simulate(input));
    const next = makeInput(12);
    rerender({ i: next });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(result.current.result).toEqual(simulate(next));
  });

  it('erreur renvoyée par le Worker : calcul sur place', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const input = makeInput();
    const { result } = renderHook(() => useBackgroundSimulation(input));
    const w = FakeWorker.instances[0];
    act(() => { w.dispatchEvent(new MessageEvent('message', { data: { id: w.posted[0].id, error: 'boom' } })); });
    expect(result.current.result).toEqual(simulate(input));
  });

  it('Worker arrêté quand l\'écran se ferme', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const input = makeInput();
    const { unmount } = renderHook(() => useBackgroundSimulation(input));
    const w = FakeWorker.instances[0];
    act(() => w.respond());
    unmount();
    expect(w.terminated).toBe(true);
  });
});

describe('Worker du simulateur', () => {
  it("la CSP d'index.html autorise le Worker (sinon, calcul sur place et écran figé)", () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/worker-src 'self';/);
  });

  it('répond avec simulate(input), ou avec l\'erreur', async () => {
    const posted: unknown[] = [];
    const fakeSelf: { onmessage: ((e: { data: SimulatorRequest }) => void) | null; postMessage: (m: unknown) => void } = {
      onmessage: null, postMessage: m => { posted.push(m); },
    };
    vi.stubGlobal('self', fakeSelf);
    await import('../workers/simulator.worker');
    const input = makeInput();
    fakeSelf.onmessage!({ data: { id: 7, input } });
    expect(posted).toEqual([{ id: 7, result: simulate(input) }]);
    fakeSelf.onmessage!({ data: { id: 8, input: { ...input, accounts: null as never } } });
    expect(posted[1]).toMatchObject({ id: 8, error: expect.any(String) });
  });
});
