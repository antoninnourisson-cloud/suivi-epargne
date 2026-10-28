// @vitest-environment jsdom
// Déconnexion : la clé Gemini (et le modèle choisi) ne restent pas sur l'appareil, ni les
// traces d'usage liées aux données (registre lib/storageKeys).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAuthSession } from './useAuthSession';
import { getGeminiModelOverride, setGeminiModelOverride } from '../services/geminiModel';
import { MARK, STORAGE_KEYS, keysOfKind, readMarks, setMark } from '../lib/storageKeys';

vi.mock('../services/googleDriveService', () => ({
  initGoogleApi: vi.fn(() => new Promise(() => undefined)),
  handleAuthClick: vi.fn(async () => undefined),
  handleSignOut: vi.fn(async () => undefined),
  resumeSession: vi.fn(() => new Promise(() => undefined)),
  hasStoredSession: () => false,
}));
vi.mock('../services/backendService', () => ({ isBackendEnabled: () => false }));
vi.mock('../services/pushService', () => ({ disablePush: vi.fn(async () => undefined) }));
vi.mock('./screens', () => ({ preloadStartView: vi.fn() }));

const setup = () => {
  const setGeminiApiKey = vi.fn((k: string) => { if (k) localStorage.setItem('gemini_api_key', k); else localStorage.removeItem('gemini_api_key'); });
  const resetData = vi.fn();
  const addToast = vi.fn();
  const hook = renderHook(() => useAuthSession({
    isAuthenticated: true, setIsAuthenticated: vi.fn(),
    data: {
      loadDriveData: vi.fn(async () => true), loadDemoData: vi.fn(), resetData, forgetOfflineCopy: vi.fn(),
      hasUnsyncedChanges: () => false, sessionExpired: false, setGeminiApiKey,
    } as unknown as Parameters<typeof useAuthSession>[0]['data'],
    lock: { locked: false, resetPending: false }, addToast,
    dialog: { open: vi.fn(), confirm: vi.fn() } as unknown as Parameters<typeof useAuthSession>[0]['dialog'],
    openLogoutDialog: vi.fn(),
  }));
  return { ...hook, setGeminiApiKey, resetData, addToast };
};

describe('déconnexion et clé Gemini', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('gemini_api_key', 'ma-cle');
    setGeminiModelOverride('gemini-perso');
  });

  it('« Se déconnecter » efface la clé Gemini et le modèle choisi', async () => {
    const { result, setGeminiApiKey, resetData } = setup();
    await act(async () => { await result.current.logout(); });
    expect(resetData).toHaveBeenCalled();
    expect(setGeminiApiKey).toHaveBeenCalledWith('');
    expect(localStorage.getItem('gemini_api_key')).toBeNull();
    expect(getGeminiModelOverride()).toBe('');
  });

  it('« Déconnecter tous les appareils » aussi', () => {
    const { result, setGeminiApiKey, addToast } = setup();
    act(() => result.current.signedOutEverywhere());
    expect(setGeminiApiKey).toHaveBeenCalledWith('');
    expect(getGeminiModelOverride()).toBe('');
    expect(addToast).toHaveBeenCalled();
  });
});

describe('déconnexion et traces d’usage', () => {
  // Traces d'une session (dernière vue, dernier compte utilisé, fichier Drive, choix de
  // l'Accueil…) : elles ne doivent pas passer au compte qui se connectera ensuite.
  const seedTraces = () => {
    localStorage.clear();
    for (const key of keysOfKind('trace')) localStorage.setItem(key, '"x"');
    sessionStorage.setItem(STORAGE_KEYS.updateDrafts.key, '{}');
    localStorage.removeItem(STORAGE_KEYS.homeMarks.key);
    setMark(MARK.skippedRecurring('2026-10', 'r1'), '2026-10-01');
    setMark(MARK.payRaiseSeen('fiche-1'), '2026-10-01');
    localStorage.setItem(STORAGE_KEYS.themeChoice.key, 'dark');
    localStorage.setItem(STORAGE_KEYS.deviceId.key, 'appareil-1');
  };
  const expectTracesGone = () => {
    for (const key of keysOfKind('trace')) if (key !== STORAGE_KEYS.homeMarks.key) expect(localStorage.getItem(key), key).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.updateDrafts.key)).toBeNull();
    // Seul repère gardé : la hausse de salaire déjà traitée (sinon proposée et ajoutée deux fois).
    expect(readMarks()).toEqual({ [MARK.payRaiseSeen('fiche-1')]: '2026-10-01' });
    // Réglages d'affichage et identifiant de l'appareil : gardés.
    expect(localStorage.getItem(STORAGE_KEYS.themeChoice.key)).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEYS.deviceId.key)).toBe('appareil-1');
  };

  it('« Se déconnecter » les efface, après avoir vidé les données', async () => {
    seedTraces();
    const { result, resetData } = setup();
    await act(async () => { await result.current.logout(); });
    expect(resetData).toHaveBeenCalled();
    expectTracesGone();
  });

  it('« Déconnecter tous les appareils » aussi', () => {
    seedTraces();
    const { result } = setup();
    act(() => result.current.signedOutEverywhere());
    expectTracesGone();
  });
});
