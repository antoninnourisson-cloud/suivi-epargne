// @vitest-environment jsdom
// Écriture vérifiée (updateConfigFile) contre un faux Drive HTTP : la course « contrôle de
// révision puis écriture » ne doit jamais faire perdre une version en silence.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { updateConfigFile, ConflictError, ConcurrentWriteError, findConfigFiles, getFileMeta, ApiError, driveErrorReason } from './googleDriveService';

interface Rev { id: string; content: unknown; keepForever: boolean }

let revs: Rev[];
let calls: string[];
// Écriture d'un autre appareil, déclenchée juste avant notre PATCH (après notre contrôle).
let beforePatch: (() => void) | null;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const head = () => revs[revs.length - 1];

const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  calls.push(`${method} ${url.replace('https://www.googleapis.com', '')}`);
  if (method === 'GET' && url.includes('fields=headRevisionId')) return json({ headRevisionId: head().id });
  if (method === 'PATCH' && url.includes('/upload/')) {
    beforePatch?.();
    beforePatch = null;
    revs.push({ id: `r${revs.length + 1}`, content: JSON.parse(String(init?.body)), keepForever: false });
    return json({ headRevisionId: head().id });
  }
  const revMatch = url.match(/\/revisions\/([^?]+)/);
  if (revMatch) {
    const rev = revs.find(r => r.id === decodeURIComponent(revMatch[1]));
    if (!rev) return new Response('not found', { status: 404 });
    if (method === 'PATCH') { rev.keepForever = (JSON.parse(String(init?.body)) as { keepForever: boolean }).keepForever; return json({ id: rev.id }); }
    // Comme Drive : un blob ne se télécharge que s'il est marqué « Keep Forever ».
    if (!rev.keepForever) return new Response('forbidden', { status: 403 });
    return json(rev.content);
  }
  if (url.includes('/revisions?')) {
    const base = Date.parse('2026-10-07T10:00:00Z');
    return json({ revisions: revs.map((r, i) => ({ id: r.id, modifiedTime: new Date(base + i * 1000).toISOString() })) });
  }
  throw new Error(`requête inattendue ${method} ${url}`);
};

