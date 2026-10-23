// @vitest-environment jsdom
// Verrou de l'appareil : code PIN (PBKDF2, ancien format migré), délai croissant après des
// échecs, biométrie (WebAuthn simulé) et « Code oublié » : demande, délai de 24 heures, puis réinitialisation en deux temps.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enablePin, verifyPin, disablePin, isPinEnabled, isLockEnabled, isBiometricEnabled, getPinCooldownSeconds,
  resetAllLocks, enableLock, verifyBiometric, disableBiometric, isLockActive, isLockResetPending,
  markLockResetPending, cancelLockReset, completeLockReset, getLastLockReset,
  requestLockReset, getLockResetRequest, cancelLockResetRequest, LOCK_RESET_DELAY_MS, markLockResetAlertSent,
} from './appLockService';

const HASH = 'app_lock_pin_hash';
const SALT = 'app_lock_pin_salt';
const ITER = 'app_lock_pin_iterations';
const FAILS = 'app_lock_pin_fails';
const CRED = 'app_lock_credential_id';
const NOW = Date.parse('2026-10-14T10:00:00Z');

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
/** Ancien format (avant PBKDF2) : SHA-256 en une passe de « sel:code ». */
const legacyHash = async (pin: string, salt: string) =>
  b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));

const setFails = (count: number, at = Date.now()) => localStorage.setItem(FAILS, JSON.stringify({ count, at }));

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('code PIN', () => {
  it('refuse un code hors format (6 à 8 chiffres)', async () => {
    for (const bad of ['12345', '123456789', 'abcdef', '12 3456', '']) {
      await expect(enablePin(bad)).rejects.toThrow('PIN_INVALID_FORMAT');
    }
    expect(isPinEnabled()).toBe(false);
  });

  it('ne garde qu’un dérivé PBKDF2 salé (310 000 itérations), jamais le code', async () => {
    await enablePin('246813');
    expect(isPinEnabled()).toBe(true);
    expect(isLockEnabled()).toBe(true);
    expect(localStorage.getItem(ITER)).toBe('310000');
    const stored = Object.values({ ...localStorage }).join('|');
    expect(stored).not.toContain('246813');
    // Deux enregistrements du même code : sels et dérivés différents.
    const first = localStorage.getItem(HASH);
    await enablePin('246813');
    expect(localStorage.getItem(HASH)).not.toBe(first);
  });

  it('vérifie le bon code et refuse un autre', async () => {
    await enablePin('246813');
    expect(await verifyPin('246813')).toBe(true);
    expect(await verifyPin('246814')).toBe(false);
    expect(await verifyPin('')).toBe(false);
  });

  it('sans code configuré, rien ne passe', async () => {
    expect(await verifyPin('246813')).toBe(false);
  });

  it('disablePin retire tout ce qui concerne le code', async () => {
    await enablePin('246813');
    setFails(2);
    disablePin();
    for (const k of [HASH, SALT, ITER, FAILS]) expect(localStorage.getItem(k)).toBeNull();
    expect(isLockEnabled()).toBe(false);
  });
});

describe('ancien format (SHA-256 en une passe)', () => {
  it('reste vérifiable, puis passe à PBKDF2 au premier déverrouillage réussi', async () => {
    localStorage.setItem(SALT, 'c2VsLWFuY2llbg==');
    localStorage.setItem(HASH, await legacyHash('135790', 'c2VsLWFuY2llbg=='));
    expect(await verifyPin('000000')).toBe(false);
    expect(localStorage.getItem(ITER)).toBeNull(); // un échec ne migre rien
    localStorage.removeItem(FAILS);

    expect(await verifyPin('135790')).toBe(true);
    expect(localStorage.getItem(ITER)).toBe('310000');
    expect(localStorage.getItem(HASH)).not.toBe(await legacyHash('135790', 'c2VsLWFuY2llbg=='));
    expect(await verifyPin('135790')).toBe(true);
    expect(await verifyPin('135791')).toBe(false);
  });

  it('un ancien code à 4 chiffres reste vérifiable, à l’ancien format', async () => {
    localStorage.setItem(SALT, 'c2Vs');
    localStorage.setItem(HASH, await legacyHash('1234', 'c2Vs'));
    expect(await verifyPin('1234')).toBe(true);
    expect(localStorage.getItem(ITER)).toBeNull();
    expect(await verifyPin('1234')).toBe(true);
  });
});

