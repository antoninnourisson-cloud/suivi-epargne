// Stockage persistant : détecté avant usage, jamais bloquant, demandé une fois par session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPersistState, requestPersist, requestPersistOnce, resetPersistRequestForTests } from './persistentStorage';

const stubStorage = (persisted: boolean, grant: boolean) => {
  const storage = { persisted: vi.fn(async () => persisted), persist: vi.fn(async () => grant) };
  vi.stubGlobal('navigator', { storage });
  return storage;
};

describe('persistentStorage', () => {
  beforeEach(() => { resetPersistRequestForTests(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('navigateur sans l\'API : « non proposé », sans erreur', async () => {
    vi.stubGlobal('navigator', {});
    expect(await getPersistState()).toBe('unsupported');
    expect(await requestPersist()).toBe('unsupported');
    vi.stubGlobal('navigator', { storage: { persisted: async () => true } });
    expect(await getPersistState()).toBe('unsupported');
  });

  it('lit l\'état sans rien demander', async () => {
    const s = stubStorage(true, false);
    expect(await getPersistState()).toBe('granted');
    expect(s.persist).not.toHaveBeenCalled();
    stubStorage(false, true);
    expect(await getPersistState()).toBe('not-granted');
  });

  it('demande seulement si ce n\'est pas déjà accordé, et rend la réponse', async () => {
    const already = stubStorage(true, false);
    expect(await requestPersist()).toBe('granted');
    expect(already.persist).not.toHaveBeenCalled();
    stubStorage(false, true);
    expect(await requestPersist()).toBe('granted');
    stubStorage(false, false);
    expect(await requestPersist()).toBe('not-granted');
  });

  it('une erreur du navigateur vaut « non protégé », jamais une exception', async () => {
    vi.stubGlobal('navigator', { storage: { persisted: async () => { throw new Error('x'); }, persist: async () => true } });
    expect(await getPersistState()).toBe('not-granted');
    expect(await requestPersist()).toBe('not-granted');
  });

  it('une seule demande par session', async () => {
    const s = stubStorage(false, true);
    requestPersistOnce();
    requestPersistOnce();
    await vi.waitFor(() => expect(s.persist).toHaveBeenCalledTimes(1));
    expect(s.persisted).toHaveBeenCalledTimes(1);
  });
});
