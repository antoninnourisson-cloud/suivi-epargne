// @vitest-environment jsdom
// Délai avant verrouillage et choix de fichier : le temps passé en arrière-plan est mesuré par
// horodatages (jamais par une minuterie), le verrou ne revient qu'au-delà du délai choisi
// (5 minutes par défaut, « Immédiatement » dès la mise en arrière-plan), et un sélecteur de
// fichiers ouvert par l'app ne verrouille pas, dans la limite de 3 minutes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import fc from 'fast-check';

vi.mock('../services/googleDriveService', () => ({ hasStoredSession: () => false }));

import { useAppLock, shouldLockOnReturn, FILE_PICKER_GRACE_MS, type HiddenStamp } from './useAppLock';
import { getLockDelayMs, setLockDelayMs, DEFAULT_LOCK_DELAY_MS, type LockDelayMs } from '../services/appLockService';

const MIN = 60_000;
let wall = Date.UTC(2026, 9, 29, 12, 0, 0);
let mono = 1_000;

const advance = (ms: number) => { wall += ms; mono += ms; };

const setVisibility = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const hide = () => act(() => setVisibility('hidden'));
const show = () => act(() => setVisibility('visible'));

const setPin = () => {
  localStorage.setItem('app_lock_pin_hash', 'x');
  localStorage.setItem('app_lock_pin_salt', 'y');
  localStorage.setItem('app_lock_pin_iterations', '310000');
};

/** Hook monté, déverrouillé (comme après la saisie du code). */
const unlocked = () => {
  const hook = renderHook(() => useAppLock());
  act(() => { hook.result.current.unlock(); });
  expect(hook.result.current.locked).toBe(false);
  return hook;
};

const fileInput = () => {
  const input = document.createElement('input');
  input.type = 'file';
  document.body.appendChild(input);
  return input;
};

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.spyOn(Date, 'now').mockImplementation(() => wall);
  vi.spyOn(performance, 'now').mockImplementation(() => mono);
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  setPin();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('délai avant verrouillage (réglage de l’appareil)', () => {
  it('5 minutes par défaut ; valeur illisible ou inconnue : le défaut', () => {
    expect(getLockDelayMs()).toBe(DEFAULT_LOCK_DELAY_MS);
    expect(DEFAULT_LOCK_DELAY_MS).toBe(5 * MIN);
    localStorage.setItem('app_lock_delay', '42');
    expect(getLockDelayMs()).toBe(DEFAULT_LOCK_DELAY_MS);
    localStorage.setItem('app_lock_delay', 'abc');
    expect(getLockDelayMs()).toBe(DEFAULT_LOCK_DELAY_MS);
    setLockDelayMs(MIN);
    expect(getLockDelayMs()).toBe(MIN);
  });

  it('aller-retour plus court que le délai : pas de verrou ; plus long : verrou au retour', () => {
    const { result } = unlocked();
    hide();
    expect(result.current.locked).toBe(false);
    advance(4 * MIN);
    show();
    expect(result.current.locked).toBe(false);

    hide();
    advance(5 * MIN);
    show();
    expect(result.current.locked).toBe(true);
    // Verrou revenu après un affichage : posé par-dessus (rien n'est démonté).
    expect(result.current.revealed).toBe(true);
  });

  it('le délai est relu à chaque retour (changement dans Paramètres pris en compte)', () => {
    const { result } = unlocked();
    hide();
    advance(2 * MIN);
    setLockDelayMs(MIN);
    show();
    expect(result.current.locked).toBe(true);
  });

  it('« Immédiatement » : verrou dès la mise en arrière-plan', () => {
    setLockDelayMs(0);
    const { result } = unlocked();
    hide();
    expect(result.current.locked).toBe(true);
  });

  it('horloge du système reculée pendant l’absence : verrou', () => {
    const { result } = unlocked();
    hide();
    wall -= 10 * MIN;
    mono += 1000;
    show();
    expect(result.current.locked).toBe(true);
  });

  it('horloge monotone : compte même si l’horloge du système n’avance pas', () => {
    const { result } = unlocked();
    hide();
    mono += 6 * MIN;
    show();
    expect(result.current.locked).toBe(true);
  });

  it('sans verrou configuré : jamais verrouillé, quel que soit le délai', () => {
    localStorage.clear();
    setLockDelayMs(0);
    const { result } = renderHook(() => useAppLock());
    hide();
    advance(60 * MIN);
    show();
    expect(result.current.locked).toBe(false);
  });

  it('ouverture : verrouillé, et rien n’a encore été affiché', () => {
    const { result } = renderHook(() => useAppLock());
    expect(result.current.locked).toBe(true);
    expect(result.current.revealed).toBe(false);
    act(() => { result.current.unlock(); });
    expect(result.current.revealed).toBe(true);
  });
});