describe('délai après des échecs', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });

  it('aucun délai pendant les 3 premiers échecs, puis 2, 4, 8 s… plafonné à 60 s', () => {
    expect(getPinCooldownSeconds()).toBe(0);
    for (const n of [1, 2, 3]) { setFails(n); expect(getPinCooldownSeconds()).toBe(0); }
    setFails(4); expect(getPinCooldownSeconds()).toBe(2);
    setFails(5); expect(getPinCooldownSeconds()).toBe(4);
    setFails(6); expect(getPinCooldownSeconds()).toBe(8);
    setFails(9); expect(getPinCooldownSeconds()).toBe(60);
    setFails(40); expect(getPinCooldownSeconds()).toBe(60);
  });

  it('le délai s’écoule avec le temps, sans jamais bloquer définitivement', () => {
    setFails(9);
    vi.setSystemTime(NOW + 59_000);
    expect(getPinCooldownSeconds()).toBe(1);
    vi.setSystemTime(NOW + 60_000);
    expect(getPinCooldownSeconds()).toBe(0);
  });

  it('un compteur illisible ne bloque pas', () => {
    localStorage.setItem(FAILS, '{pas du json');
    expect(getPinCooldownSeconds()).toBe(0);
  });

  it('compte les échecs, refuse même le bon code pendant le délai, et remet à zéro après un succès', async () => {
    await enablePin('246813');
    expect(await verifyPin('111111')).toBe(false);
    expect(JSON.parse(localStorage.getItem(FAILS)!).count).toBe(1);

    setFails(4, NOW);
    expect(await verifyPin('246813')).toBe(false); // délai en cours
    expect(JSON.parse(localStorage.getItem(FAILS)!).count).toBe(4); // sans compter un échec de plus

    vi.setSystemTime(NOW + 2_000);
    expect(await verifyPin('246813')).toBe(true);
    expect(localStorage.getItem(FAILS)).toBeNull();
    expect(getPinCooldownSeconds()).toBe(0);
  });
});

describe('biométrie (WebAuthn)', () => {
  const credentials = { create: vi.fn(), get: vi.fn() };
  beforeEach(() => {
    credentials.create.mockReset();
    credentials.get.mockReset();
    Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true });
  });

  it('enregistre l’identifiant de la clé, exige la vérification de l’utilisateur', async () => {
    credentials.create.mockResolvedValue({ rawId: new Uint8Array([1, 2, 3]).buffer });
    await enableLock();
    expect(localStorage.getItem(CRED)).toBe('AQID');
    expect(isBiometricEnabled()).toBe(true);
    const opts = credentials.create.mock.calls[0][0].publicKey;
    expect(opts.authenticatorSelection).toMatchObject({ authenticatorAttachment: 'platform', userVerification: 'required' });
  });

  it('activation annulée : erreur, rien n’est enregistré', async () => {
    credentials.create.mockResolvedValue(null);
    await expect(enableLock()).rejects.toThrow('LOCK_SETUP_FAILED');
    expect(isBiometricEnabled()).toBe(false);
  });

  it('vérifie avec la clé enregistrée ; annulation ou échec = refus, sans exception', async () => {
    expect(await verifyBiometric()).toBe(false); // rien de configuré
    expect(credentials.get).not.toHaveBeenCalled();
    localStorage.setItem(CRED, 'AQID');
    credentials.get.mockResolvedValueOnce({ id: 'x' });
    expect(await verifyBiometric()).toBe(true);
    const opts = credentials.get.mock.calls[0][0].publicKey;
    expect(opts.userVerification).toBe('required');
    expect(new Uint8Array(opts.allowCredentials[0].id)).toEqual(new Uint8Array([1, 2, 3]));
    credentials.get.mockRejectedValueOnce(new DOMException('annulé', 'NotAllowedError'));
    expect(await verifyBiometric()).toBe(false);
    credentials.get.mockResolvedValueOnce(null);
    expect(await verifyBiometric()).toBe(false);
    disableBiometric();
    expect(isBiometricEnabled()).toBe(false);
  });
});

