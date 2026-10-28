// @vitest-environment node
// « Partager vers Pécule » : le service worker (public/share-sw.js) reçoit le fichier partagé,
// le range et redirige toujours vers l'app ; la page (services/sharedFile) le prend une seule
// fois, jamais au-delà d'une heure. Cache Storage simulé en mémoire.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHARE_CACHE, SHARE_MAX_AGE_MS, discardSharedFile, parseShareMarker, takeSharedFile } from './sharedFile';

const SCOPE = 'https://app.test/';
const ENTRY = `${SCOPE}partage/fichier`;

const fakeCaches = () => {
  const stores = new Map<string, Map<string, Response>>();
  return {
    stores,
    open: async (name: string) => {
      let s = stores.get(name);
      if (!s) { s = new Map(); stores.set(name, s); }
      const store = s;
      return {
        put: async (url: string, res: Response) => { store.set(String(url), res); },
        match: async (url: string) => store.get(String(url))?.clone(),
        delete: async (url: string) => store.delete(String(url)),
      };
    },
    delete: async (name: string) => stores.delete(name),
  };
};
type FakeCaches = ReturnType<typeof fakeCaches>;

// Le script du service worker, exécuté avec un `self` simulé.
const loadWorker = (caches: FakeCaches) => {
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = { registration: { scope: SCOPE }, caches, addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; } };
  new Function('self', readFileSync(resolve(__dirname, '../../public/share-sw.js'), 'utf8'))(self);
  return (request: Request) => {
    const event = {
      request, response: undefined as Promise<Response> | undefined, wait: undefined as Promise<unknown> | undefined,
      respondWith(p: Promise<Response>) { this.response = p; },
      waitUntil(p: Promise<unknown>) { this.wait = p; },
    };
    listeners.fetch(event);
    return event;
  };
};

const share = (files: File[], url = `${SCOPE}partager`) => {
  const form = new FormData();
  for (const f of files) form.append('fichiers', f);
  return new Request(url, { method: 'POST', body: form });
};
const navigate = () => ({ method: 'GET', url: SCOPE, mode: 'navigate' }) as unknown as Request;

describe('service worker : réception du partage', () => {
  let caches: FakeCaches;
  let dispatch: ReturnType<typeof loadWorker>;
  beforeEach(() => { caches = fakeCaches(); dispatch = loadWorker(caches); });

  it('PDF : rangé avec son nom, son type et l’heure, puis redirection 303 vers l’app', async () => {
    const before = Date.now();
    const e = dispatch(share([new File(['%PDF-1.4 fiche'], 'Bulletin octobre.pdf', { type: 'application/pdf' })]));
    const res = await e.response!;
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`${SCOPE}?partage=1`);
    const stored = caches.stores.get('pecule-partage')!.get(ENTRY)!;
    expect(stored.headers.get('Content-Type')).toBe('application/pdf');
    expect(decodeURIComponent(stored.headers.get('X-Pecule-Nom')!)).toBe('Bulletin octobre.pdf');
    expect(Number(stored.headers.get('X-Pecule-Recu'))).toBeGreaterThanOrEqual(before);
    expect(await stored.clone().text()).toBe('%PDF-1.4 fiche');
  });

  it('garde le premier fichier accepté ; type déduit de l’extension si absent', async () => {
    const e = dispatch(share([new File(['x'], 'notes.txt', { type: 'text/plain' }), new File(['img'], 'capture.JPG'), new File(['2'], 'b.pdf', { type: 'application/pdf' })]));
    expect((await e.response!).headers.get('Location')).toBe(`${SCOPE}?partage=1`);
    const stored = caches.stores.get('pecule-partage')!.get(ENTRY)!;
    expect(stored.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await stored.clone().text()).toBe('img');
  });

  it('refus : autre type, trop lourd, aucun fichier, corps illisible — toujours une redirection', async () => {
    const loc = async (req: Request) => (await dispatch(req).response!).headers.get('Location');
    expect(await loc(share([new File(['x'], 'a.docx', { type: 'application/msword' })]))).toBe(`${SCOPE}?partage=type`);
    expect(await loc(share([new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'gros.pdf', { type: 'application/pdf' })]))).toBe(`${SCOPE}?partage=taille`);
    expect(await loc(share([]))).toBe(`${SCOPE}?partage=erreur`);
    expect(await loc(new Request(`${SCOPE}partager`, { method: 'POST', body: 'pas un formulaire' }))).toBe(`${SCOPE}?partage=erreur`);
    expect(caches.stores.get('pecule-partage')?.get(ENTRY)).toBeUndefined();
  });

  it('cache indisponible : redirection avec le marqueur d’erreur', async () => {
    caches.open = async () => { throw new Error('quota'); };
    const e = dispatch(share([new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })]));
    expect((await e.response!).headers.get('Location')).toBe(`${SCOPE}?partage=erreur`);
  });

  it('autres requêtes : pas de réponse ; ouverture de l’app : ménage des fichiers de plus d’une heure', async () => {
    expect(dispatch(new Request(`${SCOPE}autre`, { method: 'POST', body: 'x' })).response).toBeUndefined();
    expect(dispatch(new Request(`${SCOPE}partager`)).response).toBeUndefined();

    await dispatch(share([new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })])).response;
    let e = dispatch(navigate());
    expect(e.response).toBeUndefined();
    await e.wait;
    expect(caches.stores.get('pecule-partage')!.has(ENTRY)).toBe(true);

    const store = await caches.open('pecule-partage');
    await store.put(ENTRY, new Response('vieux', { headers: { 'X-Pecule-Recu': String(Date.now() - SHARE_MAX_AGE_MS - 1) } }));
    e = dispatch(navigate());
    await e.wait;
    expect(caches.stores.get('pecule-partage')!.has(ENTRY)).toBe(false);
  });
});