beforeEach(() => {
  revs = [{ id: 'r1', content: { v: 'initial' }, keepForever: false }];
  calls = [];
  beforePatch = null;
  localStorage.setItem('google_token', JSON.stringify({ access_token: 'test' }));
  localStorage.setItem('token_expiry', String(Date.now() + 3_600_000));
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('updateConfigFile — écriture vérifiée', () => {
  it('sans course : une seule écriture, une seule lecture de plus (historique), aucune erreur', async () => {
    const rev = await updateConfigFile('f', { v: 'mine' }, 'r1');
    expect(rev).toBe('r2');
    expect(calls.filter(c => c.startsWith('PATCH'))).toHaveLength(1);
    expect(calls).toHaveLength(3); // contrôle, PATCH, historique
    expect(head().content).toEqual({ v: 'mine' });
  });

  it('écriture distante AVANT le contrôle : conflit classique, rien écrit', async () => {
    revs.push({ id: 'r2', content: { v: 'theirs' }, keepForever: false });
    await expect(updateConfigFile('f', { v: 'mine' }, 'r1')).rejects.toBeInstanceOf(ConflictError);
    expect(calls.some(c => c.startsWith('PATCH'))).toBe(false);
  });

  it("écriture distante ENTRE le contrôle et le PATCH : détectée, version de l'autre appareil récupérée", async () => {
    beforePatch = () => revs.push({ id: 'r2', content: { v: 'theirs' }, keepForever: false });
    const err = await updateConfigFile('f', { v: 'mine' }, 'r1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConcurrentWriteError);
    expect(err).toBeInstanceOf(ConflictError);
    const cw = err as ConcurrentWriteError;
    expect(cw.ourRevisionId).toBe('r3');
    expect(cw.otherRevisionId).toBe('r2');
    expect(cw.otherContent).toEqual({ v: 'theirs' });
    // Les deux versions restent sur Drive : la nôtre en tête, la sienne protégée de la purge.
    expect(head().content).toEqual({ v: 'mine' });
    expect(revs.find(r => r.id === 'r2')?.keepForever).toBe(true);
    expect(calls.filter(c => c.startsWith('PATCH /upload'))).toHaveLength(1);
  });

  it("version de l'autre appareil illisible : le conflit est quand même levé", async () => {
    beforePatch = () => revs.push({ id: 'r2', content: { v: 'theirs' }, keepForever: false });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('alt=media') ? new Response('boom', { status: 500 }) : fakeFetch(input, init));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = await updateConfigFile('f', { v: 'mine' }, 'r1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConcurrentWriteError);
    expect((err as ConcurrentWriteError).otherRevisionId).toBe('r2');
    expect((err as ConcurrentWriteError).otherContent).toBeUndefined();
  });

  it("historique illisible après une écriture réussie : l'écriture est gardée, pas d'échec", async () => {
    for (const failure of [
      () => new Response('boom', { status: 503 }),
      () => { throw new TypeError('Failed to fetch'); },
    ]) {
      revs = [{ id: 'r1', content: { v: 'initial' }, keepForever: false }];
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        (String(input).includes('/revisions?') ? failure() : fakeFetch(input, init))));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(updateConfigFile('f', { v: 'mine' }, 'r1')).resolves.toBe('r2');
      expect(head().content).toEqual({ v: 'mine' });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    }
  });

  it('écriture sans contrôle (choix explicite) : pas de vérification', async () => {
    await updateConfigFile('f', { v: 'mine' }, null);
    expect(calls).toHaveLength(1);
  });
});

describe('fichiers de données et erreurs Drive', () => {
  it('plusieurs fichiers homonymes : le plus récemment modifié d’abord', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      expect(decodeURIComponent(String(input))).toContain('orderBy=modifiedTime desc');
      return json({ files: [
        { id: 'ancien', name: 'suivi_epargne.json', modifiedTime: '2026-09-01T10:00:00Z' },
        { id: 'recent', name: 'suivi_epargne.json', modifiedTime: '2026-10-14T10:00:00Z' },
        { name: 'sans id' },
      ] });
    }));
    expect((await findConfigFiles()).map(f => f.id)).toEqual(['recent', 'ancien']);
  });

  it('la liste donne aussi la révision de chaque fichier (lue avant le contenu, sans requête de plus)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      expect(decodeURIComponent(String(input))).toContain('fields=files(id,name,createdTime,modifiedTime,headRevisionId)');
      return json({ files: [{ id: 'f', name: 'suivi_epargne.json', modifiedTime: '2026-10-14T10:00:00Z', headRevisionId: 'r7' }] });
    }));
    expect(await findConfigFiles()).toEqual([{ id: 'f', name: 'suivi_epargne.json', modifiedTime: '2026-10-14T10:00:00Z', headRevisionId: 'r7' }]);
  });

  it('aucun fichier : liste vide (premier démarrage), une panne remonte', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ files: [] })));
    expect(await findConfigFiles()).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { errors: [{ reason: 'backendError' }] } }), { status: 503 })));
    await expect(findConfigFiles()).rejects.toMatchObject({ status: 503, reason: 'backendError' });
  });

  it('la raison donnée par Drive accompagne le statut (passager ou durable)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 403, errors: [{ reason: 'storageQuotaExceeded' }] } }), { status: 403 })));
    const err = await updateConfigFile('f', { v: 1 }, null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).reason).toBe('storageQuotaExceeded');
    expect(driveErrorReason('pas du JSON')).toBeUndefined();
  });

  it('révision et date du dernier enregistrement', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ headRevisionId: 'r9', modifiedTime: '2026-10-14T09:30:00.000Z' })));
    expect(await getFileMeta('f')).toEqual({ headRevisionId: 'r9', modifiedTime: '2026-10-14T09:30:00.000Z' });
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    await expect(getFileMeta('f')).rejects.toThrow('REVISION_UNAVAILABLE');
  });
});
