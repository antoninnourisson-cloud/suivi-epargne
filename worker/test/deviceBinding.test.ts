// Session liée à l'appareil (deviceProof.ts) : preuve sur un nonce du serveur, sessions
// d'avant la protection refusées, liste des appareils connectés, alerte d'effacement des
// copies aux appareils retirés, alerte « retrait du verrou demandé », compte retiré de la
// liste blanche, lecture des corps en flux.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { Env } from '../src/index';
import { createSession, loadSession } from '../src/sessions';
import { b64urlEncode, encryptString, sha256b64url } from '../src/crypto';
import {
  PROOF_HEADER, NONCE_HEADER, NONCE_PERIOD_S, parseDeviceKey, proofNonces, sanitizeDeviceLabel, signProof, verifyProof,
} from '../src/deviceProof';
import { deviceId } from '../src/subscriptions';
import { readBodyText, BodyTooLargeError } from '../src/security';
import { MemoryKV, makeKeys } from './kvFake';

const APP = 'https://pecule-app.com/';
const ORIGIN = 'https://pecule-app.com';
const W = 'https://api.example.workers.dev';

let kv: MemoryKV;
let env: Env;

const newDeviceKey = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, jwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! } };
};
type DeviceKeyPair = Awaited<ReturnType<typeof newDeviceKey>>;

/** Nonce courant du serveur pour la session de ce jeton (ou à une autre date). */
const nonceFor = async (token: string, nowMs?: number) => (await proofNonces(env.ENCRYPTION_KEY, await sha256b64url(token), nowMs))[0];

