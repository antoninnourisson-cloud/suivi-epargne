// @vitest-environment jsdom
// « Code oublié » ne doit jamais déverrouiller : une demande d'abord, utilisable 24 heures plus
// tard et annulée par tout déverrouillage ; puis la session est fermée, le verrou seulement
// suspendu ensuite, et retiré après un chargement Drive réussi.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const session = vi.hoisted(() => ({ open: false }));
vi.mock('../services/googleDriveService', () => ({ hasStoredSession: () => session.open }));

import { useAppLock, LockResetError, shouldCompleteLockReset, useLockResetCompletion } from './useAppLock';
import {
  isLockEnabled, isLockResetPending, setLockDelayMs, getLastLockReset, getLockResetRequest, requestLockReset, LOCK_RESET_DELAY_MS,
} from '../services/appLockService';

const setPin = () => {
  // Un code configuré (la valeur n'importe pas ici : on ne le vérifie pas).
  localStorage.setItem('app_lock_pin_hash', 'x');
  localStorage.setItem('app_lock_pin_salt', 'y');
  localStorage.setItem('app_lock_pin_iterations', '310000');
};

// Demande de retrait faite il y a plus de 24 heures : le retrait est possible.
const readyRequest = () => { requestLockReset(new Date(Date.now() - LOCK_RESET_DELAY_MS - 1000)); };

const hide = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  localStorage.clear();
  session.open = false;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('useAppLock', () => {
  it('sans verrou configuré : jamais verrouillé', () => {
    const { result } = renderHook(() => useAppLock());
    expect(result.current.locked).toBe(false);
    act(() => hide());
    expect(result.current.locked).toBe(false);
  });

  it('verrouillé à l’ouverture, et « Immédiatement » : de nouveau dès le passage en arrière-plan', () => {
    setPin();
    setLockDelayMs(0);
    const { result } = renderHook(() => useAppLock());
    expect(result.current.locked).toBe(true);
    act(() => { result.current.unlock(); });
    expect(result.current.locked).toBe(false);
    act(() => hide());
    expect(result.current.locked).toBe(true);
  });

  it('« Code oublié » : session fermée d’abord, puis verrou suspendu (pas retiré)', async () => {
    setPin();
    setLockDelayMs(0);
    readyRequest();
    const order: string[] = [];
    const { result } = renderHook(() => useAppLock());
    await act(async () => {
      await result.current.forgetCode(async () => { order.push('wipe'); session.open = false; });
    });
    order.push(isLockResetPending() ? 'pending' : 'not-pending');
    expect(order).toEqual(['wipe', 'pending']);
    expect(result.current.locked).toBe(false);
    expect(result.current.resetPending).toBe(true);
    expect(isLockEnabled()).toBe(true); // le code est toujours là
    // Pendant l'attente, l'arrière-plan ne réaffiche pas le verrou (rien n'est chargé).
    act(() => hide());
    expect(result.current.locked).toBe(false);
  });

  it('session encore présente après l’effacement : erreur, verrou maintenu', async () => {
    setPin();
    readyRequest();
    session.open = true;
    const { result } = renderHook(() => useAppLock());
    await act(async () => {
      await expect(result.current.forgetCode(async () => undefined)).rejects.toBeInstanceOf(LockResetError);
    });
    expect(result.current.locked).toBe(true);
    expect(isLockResetPending()).toBe(false);
  });

  it('effacement en échec : erreur, verrou maintenu', async () => {
    setPin();
    readyRequest();
    const { result } = renderHook(() => useAppLock());
    await act(async () => {
      await expect(result.current.forgetCode(async () => { throw new Error('stockage bloqué'); })).rejects.toThrow('stockage bloqué');
    });
    expect(result.current.locked).toBe(true);
    expect(isLockResetPending()).toBe(false);
  });

  it('code retrouvé : le verrou reprend tel quel', async () => {
    setPin();
    readyRequest();
    const { result } = renderHook(() => useAppLock());
    await act(async () => { await result.current.forgetCode(async () => undefined); });
    act(() => result.current.cancelReset());
    expect(result.current.locked).toBe(true);
    expect(result.current.resetPending).toBe(false);
    expect(isLockEnabled()).toBe(true);
  });

  it('chargement Drive réussi après reconnexion : verrou retiré, date notée', async () => {
    setPin();
    const { result } = renderHook(() => useAppLock());
    expect(result.current.completeReset()).toBe(false); // rien en attente
    readyRequest();
    await act(async () => { await result.current.forgetCode(async () => undefined); });
    let done = false;
    act(() => { done = result.current.completeReset(); });
    expect(done).toBe(true);
    expect(result.current.resetPending).toBe(false);
    expect(isLockEnabled()).toBe(false);
    expect(getLastLockReset()).not.toBeNull();
  });
});