describe('choix de fichier lancé par l’app', () => {
  it('« Immédiatement » : le sélecteur ne verrouille pas, au retour non plus', () => {
    setLockDelayMs(0);
    const { result } = unlocked();
    const input = fileInput();
    act(() => { input.click(); });
    hide();
    expect(result.current.locked).toBe(false);
    advance(2 * MIN);
    show();
    act(() => { input.dispatchEvent(new Event('change')); });
    expect(result.current.locked).toBe(false);
    // Suspension terminée : le passage suivant en arrière-plan verrouille.
    hide();
    expect(result.current.locked).toBe(true);
  });

  it('choix signalé avant le retour : la suspension couvre encore ce retour', () => {
    setLockDelayMs(MIN);
    const { result } = unlocked();
    const input = fileInput();
    act(() => { input.click(); });
    hide();
    advance(2 * MIN);
    act(() => { input.dispatchEvent(new Event('change')); });
    show();
    expect(result.current.locked).toBe(false);
  });

  it('annulation (bureau, page restée visible) : la suspension s’arrête', () => {
    setLockDelayMs(0);
    const { result } = unlocked();
    const input = fileInput();
    act(() => { input.click(); });
    act(() => { input.dispatchEvent(new Event('cancel')); });
    hide();
    expect(result.current.locked).toBe(true);
  });

  it('suspension bornée : au-delà de 3 minutes, la règle normale reprend', () => {
    setLockDelayMs(0);
    const { result } = unlocked();
    const input = fileInput();
    act(() => { input.click(); });
    hide();
    expect(result.current.locked).toBe(false);
    advance(FILE_PICKER_GRACE_MS + 1000);
    show();
    expect(result.current.locked).toBe(true);
  });

  it('un clic ailleurs ne suspend rien', () => {
    setLockDelayMs(0);
    const { result } = unlocked();
    const button = document.createElement('button');
    document.body.appendChild(button);
    act(() => { button.click(); });
    hide();
    expect(result.current.locked).toBe(true);
  });
});

describe('focus', () => {
  it('le champ en cours de saisie retrouve le focus au déverrouillage', () => {
    setLockDelayMs(0);
    const { result } = unlocked();
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    hide();
    expect(result.current.locked).toBe(true);
    field.blur();
    show();
    act(() => { result.current.unlock(); });
    expect(document.activeElement).toBe(field);
  });
});

describe('shouldLockOnReturn', () => {
  const at = (wallMs: number, monoMs = wallMs): HiddenStamp => ({ wall: wallMs, mono: monoMs });

  it('pas de passage en arrière-plan : jamais', () => {
    expect(shouldLockOnReturn({ hidden: null, now: at(10 * MIN), delayMs: 0, suspendedUntil: 0 })).toBe(false);
  });

  it('propriété : sans suspension ni horloge reculée, verrou si et seulement si l’absence atteint le délai', () => {
    const delays: LockDelayMs[] = [0, MIN, 5 * MIN, 15 * MIN];
    fc.assert(fc.property(
      fc.constantFrom(...delays), fc.integer({ min: 0, max: 60 * MIN }), fc.integer({ min: 0, max: 60 * MIN }),
      (delayMs, wallElapsed, monoElapsed) => {
        const lock = shouldLockOnReturn({ hidden: at(1e9, 1e6), now: at(1e9 + wallElapsed, 1e6 + monoElapsed), delayMs, suspendedUntil: 0 });
        return lock === (Math.max(wallElapsed, monoElapsed) >= delayMs);
      },
    ));
  });

  it('propriété : une suspension encore valable au retour empêche toujours le verrou', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 60 * MIN }), fc.integer({ min: 0, max: FILE_PICKER_GRACE_MS }), (elapsed, left) => {
      const now = 1e9 + elapsed;
      return !shouldLockOnReturn({ hidden: at(1e9), now: at(now), delayMs: 0, suspendedUntil: now + left });
    }));
  });
});