const call = async (path: string, init: RequestInit & { token?: string; device?: DeviceKeyPair; nonce?: string; proofPath?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Origin', ORIGIN);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  const method = init.method ?? 'GET';
  if (init.device) {
    const nonce = init.nonce ?? await nonceFor(init.token ?? '');
    headers.set(PROOF_HEADER, await signProof(init.device.pair.privateKey, method, init.proofPath ?? path, nonce));
  }
  return worker.fetch(new Request(`${W}${path}`, { ...init, method, headers }), env);
};
const post = (path: string, body: unknown, opts: { token?: string; device?: DeviceKeyPair } = {}) =>
  call(path, { method: 'POST', body: JSON.stringify(body), ...opts });

/** Code de connexion tel que le dépose /auth/callback, pour une session neuve. */
const loginCode = async (sub = 'u1', email = 'me@example.com') => {
  const { token, hash } = await createSession(kv.asKV(), sub, email);
  const code = b64urlEncode(crypto.getRandomValues(new Uint8Array(24)));
  await kv.put(`code:${await sha256b64url(code)}`, await encryptString(JSON.stringify({ session: token, access_token: 'ya29', expires_in: 3599 }), env.ENCRYPTION_KEY), { expirationTtl: 60 });
  return { code, token, hash };
};

/** Session telle que l'écrivait le serveur AVANT la liaison à l'appareil (sans `gen`). */
const legacySession = async (sub = 'u1', email = 'me@example.com') => {
  const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sha256b64url(token);
  const now = Date.now();
  await kv.put(`session:${hash}`, JSON.stringify({ sub, email, createdAt: now, refreshedAt: now, indexed: true }));
  return { token, hash };
};

/** Appareil connecté avec sa clé (session liée). */
const boundDevice = async (label?: string) => {
  const device = await newDeviceKey();
  const me = await loginCode();
  await post('/auth/exchange', { code: me.code, key: device.jwk, ...(label ? { device: label } : {}) });
  return { device, ...me };
};

const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;

beforeEach(async () => {
  kv = new MemoryKV();
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey) as ArrayBuffer);
  env = {
    STORE: kv.asKV(), GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret',
    ENCRYPTION_KEY: b64urlEncode(crypto.getRandomValues(new Uint8Array(32))),
    VAPID_PUBLIC_KEY: b64urlEncode(pub), VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d!,
    VAPID_SUBJECT: APP, APP_URL: APP, ALLOWED_EMAILS: 'me@example.com',
  };
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('preuve de possession (fonctions pures)', () => {
  it('lit une clé publique P-256 et refuse toute autre forme', async () => {
    const { jwk } = await newDeviceKey();
    expect(parseDeviceKey({ ...jwk, extra: 1 })).toEqual({ x: jwk.x, y: jwk.y });
    for (const bad of [null, 'x', { ...jwk, crv: 'P-384' }, { ...jwk, kty: 'RSA' }, { ...jwk, x: 'court' }, { ...jwk, y: 12 }]) {
      expect(parseDeviceKey(bad)).toBeNull();
    }
  });

  it('nonce : propre à la session et au secret, courant puis précédent, 10 minutes au plus', async () => {
    const secret = env.ENCRYPTION_KEY;
    const now = Date.parse('2026-10-20T10:00:00Z'); // début d'une tranche de 5 minutes
    const [current, previous] = await proofNonces(secret, 'h1', now);
    expect(current).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(previous).not.toBe(current);
    expect((await proofNonces(secret, 'h1', now + (NONCE_PERIOD_S - 1) * 1000))[0]).toBe(current);
    expect((await proofNonces(secret, 'h1', now + NONCE_PERIOD_S * 1000))[1]).toBe(current);
    expect(await proofNonces(secret, 'h1', now + 2 * NONCE_PERIOD_S * 1000)).not.toContain(current);
    expect((await proofNonces(secret, 'h2', now))[0]).not.toBe(current);
    expect((await proofNonces(b64urlEncode(new Uint8Array(32)), 'h1', now))[0]).not.toBe(current);
  });

  it('vérifie la signature, le nonce, la méthode et le chemin', async () => {
    const d = await newDeviceKey();
    const key = parseDeviceKey(d.jwk)!;
    const now = Date.parse('2026-10-20T10:00:00Z');
    const nonces = await proofNonces(env.ENCRYPTION_KEY, 'h1', now);
    const proof = await signProof(d.pair.privateKey, 'POST', '/token', nonces[0]);
    expect(await verifyProof(key, proof, 'POST', '/token', nonces)).toBe('ok');
    expect(await verifyProof(key, await signProof(d.pair.privateKey, 'POST', '/token', nonces[1]), 'POST', '/token', nonces)).toBe('ok');
    expect(await verifyProof(key, proof, 'GET', '/token', nonces)).toBe('invalid');
    expect(await verifyProof(key, proof, 'POST', '/backup', nonces)).toBe('invalid');
    // Dix minutes plus tard, la preuve ne vaut plus rien.
    expect(await verifyProof(key, proof, 'POST', '/token', await proofNonces(env.ENCRYPTION_KEY, 'h1', now + 600_000))).toBe('stale');
    // Une preuve préparée d'avance sur un nonce deviné n'est jamais acceptée.
    expect(await verifyProof(key, await signProof(d.pair.privateKey, 'POST', '/token', 'A'.repeat(43)), 'POST', '/token', nonces)).toBe('stale');
    expect(await verifyProof(key, null, 'POST', '/token', nonces)).toBe('missing');
    expect(await verifyProof(key, 'pas-une-preuve', 'POST', '/token', nonces)).toBe('invalid');
    const other = await newDeviceKey();
    expect(await verifyProof(parseDeviceKey(other.jwk)!, proof, 'POST', '/token', nonces)).toBe('invalid');
    // Point hors de la courbe : refusé sans exception.
    expect(await verifyProof({ x: 'A'.repeat(43), y: 'A'.repeat(43) }, proof, 'POST', '/token', nonces)).toBe('invalid');
  });

  it('nettoie le type d’appareil déclaré', () => {
    expect(sanitizeDeviceLabel('  téléphone\nAndroid <b>(Chrome)</b> ')).toBe('téléphone Android b(Chrome)/b');
    expect(sanitizeDeviceLabel('x'.repeat(100))).toHaveLength(60);
    expect(sanitizeDeviceLabel(42)).toBeUndefined();
    expect(sanitizeDeviceLabel('   ')).toBeUndefined();
  });
});

describe('session liée à l’appareil', () => {
  it('connexion avec une clé : session liée, puis preuve sur un nonce récent exigée à chaque requête', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'ya29.new', expires_in: 3599 }), { status: 200 })));
    const device = await newDeviceKey();
    const { code, token, hash } = await loginCode();
    await kv.put('user:u1', JSON.stringify({ email: 'me@example.com', refreshTokenEnc: await encryptString('1//rt', env.ENCRYPTION_KEY), updatedAt: Date.now() }));
    const ex = await post('/auth/exchange', { code, key: device.jwk, device: 'téléphone Android (Chrome)' });
    expect(await ex.json()).toEqual({ session: token, access_token: 'ya29', expires_in: 3599, bound: true });
    expect((await loadSession(kv.asKV(), hash))).toMatchObject({ key: { x: device.jwk.x }, device: 'téléphone Android (Chrome)' });
    const current = await nonceFor(token);
    // Premier nonce rendu dès l'échange : la requête suivante part déjà signée.
    expect(ex.headers.get(NONCE_HEADER)).toBe(current);

    // Le jeton seul (copié ailleurs) ne sert plus à rien ; le refus rend le nonce courant.
    const bare = await call('/token', { method: 'POST', token });
    expect(bare.status).toBe(401);
    expect(await bare.json()).toEqual({ error: 'PROOF_REQUIRED', nonce: current });
    expect(bare.headers.get(NONCE_HEADER)).toBe(current);
    const thief = await newDeviceKey();
    expect(await (await call('/token', { method: 'POST', token, device: thief })).json()).toEqual({ error: 'PROOF_INVALID' });
    // Avec la preuve de l'appareil : accepté, et le nonce courant part avec la réponse.
    const ok = await call('/token', { method: 'POST', token, device });
    expect(ok.status).toBe(200);
    expect(ok.headers.get(NONCE_HEADER)).toBe(current);
    // Nonce périmé (preuve préparée il y a plus de 10 minutes) : refus, avec le nonce courant.
    const late = await call('/token', { method: 'POST', token, device, nonce: await nonceFor(token, Date.now() - 15 * 60_000) });
    expect(late.status).toBe(401);
    expect(await late.json()).toEqual({ error: 'PROOF_NONCE', nonce: current });
    // Nonce d'une autre session : refusé de même.
    const otherSession = await createSession(kv.asKV(), 'u1', 'me@example.com');
    expect((await call('/token', { method: 'POST', token, device, nonce: await nonceFor(otherSession.token) })).status).toBe(401);
    // La preuve d'une autre route ne vaut pas pour celle-ci.
    expect((await call('/backup', { token, device, proofPath: '/token' })).status).toBe(401);
  });

  it('clé mal formée à l’échange : refus, et le code reste utilisable', async () => {
    const { code } = await loginCode();
    const bad = await post('/auth/exchange', { code, key: { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'A'.repeat(43) } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'INVALID_KEY' });
    const ok = await post('/auth/exchange', { code });
    expect(ok.status).toBe(200);
    expect(Object.keys(await ok.json() as object).sort()).toEqual(['access_token', 'expires_in', 'session']);
  });

  it('session récente restée sans clé : liée à la première clé qui prouve sa possession (nonce), refus pour une autre', async () => {
    const { token, hash } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const device = await newDeviceKey();
    const nonce = await nonceFor(token);
    const proof = await signProof(device.pair.privateKey, 'POST', '/auth/bind', nonce);
    // Sans preuve : refus avec le nonce à signer.
    const first = await post('/auth/bind', { key: device.jwk }, { token });
    expect(first.status).toBe(401);
    expect(await first.json()).toEqual({ error: 'PROOF_REQUIRED', nonce });
    // Preuve signée par une autre clé que celle présentée : refus.
    const other = await newDeviceKey();
    expect((await post('/auth/bind', { key: other.jwk, proof }, { token })).status).toBe(400);
    // Nonce périmé : refus avec le nonce courant.
    const staleProof = await signProof(device.pair.privateKey, 'POST', '/auth/bind', await nonceFor(token, Date.now() - 15 * 60_000));
    expect(await (await post('/auth/bind', { key: device.jwk, proof: staleProof }, { token })).json()).toEqual({ error: 'PROOF_NONCE', nonce });
    expect(await (await post('/auth/bind', { key: device.jwk, proof, device: 'ordinateur Windows (Edge)' }, { token })).json()).toEqual({ ok: true, bound: true });
    expect(await loadSession(kv.asKV(), hash)).toMatchObject({ device: 'ordinateur Windows (Edge)' });
    // Même clé : sans effet ; autre clé : 409.
    expect((await post('/auth/bind', { key: device.jwk, proof }, { token })).status).toBe(200);
    const res = await post('/auth/bind', { key: other.jwk, proof: await signProof(other.pair.privateKey, 'POST', '/auth/bind', nonce) }, { token });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'BOUND_ELSEWHERE' });
    expect((await post('/auth/bind', { key: device.jwk, proof })).status).toBe(401);
    expect((await post('/auth/bind', { proof }, { token })).status).toBe(400);
  });

  it('session d’avant la protection, jamais liée : refusée partout, même pour se lier (reconnexion exigée)', async () => {
    const { token } = await legacySession();
    const routes: [string, string][] = [['POST', '/token'], ['GET', '/backup'], ['DELETE', '/backup'], ['POST', '/account/delete'], ['POST', '/push/remove'], ['GET', '/auth/sessions']];
    for (const [method, path] of routes) {
      const res = await call(path, { method, token, ...(method === 'POST' ? { body: '{}' } : {}) });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.json()).toEqual({ error: 'REAUTH_REQUIRED' });
    }
    const device = await newDeviceKey();
    const bind = await post('/auth/bind', { key: device.jwk, proof: await signProof(device.pair.privateKey, 'POST', '/auth/bind', await nonceFor(token)) }, { token });
    expect(bind.status).toBe(401);
    expect(await bind.json()).toEqual({ error: 'REAUTH_REQUIRED' });
    // Une session récente sans clé (navigateur qui ne peut pas en garder) reste acceptée.
    const keyless = await createSession(kv.asKV(), 'u1', 'me@example.com');
    expect((await call('/backup', { token: keyless.token })).status).toBe(200);
  });

  it('session d’avant la protection : la déconnexion la ferme', async () => {
    const { token, hash } = await legacySession();
    expect(await (await post('/auth/logout', {}, { token })).json()).toEqual({ ok: true });
    expect(await kv.get(`session:${hash}`, 'json')).toBeNull();
  });

  it('déconnexion sans preuve (jeton copié) : la session de l’appareil n’est pas fermée', async () => {
    const { device, token, hash } = await boundDevice();
    const bare = await post('/auth/logout', {}, { token });
    expect(bare.status).toBe(401); // l'app, elle, signe sur le nonce rendu et réessaie
    expect(await loadSession(kv.asKV(), hash)).not.toBeNull();
    const thief = await newDeviceKey();
    expect(await (await post('/auth/logout', {}, { token, device: thief })).json()).toEqual({ ok: true });
    expect(await loadSession(kv.asKV(), hash)).not.toBeNull();
    await post('/auth/logout', {}, { token, device });
    expect(await loadSession(kv.asKV(), hash)).toBeNull();
  });

  it('compte retiré de la liste blanche : ses sessions ouvertes sont refusées et effacées', async () => {
    const { token, hash } = await createSession(kv.asKV(), 'u1', 'me@example.com');
    env = { ...env, ALLOWED_EMAILS: 'autre@example.com' };
    expect((await call('/backup', { token })).status).toBe(401);
    expect(kv.keysWithPrefix(`session:${hash}`)).toEqual([]);
  });

  it('autorise l’en-tête de preuve et expose celui du nonce en CORS', async () => {
    const res = await worker.fetch(new Request(`${W}/token`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain(PROOF_HEADER);
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain(NONCE_HEADER);
  });
});