describe('useAppLock : demande de retrait (« Code oublié »)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('demande pas encore utilisable : rien n’est effacé, le verrou reste', async () => {
    setPin();
    const wipe = vi.fn(async () => undefined);
    const { result } = renderHook(() => useAppLock());
    expect(result.current.resetRequest).toBeNull();
    act(() => { result.current.requestReset(); });
    expect(result.current.resetRequest?.ready).toBe(false);
    expect(result.current.locked).toBe(true);
    await act(async () => {
      await expect(result.current.forgetCode(wipe)).rejects.toMatchObject({ name: 'LockResetError', reason: 'NOT_READY' });
    });
    expect(wipe).not.toHaveBeenCalled();
    expect(result.current.locked).toBe(true);
    expect(isLockResetPending()).toBe(false);
  });

  it('déverrouillage réussi : la demande est annulée, et renvoyée pour avertir le propriétaire', () => {
    setPin();
    const { result } = renderHook(() => useAppLock());
    let cancelled: ReturnType<typeof result.current.unlock> = null;
    act(() => { result.current.requestReset(); });
    act(() => { cancelled = result.current.unlock(); });
    expect(cancelled).not.toBeNull();
    expect(result.current.locked).toBe(false);
    expect(result.current.resetRequest).toBeNull();
    expect(getLockResetRequest()).toBeNull();
    act(() => hide());
    act(() => { cancelled = result.current.unlock(); });
    expect(cancelled).toBeNull(); // rien en cours : pas d'avertissement
  });

  it('annulation explicite de la demande', () => {
    setPin();
    const { result } = renderHook(() => useAppLock());
    act(() => { result.current.requestReset(); });
    act(() => result.current.cancelResetRequest());
    expect(result.current.resetRequest).toBeNull();
    expect(result.current.locked).toBe(true);
  });

  it('écran resté ouvert : la demande devient utilisable au bout de 24 heures, puis expire', () => {
    vi.useFakeTimers({ now: new Date('2026-10-14T10:00:00Z') });
    setPin();
    const { result } = renderHook(() => useAppLock());
    act(() => { result.current.requestReset(); });
    expect(result.current.resetRequest?.ready).toBe(false);
    act(() => { vi.advanceTimersByTime(LOCK_RESET_DELAY_MS + 2000); });
    expect(result.current.resetRequest?.ready).toBe(true);
    act(() => { vi.advanceTimersByTime(6 * LOCK_RESET_DELAY_MS + 2000); });
    expect(result.current.resetRequest).toBeNull();
  });
});

describe('shouldCompleteLockReset : quand le verrou suspendu peut être retiré', () => {
  const ok = { wasLoading: true, isLoading: false, isAuthenticated: true, loadFailed: false };
  it('seulement à la fin d’un chargement réussi, connecté', () => {
    expect(shouldCompleteLockReset(ok)).toBe(true);
  });
  it.each([
    ['chargement en échec', { ...ok, loadFailed: true }],
    ['déconnecté (chargement abandonné à la déconnexion)', { ...ok, isAuthenticated: false }],
    ['aucun chargement ne vient de se terminer', { ...ok, wasLoading: false }],
    ['chargement encore en cours', { ...ok, isLoading: true }],
  ])('jamais : %s', (_label, state) => {
    expect(shouldCompleteLockReset(state)).toBe(false);
  });
});

describe('useLockResetCompletion : branchement dans App', () => {
  type Props = { isLoading: boolean; isAuthenticated: boolean; loadFailed: boolean };
  const start: Props = { isLoading: false, isAuthenticated: false, loadFailed: false };

  const setup = async () => {
    setPin();
    readyRequest();
    const onCompleted = vi.fn();
    const { result, rerender } = renderHook((p: Props) => {
      const lock = useAppLock();
      useLockResetCompletion(p, lock.completeReset, onCompleted);
      return lock;
    }, { initialProps: start });
    await act(async () => { await result.current.forgetCode(async () => undefined); });
    expect(result.current.resetPending).toBe(true);
    return { result, rerender, onCompleted };
  };

  it('connexion puis chargement Drive réussi : verrou retiré, une seule annonce', async () => {
    const { result, rerender, onCompleted } = await setup();
    rerender({ isLoading: false, isAuthenticated: true, loadFailed: false }); // connecté, pas encore chargé
    expect(result.current.resetPending).toBe(true);
    rerender({ isLoading: true, isAuthenticated: true, loadFailed: false });
    expect(result.current.resetPending).toBe(true);
    rerender({ isLoading: false, isAuthenticated: true, loadFailed: false });
    expect(result.current.resetPending).toBe(false);
    expect(isLockEnabled()).toBe(false);
    expect(onCompleted).toHaveBeenCalledTimes(1);
    rerender({ isLoading: true, isAuthenticated: true, loadFailed: false });
    rerender({ isLoading: false, isAuthenticated: true, loadFailed: false });
    expect(onCompleted).toHaveBeenCalledTimes(1); // plus rien en attente
  });

  it('chargement en échec (échec posé avant la fin) : le verrou reste suspendu', async () => {
    const { result, rerender, onCompleted } = await setup();
    rerender({ isLoading: true, isAuthenticated: true, loadFailed: false });
    rerender({ isLoading: true, isAuthenticated: true, loadFailed: true });
    rerender({ isLoading: false, isAuthenticated: true, loadFailed: true });
    expect(result.current.resetPending).toBe(true);
    expect(isLockEnabled()).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('chargement abandonné par une déconnexion : le verrou reste suspendu', async () => {
    const { result, rerender, onCompleted } = await setup();
    rerender({ isLoading: true, isAuthenticated: true, loadFailed: false });
    rerender({ isLoading: false, isAuthenticated: false, loadFailed: false });
    expect(result.current.resetPending).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('connecté sans chargement terminé : rien ne change', async () => {
    const { result, rerender, onCompleted } = await setup();
    rerender({ isLoading: false, isAuthenticated: true, loadFailed: false });
    rerender({ isLoading: false, isAuthenticated: true, loadFailed: true });
    rerender({ isLoading: false, isAuthenticated: true, loadFailed: false });
    expect(result.current.resetPending).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