describe('page : prise du fichier partagé', () => {
  let caches: FakeCaches;
  const g = globalThis as unknown as { caches?: FakeCaches; window?: unknown };
  beforeEach(() => {
    caches = fakeCaches();
    g.caches = caches;
    g.window = { location: { href: `${SCOPE}?partage=1` } };
  });
  afterEach(() => { delete g.caches; delete g.window; });

  const put = async (body: string, headers: Record<string, string>) => (await caches.open(SHARE_CACHE)).put(ENTRY, new Response(body, { headers }));

  it('rend le fichier (nom, type) et l’efface aussitôt', async () => {
    const now = Date.now();
    await put('%PDF', { 'Content-Type': 'application/pdf', 'X-Pecule-Nom': encodeURIComponent('Fiche été.pdf'), 'X-Pecule-Recu': String(now - 1000) });
    const file = await takeSharedFile(now);
    expect(file?.name).toBe('Fiche été.pdf');
    expect(file?.type).toBe('application/pdf');
    expect(await file?.text()).toBe('%PDF');
    expect(await takeSharedFile(now)).toBeNull();
  });

  it('plus d’une heure, date illisible ou nom illisible', async () => {
    const now = Date.now();
    await put('x', { 'X-Pecule-Recu': String(now - SHARE_MAX_AGE_MS - 1) });
    expect(await takeSharedFile(now)).toBeNull();
    expect(caches.stores.get(SHARE_CACHE)!.has(ENTRY)).toBe(false);
    await put('x', {});
    expect(await takeSharedFile(now)).toBeNull();
    await (await caches.open(SHARE_CACHE)).put(ENTRY, new Response(new Uint8Array([1]), { headers: { 'X-Pecule-Nom': '%E0%A4%A', 'X-Pecule-Recu': String(now) } }));
    const file = await takeSharedFile(now);
    expect(file?.name).toBe('document');
    expect(file?.type).toBe('application/octet-stream');
  });

  it('effacement, et stockage indisponible', async () => {
    await put('x', { 'X-Pecule-Recu': String(Date.now()) });
    await discardSharedFile();
    expect(caches.stores.has(SHARE_CACHE)).toBe(false);
    delete g.caches;
    expect(await takeSharedFile()).toBeNull();
    await expect(discardSharedFile()).resolves.toBeUndefined();
  });

  it('marqueur de l’adresse', () => {
    expect(parseShareMarker(null)).toBeNull();
    expect(parseShareMarker('1')).toBe('received');
    expect(parseShareMarker('type')).toBe('type');
    expect(parseShareMarker('taille')).toBe('size');
    expect(parseShareMarker('erreur')).toBe('failed');
    expect(parseShareMarker('n’importe quoi')).toBe('failed');
  });

  it('même nom de cache pour le service worker, la page et la déconnexion', () => {
    const sw = readFileSync(resolve(__dirname, '../../public/share-sw.js'), 'utf8');
    const auth = readFileSync(resolve(__dirname, '../app/useAuthSession.ts'), 'utf8');
    expect(sw).toContain(`var CACHE = '${SHARE_CACHE}';`);
    expect(auth).toContain(`caches.delete('${SHARE_CACHE}')`);
  });
});