describe('appareils connectés', () => {
  it('liste les sessions (type, dates, appareil courant, anciennes) et en déconnecte une', async () => {
    const { device, ...me } = await boundDevice('téléphone Android (Chrome)');
    const other = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const old = await legacySession();
    await kv.put('sessions:u1', JSON.stringify([me.hash, other.hash, old.hash]));
    await kv.put('push:u1', JSON.stringify([
      { endpoint: endpoint('moi'), keys: await makeKeys(), sessionHash: me.hash },
      { endpoint: endpoint('autre'), keys: await makeKeys(), sessionHash: other.hash },
    ]));
    await createSession(kv.asKV(), 'u2', 'me@example.com'); // un autre compte : jamais listé

    const { sessions } = await (await call('/auth/sessions', { token: me.token, device })).json() as { sessions: any[] };
    expect(sessions).toHaveLength(3);
    const current = sessions.find(s => s.current);
    const unknown = sessions.find(s => !s.current && !s.legacy);
    expect(current).toMatchObject({ device: 'téléphone Android (Chrome)', bound: true, legacy: false });
    expect(unknown).toMatchObject({ device: null, bound: false, legacy: false });
    expect(sessions.filter(s => s.legacy)).toHaveLength(1);
    expect(typeof unknown.createdAt).toBe('string');
    expect(typeof unknown.lastUsedAt).toBe('string');
    expect(unknown.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(JSON.stringify(sessions)).not.toContain(other.hash);

    expect(await (await post('/auth/sessions/revoke', { id: unknown.id }, { token: me.token, device })).json()).toEqual({ ok: true, current: false });
    expect((await call('/backup', { token: other.token })).status).toBe(401);
    expect((await kv.get('push:u1', 'json')).map((x: any) => x.endpoint)).toEqual([endpoint('moi')]);
    // L'appareil déconnecté recevra encore, 30 jours, l'alerte d'effacement des copies.
    expect((await kv.get('push-removed:u1', 'json')).map((x: any) => x.endpoint)).toEqual([endpoint('autre')]);
    expect((await post('/auth/sessions/revoke', { id: unknown.id }, { token: me.token, device })).status).toBe(404);
    expect((await post('/auth/sessions/revoke', {}, { token: me.token, device })).status).toBe(400);
    expect((await call('/auth/sessions', { token: me.token })).status).toBe(401); // preuve exigée
  });
});

describe('effacement des copies de secours : impossible à cacher', () => {
  it('un appareil retiré juste avant reçoit quand même l’alerte ; l’effacement se lit et s’annule', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { sent.push(String(url)); return new Response('', { status: 201 }); }));
    const { device, ...me } = await boundDevice();
    const other = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await kv.put('push:u1', JSON.stringify([
      { endpoint: endpoint('moi'), keys: await makeKeys(), sessionHash: me.hash },
      { endpoint: endpoint('ordinateur'), keys: await makeKeys(), sessionHash: other.hash },
    ]));
    await kv.put('backup:u1:2026-10-01', '{}');

    // Une session volée retire d'abord l'appareil du propriétaire…
    expect(await (await post('/push/remove', { id: await deviceId(endpoint('ordinateur')) }, { token: me.token, device })).json())
      .toEqual({ ok: true, removed: true, devices: 1 });
    // … puis demande l'effacement : l'appareil retiré est prévenu quand même.
    const del = await call('/backup', { method: 'DELETE', token: me.token, device });
    expect(await del.json()).toMatchObject({ ok: true, scheduled: true, copies: 1 });
    expect(sent.sort()).toEqual([endpoint('moi'), endpoint('ordinateur')]);
    // La liste active n'est pas modifiée par l'alerte.
    expect((await kv.get('push:u1', 'json')).map((x: any) => x.endpoint)).toEqual([endpoint('moi')]);

    // L'app lit l'effacement programmé à chaque ouverture, et peut l'annuler.
    const read = await (await call('/backup/deletion', { token: me.token, device })).json() as { deletion: { purgeAt: string; copies: number } };
    expect(read.deletion).toMatchObject({ copies: 1 });
    expect(Date.parse(read.deletion.purgeAt)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(await (await call('/backup/deletion', { method: 'DELETE', token: me.token, device })).json()).toEqual({ ok: true, cancelled: true });
    expect(await (await call('/backup/deletion', { token: me.token, device })).json()).toEqual({ deletion: null });
    expect((await call('/backup/deletion', { token: me.token })).status).toBe(401); // preuve exigée
  });

  it('se désabonner soi-même ne garde rien ; tout déconnecter garde les autres appareils 30 jours', async () => {
    const { device, ...me } = await boundDevice();
    const other = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await kv.put('push:u1', JSON.stringify([
      { endpoint: endpoint('moi'), keys: await makeKeys(), sessionHash: me.hash },
      { endpoint: endpoint('ordinateur'), keys: await makeKeys(), sessionHash: other.hash },
    ]));
    await post('/push/unsubscribe', { endpoint: endpoint('moi') }, { token: me.token, device });
    expect(await kv.get('push-removed:u1', 'json')).toBeNull();
    await post('/auth/logout-all', {}, { token: me.token, device });
    expect((await kv.get('push-removed:u1', 'json')).map((x: any) => x.endpoint)).toEqual([endpoint('ordinateur')]);
  });

  it('supprimer ses données serveur prévient aussi les appareils retirés, puis efface leur trace', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { sent.push(String(url)); return new Response('', { status: String(url).includes('fcm') ? 201 : 200 }); }));
    const { device, ...me } = await boundDevice();
    await kv.put('push-removed:u1', JSON.stringify([{ endpoint: endpoint('tablette'), keys: await makeKeys() }]));
    await kv.put('backup:u1:2026-10-01', '{}');
    expect((await post('/account/delete', {}, { token: me.token, device })).status).toBe(200);
    expect(sent).toContain(endpoint('tablette'));
    expect(await kv.get('push-removed:u1', 'json')).toBeNull();
  });
});

