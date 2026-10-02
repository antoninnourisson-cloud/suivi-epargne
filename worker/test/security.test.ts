import { describe, it, expect } from 'vitest';
import {
  safeReturnUrl, isOriginAcceptable, deriveStateKey, newOAuthState, signState, verifyState, readJsonBody,
  BodyTooLargeError, readCookie, STATE_TTL_MS,
} from '../src/security';
import { b64urlEncode, b64urlDecode } from '../src/crypto';
import { verifyIdTokenClaims } from '../src/google';

const env = { APP_URL: 'https://owner.github.io/suivi-epargne/' };
const devEnv = { ...env, EXTRA_ORIGINS: 'http://localhost:5173' };

describe('safeReturnUrl', () => {
  it("accepte l'app, son sous-chemin et sa query, sans fragment", () => {
    expect(safeReturnUrl('https://owner.github.io/suivi-epargne/', env)).toBe('https://owner.github.io/suivi-epargne/');
    expect(safeReturnUrl('https://owner.github.io/suivi-epargne/index.html?x=1#frag', env)).toBe('https://owner.github.io/suivi-epargne/index.html?x=1');
    expect(safeReturnUrl('https://owner.github.io/suivi-epargne', env)).toBe('https://owner.github.io/suivi-epargne');
  });

  it("refuse un autre dépôt de la même origine github.io", () => {
    expect(safeReturnUrl('https://owner.github.io/autre-projet/', env)).toBe(env.APP_URL);
    expect(safeReturnUrl('https://owner.github.io/suivi-epargne-pirate/', env)).toBe(env.APP_URL);
    expect(safeReturnUrl('https://owner.github.io/', env)).toBe(env.APP_URL);
    expect(safeReturnUrl('https://owner.github.io/suivi-epargne/../autre/', env)).toBe(env.APP_URL);
    expect(safeReturnUrl('https://owner.github.io/suivi-epargne/%2e%2e/autre/', env)).toBe(env.APP_URL);
  });

  it('refuse les autres origines, les identifiants et les URL invalides', () => {
    expect(safeReturnUrl('https://evil.example/suivi-epargne/', env)).toBe(env.APP_URL);
    expect(safeReturnUrl('http://owner.github.io/suivi-epargne/', env)).toBe(env.APP_URL);
    expect(safeReturnUrl('https://user:pw@owner.github.io/suivi-epargne/', env)).toBe(env.APP_URL);
    expect(safeReturnUrl('javascript:alert(1)', env)).toBe(env.APP_URL);
    expect(safeReturnUrl('pas une url', env)).toBe(env.APP_URL);
    expect(safeReturnUrl(null, env)).toBe(env.APP_URL);
  });

  it("n'autorise localhost qu'avec EXTRA_ORIGINS (dev)", () => {
    expect(safeReturnUrl('http://localhost:5173/', env)).toBe(env.APP_URL);
    expect(safeReturnUrl('http://localhost:5173/', devEnv)).toBe('http://localhost:5173/');
    expect(isOriginAcceptable('http://localhost:5173', env)).toBe(false);
    expect(isOriginAcceptable('http://localhost:5173', devEnv)).toBe(true);
    expect(isOriginAcceptable('https://owner.github.io', env)).toBe(true);
    expect(isOriginAcceptable(null, env)).toBe(true);
    expect(isOriginAcceptable('https://evil.example', env)).toBe(false);
  });
});

describe('déménagement vers un domaine propre (LEGACY_APP_URL)', () => {
  const moved = { APP_URL: 'https://pecule.example/', LEGACY_APP_URL: 'https://owner.github.io/suivi-epargne/' };

  it("accepte la nouvelle adresse et l'ancienne, avec son chemin", () => {
    expect(safeReturnUrl('https://pecule.example/?x=1', moved)).toBe('https://pecule.example/?x=1');
    expect(safeReturnUrl('https://owner.github.io/suivi-epargne/', moved)).toBe('https://owner.github.io/suivi-epargne/');
    expect(isOriginAcceptable('https://pecule.example', moved)).toBe(true);
    expect(isOriginAcceptable('https://owner.github.io', moved)).toBe(true);
  });

  it("garde le contrôle du chemin sur l'ancienne origine partagée", () => {
    expect(safeReturnUrl('https://owner.github.io/autre-projet/', moved)).toBe(moved.APP_URL);
  });

  it("refuse l'ancienne adresse une fois LEGACY_APP_URL retiré", () => {
    const after = { APP_URL: moved.APP_URL };
    expect(isOriginAcceptable('https://owner.github.io', after)).toBe(false);
    expect(safeReturnUrl('https://owner.github.io/suivi-epargne/', after)).toBe(after.APP_URL);
  });
});

