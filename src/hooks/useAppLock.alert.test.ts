// @vitest-environment jsdom
// « Code oublié » : les AUTRES appareils du propriétaire sont prévenus par le serveur, une
// seule fois par demande, et de nouveau essayé au retour du réseau si l'envoi a échoué. Le
// retrait est refusé tant que l'alerte n'est pas partie (appareil gardé hors ligne) ; sans
// session serveur valable, elle est gardée et part avec la session suivante.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => ({ googleSession: false, backendEnabled: true, backendSession: true }));
vi.mock('../services/googleDriveService', () => ({ hasStoredSession: () => state.googleSession }));
const backend = vi.hoisted(() => ({ notify: vi.fn(async (_at: Date): Promise<'sent' | 'failed' | 'no-session'> => 'sent') }));
vi.mock('../services/backendService', () => ({
  notifyLockResetRequested: backend.notify,
  isBackendEnabled: () => state.backendEnabled,
  hasBackendSession: () => state.backendSession,
}));

import { useAppLock, LockResetError, PENDING_ALERT_RETRY_MS } from './useAppLock';
import {
  getLockResetRequest, isLockResetAlertSent, isLockResetPending, getPendingLockResetAlert, requestLockReset, LOCK_RESET_DELAY_MS,
} from '../services/appLockService';

// Demande de retrait faite il y a plus de 24 heures : le retrait est possible.
const readyRequestAt = new Date(Date.now() - LOCK_RESET_DELAY_MS - 60_000);