describe('alerte « retrait du verrou demandé »', () => {
  it('prévient les AUTRES appareils, une fois par heure au plus', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { sent.push(String(url)); return new Response('', { status: 201 }); }));
    const device = await newDeviceKey();
    const me = await loginCode();
    await post('/auth/exchange', { code: me.code, key: device.jwk, device: 'téléphone Android (Chrome)' });
    const other = await createSession(kv.asKV(), 'u1', 'me@example.com');
    await kv.put('push:u1', JSON.stringify([
      { endpoint: 'https://fcm.googleapis.com/fcm/send/moi', keys: await makeKeys(), sessionHash: me.hash },
      { endpoint: 'https://fcm.googleapis.com/fcm/send/ordinateur', keys: await makeKeys(), sessionHash: other.hash },
    ]));
    const res = await post('/alert/lock-reset', { requestedAt: new Date().toISOString(), device: 'ignoré' }, { token: me.token, device });
    expect(await res.json()).toEqual({ ok: true, delivered: 1 });
    expect(sent).toEqual(['https://fcm.googleapis.com/fcm/send/ordinateur']);
    expect(await (await post('/alert/lock-reset', {}, { token: me.token, device })).json()).toEqual({ ok: true, delivered: 0, throttled: true });
    expect(sent).toHaveLength(1);
    expect((await post('/alert/lock-reset', {})).status).toBe(401);
  });

  it('un appareil disparu (410) est retiré ; essai et désabonnement exigent aussi la preuve', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response('', { status: String(url).endsWith('/ancien') ? 410 : 201 })));
    const device = await newDeviceKey();
    const me = await loginCode();
    await post('/auth/exchange', { code: me.code, key: device.jwk });
    const other = await createSession(kv.asKV(), 'u1', 'me@example.com');
    const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;
    await kv.put('push:u1', JSON.stringify([
      { endpoint: endpoint('moi'), keys: await makeKeys(), sessionHash: me.hash },
      { endpoint: endpoint('ordinateur'), keys: await makeKeys(), sessionHash: other.hash },
      { endpoint: endpoint('ancien'), keys: await makeKeys(), sessionHash: other.hash },
    ]));
    const endpoints = async () => (await kv.get('push:u1', 'json') as { endpoint: string }[]).map(x => x.endpoint);

    expect(await (await post('/alert/lock-reset', {}, { token: me.token, device })).json()).toEqual({ ok: true, delivered: 1 });
    expect(await endpoints()).toEqual([endpoint('moi'), endpoint('ordinateur')]);

    expect((await post('/push/test', {}, { token: me.token })).status).toBe(401); // sans preuve
    expect(await (await post('/push/test', {}, { token: me.token, device })).json()).toEqual({ ok: true, delivered: 2 });
    expect((await post('/push/unsubscribe', { endpoint: endpoint('ordinateur') }, { token: me.token })).status).toBe(401);
    expect(await (await post('/push/unsubscribe', { endpoint: endpoint('ordinateur') }, { token: me.token, device })).json()).toEqual({ ok: true, devices: 1 });
    expect(await endpoints()).toEqual([endpoint('moi')]);
  });
});

