// @vitest-environment jsdom
// « Aujourd'hui » partagé : change au passage de minuit et au retour au premier plan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { msUntilNextDay, useToday, useTodayDate } from './useToday';

describe('useToday', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('délai jusqu\'au prochain minuit local', () => {
    expect(msUntilNextDay(new Date(2026, 9, 29, 23, 59, 59))).toBe(1500);
    expect(msUntilNextDay(new Date(2026, 9, 29, 0, 0, 0))).toBe(86_400_500);
  });

  it('passe au lendemain à minuit, sans autre événement', () => {
    vi.setSystemTime(new Date(2026, 9, 29, 23, 59, 0));
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-10-29');
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current).toBe('2026-10-29');
    act(() => { vi.advanceTimersByTime(31_000); });
    expect(result.current).toBe('2026-10-30');
    // Le minuteur est relancé pour le jour suivant.
    act(() => { vi.advanceTimersByTime(86_400_000); });
    expect(result.current).toBe('2026-10-31');
  });

  it('relit la date au retour sur l\'app (minuteur endormi pendant la veille)', () => {
    vi.setSystemTime(new Date(2026, 9, 29, 10, 0, 0));
    const { result } = renderHook(() => useToday());
    // Horloge avancée sans que le minuteur ne parte (téléphone en veille).
    vi.setSystemTime(new Date(2026, 10, 2, 8, 0, 0));
    expect(result.current).toBe('2026-10-29');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current).toBe('2026-11-02');
    vi.setSystemTime(new Date(2026, 10, 3, 8, 0, 0));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(result.current).toBe('2026-11-03');
  });

  it('un seul minuteur pour tous les écrans, retiré quand plus personne n\'écoute', () => {
    vi.setSystemTime(new Date(2026, 9, 29, 12, 0, 0));
    const a = renderHook(() => useToday());
    const b = renderHook(() => useTodayDate());
    expect(vi.getTimerCount()).toBe(1);
    expect(b.result.current).toEqual(new Date(2026, 9, 29));
    const first = b.result.current;
    b.rerender();
    expect(b.result.current).toBe(first);
    a.unmount();
    expect(vi.getTimerCount()).toBe(1);
    b.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