beforeEach(() => {
  localStorage.clear();
  backend.notify.mockReset();
  backend.notify.mockResolvedValue('sent');
  Object.assign(state, { googleSession: false, backendEnabled: true, backendSession: true });
  localStorage.setItem('app_lock_pin_hash', 'x');
  localStorage.setItem('app_lock_pin_salt', 'y');
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('alerte « retrait du verrou demandé »', () => {
  it('demande : alerte envoyée une fois, avec la date de la demande', async () => {
    const { result, rerender } = renderHook(() => useAppLock());
    expect(backend.notify).not.toHaveBeenCalled();
    let requestedAt: Date | undefined;
    act(() => { requestedAt = result.current.requestReset().requestedAt; });
    await waitFor(() => expect(backend.notify).toHaveBeenCalledTimes(1));
    expect(backend.notify.mock.calls[0][0].toISOString()).toBe(requestedAt!.toISOString());
    await waitFor(() => expect(isLockResetAlertSent(getLockResetRequest()!)).toBe(true));
    rerender();
    act(() => { result.current.requestReset(); }); // redemander ne renvoie rien
    // Écran rouvert plus tard : déjà signalée.
    renderHook(() => useAppLock());
    await new Promise(r => setTimeout(r, 20));
    expect(backend.notify).toHaveBeenCalledTimes(1);
  });

  it('hors ligne : nouvel essai au retour du réseau', async () => {
    backend.notify.mockResolvedValueOnce('failed');
    const { result } = renderHook(() => useAppLock());
    act(() => { result.current.requestReset(); });
    await waitFor(() => expect(backend.notify).toHaveBeenCalledTimes(1));
    expect(isLockResetAlertSent(getLockResetRequest()!)).toBe(false);
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(backend.notify).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(isLockResetAlertSent(getLockResetRequest()!)).toBe(true));
  });

  it('demande annulée (déverrouillage) : plus rien n’est envoyé, et une nouvelle demande est de nouveau signalée', async () => {
    backend.notify.mockResolvedValue('failed');
    const { result } = renderHook(() => useAppLock());
    act(() => { result.current.requestReset(); });
    await waitFor(() => expect(backend.notify).toHaveBeenCalledTimes(1));
    act(() => { result.current.unlock(); });
    act(() => { window.dispatchEvent(new Event('online')); });
    await new Promise(r => setTimeout(r, 20));
    expect(backend.notify).toHaveBeenCalledTimes(1);
  });
});

describe('retrait confirmé : l’alerte ne peut pas être évitée', () => {
  it('appareil gardé hors ligne : retrait refusé, rien n’est effacé, le verrou reste', async () => {
    backend.notify.mockResolvedValue('failed');
    requestLockReset(readyRequestAt);
    const wipe = vi.fn(async () => undefined);
    const { result } = renderHook(() => useAppLock());
    await act(async () => {
      await expect(result.current.forgetCode(wipe)).rejects.toMatchObject({ name: 'LockResetError', reason: 'ALERT_NOT_SENT' });
    });
    expect(wipe).not.toHaveBeenCalled();
    expect(isLockResetPending()).toBe(false);
    expect(result.current.locked).toBe(true);
    expect(getLockResetRequest()).not.toBeNull(); // la demande reste, pour réessayer en ligne
  });

  it('alerte pas encore partie : envoyée AVANT d’effacer quoi que ce soit, puis retrait', async () => {
    backend.notify.mockResolvedValue('failed');
    requestLockReset(readyRequestAt);
    const { result } = renderHook(() => useAppLock());
    await waitFor(() => expect(backend.notify).toHaveBeenCalled()); // premier essai, hors ligne
    const order: string[] = [];
    backend.notify.mockImplementation(async () => { order.push('alerte'); return 'sent'; });
    await act(async () => { await result.current.forgetCode(async () => { order.push('effacement'); }); });
    expect(order).toEqual(['alerte', 'effacement']);
    expect(backend.notify.mock.calls.at(-1)![0].toISOString()).toBe(readyRequestAt.toISOString());
    expect(isLockResetPending()).toBe(true);
    expect(getPendingLockResetAlert()).toBeNull();
  });

  it('alerte déjà partie : pas de nouvel envoi, retrait direct', async () => {
    requestLockReset(readyRequestAt);
    const { result } = renderHook(() => useAppLock());
    await waitFor(() => expect(isLockResetAlertSent(getLockResetRequest()!)).toBe(true));
    await act(async () => { await result.current.forgetCode(async () => undefined); });
    expect(backend.notify).toHaveBeenCalledTimes(1);
    expect(isLockResetPending()).toBe(true);
  });

  it('plus de session serveur valable : retrait possible, alerte gardée puis envoyée avec la session suivante', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    backend.notify.mockResolvedValue('no-session');
    requestLockReset(readyRequestAt);
    const { result, rerender } = renderHook(() => useAppLock());
    await act(async () => {
      await result.current.forgetCode(async () => { state.backendSession = false; });
    });
    expect(isLockResetPending()).toBe(true);
    expect(getPendingLockResetAlert()?.toISOString()).toBe(readyRequestAt.toISOString());
    rerender();
    const callsBefore = backend.notify.mock.calls.length;
    // Pas de session : rien n'est tenté.
    await act(async () => { await vi.advanceTimersByTimeAsync(PENDING_ALERT_RETRY_MS); });
    expect(backend.notify.mock.calls.length).toBe(callsBefore);
    // Reconnexion Google : nouvelle session, l'alerte part avec la date d'origine.
    state.backendSession = true;
    backend.notify.mockResolvedValue('sent');
    await act(async () => { await vi.advanceTimersByTimeAsync(PENDING_ALERT_RETRY_MS); });
    expect(backend.notify.mock.calls.at(-1)![0].toISOString()).toBe(readyRequestAt.toISOString());
    await waitFor(() => expect(getPendingLockResetAlert()).toBeNull());
  });

  it('sans serveur (mode sans serveur) : pas d’alerte possible, le retrait se fait comme avant', async () => {
    state.backendEnabled = false;
    requestLockReset(readyRequestAt);
    const { result } = renderHook(() => useAppLock());
    await act(async () => { await result.current.forgetCode(async () => undefined); });
    expect(isLockResetPending()).toBe(true);
    expect(getPendingLockResetAlert()).toBeNull();
  });

  it('erreur typée pour l’écran de verrouillage', () => {
    expect(new LockResetError('ALERT_NOT_SENT').message).toBe('ALERT_NOT_SENT');
  });
});
