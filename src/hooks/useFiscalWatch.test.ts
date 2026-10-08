// @vitest-environment jsdom
// Choix de la source de la veille fiscale : résultat du serveur (Workers AI) s'il date de
// 8 jours au plus, sinon Gemini avec la clé de l'appareil. Les propositions restent à valider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup, configure } from '@testing-library/react';

// Machine lente (couverture, réveil de veille) : on laisse plus d'une seconde aux attentes.
configure({ asyncUtilTimeout: 5000 });
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountType } from '../types';

const backend = vi.hoisted(() => ({
  enabled: true, session: true,
  latest: null as unknown,
  getServer: vi.fn(), runServer: vi.fn(), getSources: vi.fn(async () => []),
}));
vi.mock('../services/backendService', () => ({
  isBackendEnabled: () => backend.enabled,
  hasBackendSession: () => backend.session,
  getFiscalSources: backend.getSources,
  getServerFiscalWatch: backend.getServer,
  runServerFiscalWatch: backend.runServer,
}));
const gemini = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('../services/geminiService', () => ({ askGeminiWithSearch: gemini.ask }));

import { useFiscalWatch, pickWatchResult, isServerResultFresh, describeServerWatch, StoredWatch } from './useFiscalWatch';
import type { ServerFiscalWatch } from '../services/backendService';

