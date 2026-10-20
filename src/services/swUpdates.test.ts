// @vitest-environment jsdom
// Mise à jour de l'app restée ouverte : vérification au retour au premier plan et toutes les
// heures, jamais plus d'une fois par quart d'heure, jamais en arrière-plan ni hors ligne.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchForAppUpdates, UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_MIN_GAP_MS, createSafeReload, isBusyForReload, registerReloadBlocker, RELOAD_RETRY_MS } from './swUpdates';

let visibility: DocumentVisibilityState;
let online: boolean;
const update = vi.fn(async () => undefined);
const sw = { getRegistration: vi.fn(async () => ({ update }) as unknown as ServiceWorkerRegistration) };
const show = async (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  online = true;
  update.mockClear();
  sw.getRegistration.mockClear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as unknown as Record<string, unknown>).visibilityState;
  delete (navigator as unknown as Record<string, unknown>).onLine;
});

describe('watchForAppUpdates', () => {
  it('au retour au premier plan, après le quart d’heure suivant le chargement', async () => {
    const stop = watchForAppUpdates(sw);
    await show('hidden');
    await show('visible');
    expect(update).not.toHaveBeenCalled(); // la page vient d'être chargée : déjà vérifié
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MIN_GAP_MS);
    await show('hidden');
    expect(update).not.toHaveBeenCalled(); // en arrière-plan : rien
    await show('visible');
    expect(update).toHaveBeenCalledTimes(1);
    await show('visible');
    expect(update).toHaveBeenCalledTimes(1); // au plus une fois par quart d'heure
    stop();
  });

  it('toutes les heures si l’app reste ouverte, sauf hors ligne', async () => {
    const stop = watchForAppUpdates(sw);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
    online = false;
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
    stop();
    online = true;
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1); // arrêté
  });

  it('un échec (serveur injoignable, pas de service worker) reste sans effet', async () => {
    update.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    sw.getRegistration.mockResolvedValueOnce(undefined as unknown as ServiceWorkerRegistration);
    const stop = watchForAppUpdates(sw);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('rechargement après une mise à jour', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('tout de suite si rien n’est en cours', () => {
    const reload = vi.fn();
    createSafeReload(reload, () => false)();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('repoussé pendant une saisie, puis fait dès qu’elle est finie (une seule fois)', async () => {
    const reload = vi.fn();
    let busy = true;
    const request = createSafeReload(reload, () => busy);
    request();
    request(); // deuxième prise de main : pas de second minuteur
    await vi.advanceTimersByTimeAsync(RELOAD_RETRY_MS * 3);
    expect(reload).not.toHaveBeenCalled();
    busy = false;
    await vi.advanceTimersByTimeAsync(RELOAD_RETRY_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RELOAD_RETRY_MS * 3);
    await show('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('passage en arrière-plan : rechargé sans attendre le prochain essai, si rien n’est en cours', async () => {
    const reload = vi.fn();
    let busy = true;
    createSafeReload(reload, () => busy)();
    busy = false;
    await show('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('en cours : fenêtre ouverte, champ en saisie, ou saisies pas encore sur Drive', () => {
    expect(isBusyForReload()).toBe(false);
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(isBusyForReload()).toBe(true);
    document.body.innerHTML = '<input id="montant" />';
    (document.getElementById('montant') as HTMLInputElement).focus();
    expect(isBusyForReload()).toBe(true);
    document.body.innerHTML = '<button id="b">ok</button>';
    (document.getElementById('b') as HTMLButtonElement).focus();
    expect(isBusyForReload()).toBe(false);
    let unsent = true;
    const unregister = registerReloadBlocker(() => unsent);
    expect(isBusyForReload()).toBe(true);
    unsent = false;
    expect(isBusyForReload()).toBe(false);
    unsent = true;
    unregister();
    expect(isBusyForReload()).toBe(false);
  });
});