describe('state OAuth signé', () => {
  const secret = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));

  it("fait l'aller-retour et porte un nonce aléatoire", async () => {
    const key = await deriveStateKey(secret);
    const st = newOAuthState('https://owner.github.io/suivi-epargne/', 1_000);
    const token = await signState(st, key);
    expect(await verifyState(token, key, 2_000)).toEqual(st);
    expect(newOAuthState('x').nonce).not.toBe(newOAuthState('x').nonce);
  });

  it('expire au bout de 10 minutes', async () => {
    const key = await deriveStateKey(secret);
    const token = await signState(newOAuthState('u', 0), key);
    expect(await verifyState(token, key, STATE_TTL_MS)).not.toBeNull();
    expect(await verifyState(token, key, STATE_TTL_MS + 1)).toBeNull();
  });

  it('rejette un contenu ou une signature modifiés, et une autre clé', async () => {
    const key = await deriveStateKey(secret);
    const token = await signState(newOAuthState('https://owner.github.io/suivi-epargne/', 0), key);
    const [payload, sig] = token.split('.');
    const forged = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    forged.returnUrl = 'https://evil.example/';
    const forgedPayload = b64urlEncode(new TextEncoder().encode(JSON.stringify(forged)));
    expect(await verifyState(`${forgedPayload}.${sig}`, key, 1)).toBeNull();
    const flipped = sig.slice(0, -2) + (sig.slice(-2) === 'AA' ? 'AB' : 'AA');
    expect(await verifyState(`${payload}.${flipped}`, key, 1)).toBeNull();
    const other = await deriveStateKey(b64urlEncode(crypto.getRandomValues(new Uint8Array(32))));
    expect(await verifyState(token, other, 1)).toBeNull();
    expect(await verifyState('n.importe.quoi', key, 1)).toBeNull();
    expect(await verifyState(null, key, 1)).toBeNull();
  });

  it("dérive une clé distincte de la clé de chiffrement (HKDF), pas la clé brute", async () => {
    const raw = await crypto.subtle.importKey('raw', b64urlDecode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const st = newOAuthState('u', 0);
    const withRaw = await signState(st, raw);
    expect(await verifyState(withRaw, await deriveStateKey(secret), 1)).toBeNull();
  });
});

describe('utilitaires HTTP', () => {
  it('lit un cookie précis', () => {
    const req = new Request('https://w.dev/', { headers: { Cookie: 'a=1; __Host-pecule_oauth=abc_DEF; b=2' } });
    expect(readCookie(req, '__Host-pecule_oauth')).toBe('abc_DEF');
    expect(readCookie(req, 'absent')).toBeNull();
  });

  it('refuse un corps de plus de 4 Ko', async () => {
    const big = new Request('https://w.dev/', { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(5000) }) });
    await expect(readJsonBody(big)).rejects.toBeInstanceOf(BodyTooLargeError);
    const ok = new Request('https://w.dev/', { method: 'POST', body: '{"a":1}' });
    expect(await readJsonBody(ok)).toEqual({ a: 1 });
    expect(await readJsonBody(new Request('https://w.dev/', { method: 'POST', body: 'pas du json' }))).toEqual({});
  });
});

describe("vérification de l'id_token", () => {
  const CLIENT = 'client-123.apps.googleusercontent.com';
  const now = 1_800_000_000;
  const good = { sub: '42', email: 'a@b.c', email_verified: true, aud: CLIENT, iss: 'https://accounts.google.com', exp: now + 3600 };

  it('accepte un jeton Google émis pour ce client', () => {
    expect(verifyIdTokenClaims(good, CLIENT, now)).toBe(true);
    expect(verifyIdTokenClaims({ ...good, iss: 'accounts.google.com' }, CLIENT, now)).toBe(true);
  });
  it("refuse une autre audience, un autre émetteur ou un jeton expiré", () => {
    expect(verifyIdTokenClaims({ ...good, aud: 'autre-client' }, CLIENT, now)).toBe(false);
    expect(verifyIdTokenClaims({ ...good, iss: 'https://evil.example' }, CLIENT, now)).toBe(false);
    expect(verifyIdTokenClaims({ ...good, iss: undefined }, CLIENT, now)).toBe(false);
    expect(verifyIdTokenClaims({ ...good, exp: now - 3600 }, CLIENT, now)).toBe(false);
    expect(verifyIdTokenClaims({ ...good, aud: [CLIENT, 'x'], azp: 'x' }, CLIENT, now)).toBe(false);
  });
});