describe('« Code oublié » : demande, délai, puis réinitialisation en deux temps', () => {
  // Demande faite il y a plus de 24 heures : le retrait est possible.
  const readyRequest = (now = Date.now()) => requestLockReset(new Date(now - LOCK_RESET_DELAY_MS - 1000));

  beforeEach(async () => {
    localStorage.setItem(CRED, 'AQID');
    await enablePin('246813');
  });

  it('resetAllLocks retire biométrie et code', () => {
    resetAllLocks();
    expect(isLockEnabled()).toBe(false);
    expect(isBiometricEnabled()).toBe(false);
  });

  it('demande : possible 24 heures plus tard, valable 7 jours, sans rien changer au verrou', () => {
    const at = new Date('2026-10-14T10:00:00Z');
    expect(getLockResetRequest(at)).toBeNull();
    const req = requestLockReset(at);
    expect(req.requestedAt.toISOString()).toBe('2026-10-14T10:00:00.000Z');
    expect(req.availableAt.toISOString()).toBe('2026-10-15T10:00:00.000Z');
    expect(req.expiresAt.toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(req.ready).toBe(false);
    expect(isLockActive()).toBe(true);
    expect(getLockResetRequest(new Date('2026-10-15T09:59:59Z'))?.ready).toBe(false);
    expect(getLockResetRequest(new Date('2026-10-15T10:00:00Z'))?.ready).toBe(true);
    expect(getLockResetRequest(new Date('2026-10-21T09:59:59Z'))?.ready).toBe(true);
    expect(getLockResetRequest(new Date('2026-10-21T10:00:00Z'))).toBeNull(); // expirée
    // Horloge reculée depuis la demande : ignorée plutôt que d'attendre sans fin.
    expect(getLockResetRequest(new Date('2026-10-14T09:00:00Z'))).toBeNull();
    // Redemander ne repousse pas le délai.
    expect(requestLockReset(new Date('2026-10-14T20:00:00Z')).availableAt.toISOString()).toBe('2026-10-15T10:00:00.000Z');
    // Une demande expirée est remplacée par une nouvelle.
    expect(requestLockReset(new Date('2026-10-22T10:00:00Z')).availableAt.toISOString()).toBe('2026-10-23T10:00:00.000Z');
  });

  it('annuler la demande (déverrouillage réussi) renvoie celle qui était en cours', () => {
    expect(cancelLockResetRequest()).toBeNull();
    const at = new Date(NOW);
    requestLockReset(at);
    expect(cancelLockResetRequest(at)?.requestedAt.getTime()).toBe(NOW);
    expect(getLockResetRequest(at)).toBeNull();
  });

  it('suspendre est refusé tant que le délai n’est pas écoulé', () => {
    expect(() => markLockResetPending()).toThrow('LOCK_RESET_NOT_READY');
    requestLockReset();
    expect(() => markLockResetPending()).toThrow('LOCK_RESET_NOT_READY');
    expect(isLockResetPending()).toBe(false);
    expect(isLockActive()).toBe(true);
  });

  it('suspendre ne retire rien : le code reste, il redevient actif si on annule', async () => {
    expect(isLockActive()).toBe(true);
    readyRequest();
    markLockResetAlertSent(getLockResetRequest()!);
    markLockResetPending();
    expect(isLockResetPending()).toBe(true);
    expect(getLockResetRequest()).toBeNull(); // demande consommée
    expect(localStorage.getItem('app_lock_reset_alerted')).toBeNull(); // trace de l'alerte avec elle
    expect(isLockActive()).toBe(false);
    expect(isLockEnabled()).toBe(true);
    cancelLockReset();
    expect(isLockActive()).toBe(true);
    expect(await verifyPin('246813')).toBe(true);
  });

  it('terminer (après reconnexion et chargement Drive) retire le verrou et note la date', () => {
    expect(completeLockReset()).toBe(false); // rien en attente : rien ne change
    expect(isLockEnabled()).toBe(true);
    const at = new Date('2026-10-14T09:00:00Z');
    readyRequest(at.getTime());
    markLockResetPending(at);
    expect(completeLockReset(new Date('2026-10-14T09:05:00Z'))).toBe(true);
    expect(isLockEnabled()).toBe(false);
    expect(isLockResetPending()).toBe(false);
    expect(getLastLockReset()).toBe('2026-10-14T09:05:00.000Z');
    expect(completeLockReset()).toBe(false);
  });

  it('un nouveau code pendant la réinitialisation remplace les anciennes méthodes', async () => {
    readyRequest();
    markLockResetPending();
    await enablePin('975310');
    expect(isLockResetPending()).toBe(false);
    expect(isBiometricEnabled()).toBe(false);
    expect(isLockActive()).toBe(true);
    expect(await verifyPin('975310')).toBe(true);
    expect(await verifyPin('246813')).toBe(false);
  });

  it('stockage qui refuse l’écriture : ni demande ni suspension (le verrou reste affiché)', () => {
    readyRequest();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(() => markLockResetPending()).toThrow();
    expect(isLockActive()).toBe(true);
    localStorage.removeItem('app_lock_reset_requested');
    expect(() => requestLockReset()).toThrow();
    expect(getLockResetRequest()).toBeNull();
  });

  it('stockage illisible : lectures sans exception', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(isLockEnabled()).toBe(false);
    expect(isLockResetPending()).toBe(false);
    expect(getLockResetRequest()).toBeNull();
    expect(getPinCooldownSeconds()).toBe(0);
  });
});