const NOW = new Date('2026-10-14T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const server = (checkedAt: string, values: Record<string, unknown> = { livretACeiling: { value: 23500, source: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2365', quote: 'est de 23 500 €' } }): ServerFiscalWatch => ({
  checkedAt, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', ok: true, values, neuronsEstimate: 2700, neuronsUsed: 1500,
  sources: [{ url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F426', topic: 'Dons', status: 'invalid_json', fields: [], rejected: [] }],
});
const la = { id: 'la', name: 'Livret A', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, interestRate: 1.7, movements: [] } as never;

describe('choix de la source (fonctions pures)', () => {
  it('un résultat du serveur sert 8 jours, et seulement s\'il a réussi', () => {
    expect(isServerResultFresh(server(daysAgo(2)), NOW)).toBe(true);
    expect(isServerResultFresh(server(daysAgo(8)), NOW)).toBe(true);
    expect(isServerResultFresh(server(daysAgo(8.5)), NOW)).toBe(false);
    expect(isServerResultFresh({ ...server(daysAgo(1)), ok: false }, NOW)).toBe(false);
    expect(isServerResultFresh(null, NOW)).toBe(false);
  });
  it('préfère le serveur récent ; Gemini seulement sans lui, ou s\'il est plus récent (vérification manuelle)', () => {
    const g = { result: { lepRate: { value: 2.5 } }, lastSuccessAt: daysAgo(3) };
    expect(pickWatchResult({ server: server(daysAgo(1)), ...g }, NOW).source).toBe('server');
    expect(pickWatchResult({ server: server(daysAgo(10)), ...g }, NOW).source).toBe('gemini');
    expect(pickWatchResult({ server: server(daysAgo(5)), ...g }, NOW).source).toBe('gemini');
    expect(pickWatchResult({ ...g }, NOW)).toMatchObject({ source: 'gemini', checkedAt: g.lastSuccessAt });
    expect(pickWatchResult({} as StoredWatch, NOW)).toEqual({});
    const s = server(daysAgo(1));
    expect(pickWatchResult({ server: s }, NOW)).toEqual({ result: s.values, source: 'server', checkedAt: s.checkedAt });
  });
  it('détail du relevé : chaque valeur comparée à l\'app, et les pages en défaut', () => {
    const r = describeServerWatch(server(daysAgo(1), {
      livretACeiling: { value: 23500, quote: 'q' }, lddsCeiling: { value: 12000 }, socialChargesGeneral: { value: 0.186 },
    }), DEFAULT_FISCAL_CONFIG, [la]);
    expect(r.rows.map(x => [x.key, x.sameAsApp])).toEqual([['livretACeiling', false], ['lddsCeiling', true], ['socialChargesGeneral', true]]);
    expect(r.rows[2].value).toBe('18,6 %');
    expect(r.issues).toEqual(['Dons : réponse illisible']);
    expect(r.neurons).toBe(1500);
  });
});

describe('useFiscalWatch', () => {
  beforeEach(() => {
    localStorage.clear();
    backend.enabled = true; backend.session = true;
    backend.getServer.mockReset(); backend.runServer.mockReset(); gemini.ask.mockReset();
  });
  afterEach(cleanup);

  it('utilise le résultat récent du serveur, sans appeler Gemini, et propose l\'écart', async () => {
    backend.getServer.mockResolvedValue(server(new Date(Date.now() - 86_400_000).toISOString()));
    const { result } = renderHook(() => useFiscalWatch('cle-gemini', DEFAULT_FISCAL_CONFIG, [la], true));
    await waitFor(() => expect(result.current.source).toBe('server'));
    expect(result.current.proposals.map(p => p.key)).toEqual(['ceiling.livretA']);
    expect(result.current.serverReport?.rows).toHaveLength(1);
    expect(backend.runServer).not.toHaveBeenCalled();
    expect(gemini.ask).not.toHaveBeenCalled();
  });

  it('relance le serveur si son résultat manque, sans clé Gemini', async () => {
    backend.getServer.mockResolvedValue(null);
    backend.runServer.mockResolvedValue(server(new Date().toISOString()));
    const { result } = renderHook(() => useFiscalWatch('', DEFAULT_FISCAL_CONFIG, [la], true));
    await waitFor(() => expect(result.current.source).toBe('server'));
    expect(backend.runServer).toHaveBeenCalledTimes(1);
    expect(result.current.canRun).toBe(true);
    expect(result.current.hasKey).toBe(false);
  });

  it("lance quand même le serveur si la clé Gemini arrive juste après l'ouverture (et n'appelle pas Gemini)", async () => {
    let resolveGet: (v: null) => void = () => {};
    backend.getServer.mockReturnValue(new Promise(r => { resolveGet = r; }));
    backend.runServer.mockResolvedValue(server(new Date().toISOString()));
    const { result, rerender } = renderHook(({ key }) => useFiscalWatch(key, DEFAULT_FISCAL_CONFIG, [la], true), { initialProps: { key: '' } });
    rerender({ key: 'cle-gemini' }); // la clé est chargée pendant la lecture du serveur
    resolveGet(null);
    await waitFor(() => expect(result.current.source).toBe('server'));
    expect(backend.getServer).toHaveBeenCalledTimes(1);
    expect(backend.runServer).toHaveBeenCalledTimes(1);
    expect(gemini.ask).not.toHaveBeenCalled();
  });

  it('se rabat sur Gemini quand le serveur n\'a rien de récent', async () => {
    backend.getServer.mockResolvedValue(server(new Date(Date.now() - 20 * 86_400_000).toISOString()));
    backend.runServer.mockResolvedValue(null); // limité ou en échec
    gemini.ask.mockResolvedValue('{"lepRate":{"value":2.5}}');
    const { result } = renderHook(() => useFiscalWatch('cle-gemini', DEFAULT_FISCAL_CONFIG, [la], true));
    await waitFor(() => expect(result.current.source).toBe('gemini'));
    expect(gemini.ask).toHaveBeenCalledTimes(1);
  });

  it('sans serveur : chemin Gemini inchangé', async () => {
    backend.enabled = false;
    gemini.ask.mockResolvedValue('{"livretACeiling":{"value":23500}}');
    const { result } = renderHook(() => useFiscalWatch('cle-gemini', DEFAULT_FISCAL_CONFIG, [la], true));
    await waitFor(() => expect(result.current.source).toBe('gemini'));
    expect(backend.getServer).not.toHaveBeenCalled();
    expect(result.current.proposals.map(p => p.key)).toEqual(['ceiling.livretA']);
    expect(result.current.serverReport).toBeUndefined();
  });

  it('« Vérifier maintenant » passe par Gemini si une clé existe, sinon par le serveur', async () => {
    backend.getServer.mockResolvedValue(server(new Date(Date.now() - 60_000).toISOString()));
    gemini.ask.mockResolvedValue('{"lepRate":{"value":2.5}}');
    const withKey = renderHook(() => useFiscalWatch('cle-gemini', DEFAULT_FISCAL_CONFIG, [la], true));
    await waitFor(() => expect(withKey.result.current.source).toBe('server'));
    await act(() => withKey.result.current.run());
    expect(gemini.ask).toHaveBeenCalledTimes(1);
    expect(withKey.result.current.source).toBe('gemini'); // plus récent que le relevé du serveur
    withKey.unmount();

    localStorage.clear();
    backend.runServer.mockResolvedValue(server(new Date().toISOString()));
    const noKey = renderHook(() => useFiscalWatch('', DEFAULT_FISCAL_CONFIG, [la], true));
    await waitFor(() => expect(noKey.result.current.source).toBe('server'));
    await act(() => noKey.result.current.run());
    expect(backend.runServer).toHaveBeenCalledTimes(1);
  });

  it("n'appelle rien tant que l'app n'est pas prête", async () => {
    renderHook(() => useFiscalWatch('cle-gemini', DEFAULT_FISCAL_CONFIG, [la], false));
    await new Promise(r => setTimeout(r, 20));
    expect(backend.getServer).not.toHaveBeenCalled();
    expect(gemini.ask).not.toHaveBeenCalled();
  });
});

describe('carte de la veille', () => {
  it('affiche la source et le détail du relevé du serveur', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { createElement } = await import('react');
    const { FiscalWatchCard } = await import('../components/FiscalWatchCard');
    const report = describeServerWatch(server(daysAgo(1), { livretACeiling: { value: 22950, quote: 'est de 22 950 €' }, lepCeiling: { value: 12000 } }), DEFAULT_FISCAL_CONFIG, [la]);
    render(createElement(FiscalWatchCard, {
      proposals: [], running: false, checkedAt: daysAgo(1), hasKey: false, canRun: true, source: 'server', serverReport: report,
      onApply: () => {}, onDismiss: () => {}, onRun: () => {},
    }));
    expect(screen.getByText('Source : IA Cloudflare (veille hebdomadaire du serveur)')).toBeTruthy();
    expect(screen.getByText(/Détail du relevé : 2 valeurs, 1 différente de l'app/)).toBeTruthy();
    expect(screen.getByText(/Dons : réponse illisible/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Vérifier maintenant/ })).toBeTruthy();
  });
  it('affiche « Gemini (votre clé) » pour un relevé Gemini', async () => {
    const { render, screen, cleanup } = await import('@testing-library/react');
    cleanup();
    const { createElement } = await import('react');
    const { FiscalWatchCard } = await import('../components/FiscalWatchCard');
    render(createElement(FiscalWatchCard, {
      proposals: [], running: false, checkedAt: daysAgo(1), hasKey: true, source: 'gemini',
      onApply: () => {}, onDismiss: () => {}, onRun: () => {},
    }));
    expect(screen.getByText('Source : Gemini (votre clé)')).toBeTruthy();
    expect(screen.queryByText(/Détail du relevé/)).toBeNull();
  });
});
