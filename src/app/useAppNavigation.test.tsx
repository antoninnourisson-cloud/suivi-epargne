// @vitest-environment jsdom
// Geste Retour entre les écrans : un changement d'écran ajoute une entrée d'historique, Retour
// revient à l'écran précédent ; un onglet touché n'en ajoute pas ; l'adresse ne change pas.
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useViewState, stripParam } from './useAppNavigation';

const settle = () => new Promise<void>(r => setTimeout(r, 30));
afterEach(async () => { cleanup(); await settle(); localStorage.clear(); });

const setup = () => renderHook(() => useViewState('dashboard', () => {}));
const back = () => act(async () => { window.history.back(); await settle(); });

describe('Retour entre les écrans', () => {
  it("changer d'écran puis Retour revient à l'écran précédent", async () => {
    window.history.replaceState(null, '', '/?demo=1');
    const { result } = setup();
    const before = window.history.length;
    act(() => result.current.openScreen('settings'));
    expect(result.current.place.screen).toBe('settings');
    expect(window.history.length).toBe(before + 1);
    expect(window.location.search).toBe('?demo=1');
    act(() => result.current.navigate('subscriptions'));
    expect(result.current.place).toEqual({ screen: 'pilot', tab: 'subscriptions' });
    await back();
    expect(result.current.place.screen).toBe('settings');
    await back();
    expect(result.current.place.screen).toBe('dashboard');
  });

  it("un onglet touché n'ajoute pas d'entrée, et Retour retrouve l'onglet de l'écran", async () => {
    const { result } = setup();
    act(() => result.current.navigate('accounts'));
    const length = window.history.length;
    act(() => result.current.selectTab('movements'));
    expect(window.history.length).toBe(length);
    act(() => result.current.openScreen('settings'));
    await back();
    expect(result.current.place).toEqual({ screen: 'accounts', tab: 'movements' });
  });

  it("même écran, autre onglet par lien : pas d'entrée en plus", () => {
    const { result } = setup();
    act(() => result.current.navigate('pilot'));
    const length = window.history.length;
    act(() => result.current.navigate('payslips'));
    expect(result.current.place).toEqual({ screen: 'pilot', tab: 'payslips' });
    expect(window.history.length).toBe(length);
  });

  it("retirer un paramètre de l'adresse garde la profondeur de navigation", async () => {
    window.history.replaceState(null, '', '/?demo=1&action=quickadd');
    const { result } = setup();
    act(() => result.current.openScreen('settings'));
    stripParam('action');
    expect(window.location.search).toBe('?demo=1');
    await back();
    expect(result.current.place.screen).toBe('dashboard');
  });
});
