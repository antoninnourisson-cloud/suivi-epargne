// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { resetDiscreetModeForTests, useDiscreetMode } from './useDiscreetMode';
import { DISCREET_AMOUNT, formatEUR } from '../lib/format';
import { STORAGE_KEYS } from '../lib/storageKeys';

const KEY = STORAGE_KEYS.discreetAmounts.key;

beforeEach(() => {
  localStorage.clear();
  resetDiscreetModeForTests();
});

describe('useDiscreetMode', () => {
  it('est coupé par défaut : montants visibles, rien enregistré', () => {
    const { result } = renderHook(() => useDiscreetMode());
    expect(result.current.discreet).toBe(false);
    expect(formatEUR(250)).not.toBe(DISCREET_AMOUNT);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('masque les montants, le garde sur l’appareil, et le retire une fois coupé', () => {
    const { result } = renderHook(() => useDiscreetMode());
    act(() => { result.current.toggleDiscreet(); });
    expect(result.current.discreet).toBe(true);
    expect(formatEUR(250)).toBe(DISCREET_AMOUNT);
    expect(localStorage.getItem(KEY)).toBe('1');
    act(() => { result.current.setDiscreet(false); });
    expect(formatEUR(250)).not.toBe(DISCREET_AMOUNT);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reprend le choix enregistré au démarrage', () => {
    localStorage.setItem(KEY, '1');
    const { result } = renderHook(() => useDiscreetMode());
    expect(result.current.discreet).toBe(true);
    expect(formatEUR(250)).toBe(DISCREET_AMOUNT);
    resetDiscreetModeForTests();
  });
});
