import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createSession, loadSession, touchSession, readSessionIndex, deleteAllSessions,
  SESSION_MAX_AGE, SESSION_IDLE_TTL, DAY, MAX_SESSIONS_PER_USER, sessionTtl,
} from '../src/sessions';
import { MemoryKV } from './kvFake';

const T0 = Date.UTC(2026, 9, 1, 8);
const at = (days: number) => vi.setSystemTime(T0 + days * DAY * 1000);

describe('durée de vie des sessions', () => {
  let kv: MemoryKV;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); at(0); kv = new MemoryKV(); });
  afterEach(() => vi.useRealTimers());

  it("le TTL KV ne dépasse jamais createdAt + 60 jours", () => {
    expect(sessionTtl(T0, T0)).toBe(SESSION_IDLE_TTL);
    expect(sessionTtl(T0, T0 + 50 * DAY * 1000)).toBe(10 * DAY);
    expect(sessionTtl(T0, T0 + SESSION_MAX_AGE * 1000)).toBe(0);
  });

  it('glisse à chaque utilisation, mais expire 60 jours après la connexion quoi qu’il arrive', async () => {
    const { hash } = await createSession(kv.asKV(), 'u1', 'a@b.c');
    for (const day of [20, 40, 55]) {
      at(day);
      const s = await loadSession(kv.asKV(), hash);
      expect(s).not.toBeNull();
      await touchSession(kv.asKV(), hash, s!);
      expect(kv.data.get(`session:${hash}`)!.expiresAt!).toBeLessThanOrEqual(T0 + SESSION_MAX_AGE * 1000);
    }
    at(59.9);
    expect(await loadSession(kv.asKV(), hash)).not.toBeNull();
    at(60);
    expect(await loadSession(kv.asKV(), hash)).toBeNull();
    expect(kv.keysWithPrefix('session:')).toEqual([]);
  });

  it("expire après 30 jours sans utilisation", async () => {
    const { hash } = await createSession(kv.asKV(), 'u1', 'a@b.c');
    at(30);
    expect(await loadSession(kv.asKV(), hash)).toBeNull();
  });

  it("une ancienne session sans createdAt démarre son plafond à sa première utilisation", async () => {
    // Format d'avant : TTL de 180 jours, ni createdAt ni index.
    await kv.put('session:legacy', JSON.stringify({ sub: 'u1', email: 'a@b.c', refreshedAt: T0 - 100 * DAY * 1000 }), { expirationTtl: 180 * DAY });
    at(1);
    const s = await loadSession(kv.asKV(), 'legacy');
    expect(s?.createdAt).toBe(T0 + DAY * 1000);
    expect(await readSessionIndex(kv.asKV(), 'u1')).toEqual(['legacy']);
    expect(kv.data.get('session:legacy')!.expiresAt!).toBeLessThanOrEqual(T0 + DAY * 1000 + SESSION_MAX_AGE * 1000);
    for (const day of [20, 45, 60.5]) {
      at(day);
      const again = await loadSession(kv.asKV(), 'legacy');
      expect(again).not.toBeNull();
      await touchSession(kv.asKV(), 'legacy', again!);
    }
    at(1 + 60);
    expect(await loadSession(kv.asKV(), 'legacy')).toBeNull();
  });

  it("une session déjà datée mais hors index est indexée, sans changer sa date", async () => {
    await kv.put('session:old', JSON.stringify({ sub: 'u1', email: 'a@b.c', createdAt: T0, refreshedAt: T0 }), { expirationTtl: 180 * DAY });
    at(10);
    expect((await loadSession(kv.asKV(), 'old'))?.createdAt).toBe(T0);
    expect(await readSessionIndex(kv.asKV(), 'u1')).toEqual(['old']);
    at(60);
    expect(await loadSession(kv.asKV(), 'old')).toBeNull();
  });
});

describe('index des sessions', () => {
  let kv: MemoryKV;
  beforeEach(() => { kv = new MemoryKV(); });

  it("purge les entrées mortes à la lecture", async () => {
    const a = await createSession(kv.asKV(), 'u1', 'a@b.c');
    const b = await createSession(kv.asKV(), 'u1', 'a@b.c');
    await kv.delete(`session:${a.hash}`);
    expect(await readSessionIndex(kv.asKV(), 'u1')).toEqual([b.hash]);
    expect(await kv.get('sessions:u1', 'json')).toEqual([b.hash]);
  });

  it(`révoque les plus anciennes au-delà de ${MAX_SESSIONS_PER_USER} sessions`, async () => {
    const first = await createSession(kv.asKV(), 'u1', 'a@b.c');
    for (let i = 0; i < MAX_SESSIONS_PER_USER; i++) await createSession(kv.asKV(), 'u1', 'a@b.c');
    expect(await kv.get(`session:${first.hash}`)).toBeNull();
    expect(await readSessionIndex(kv.asKV(), 'u1')).toHaveLength(MAX_SESSIONS_PER_USER);
  });

  it("supprime toutes les sessions d'un utilisateur, et seulement les siennes", async () => {
    await createSession(kv.asKV(), 'u1', 'a@b.c');
    await createSession(kv.asKV(), 'u1', 'a@b.c');
    const other = await createSession(kv.asKV(), 'u2', 'x@y.z');
    expect(await deleteAllSessions(kv.asKV(), 'u1')).toBe(2);
    expect(kv.keysWithPrefix('session:')).toEqual([`session:${other.hash}`]);
    expect(kv.keysWithPrefix('sessions:')).toEqual(['sessions:u2']);
  });
});