describe('corps de requête lus en flux', () => {
  const streamOf = (chunks: number, size: number) => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= chunks) { controller.close(); return; }
        pulled++;
        controller.enqueue(new Uint8Array(size).fill(0x61));
      },
    });
    return { body, pulled: () => pulled };
  };

  it('abandonne dès que la limite est dépassée, sans tout lire (envoi sans Content-Length)', async () => {
    const s = streamOf(1000, 1024);
    const req = new Request(`${W}/auth/exchange`, { method: 'POST', body: s.body, duplex: 'half' } as RequestInit);
    await expect(readBodyText(req, 4096)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(s.pulled()).toBeLessThan(10);
  });

  it('lit un corps sous la limite, et un corps vide', async () => {
    const s = streamOf(3, 1000);
    expect(await readBodyText(new Request(`${W}/x`, { method: 'POST', body: s.body, duplex: 'half' } as RequestInit), 4096)).toBe('a'.repeat(3000));
    expect(await readBodyText(new Request(`${W}/x`, { method: 'POST' }))).toBe('');
  });

  it('le serveur répond 413 à un envoi anonyme trop gros', async () => {
    const s = streamOf(1000, 1024);
    const res = await worker.fetch(new Request(`${W}/auth/exchange`, { method: 'POST', headers: { Origin: ORIGIN }, body: s.body, duplex: 'half' } as RequestInit), env);
    expect(res.status).toBe(413);
    expect(s.pulled()).toBeLessThan(10);
  });
});
