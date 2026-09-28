import { describe, it, expect } from 'vitest';
import { encryptPushPayload, vapidAuthorization } from '../src/webpush';
import { b64urlDecode, b64urlEncode, utf8, encryptString, decryptString, sha256b64url } from '../src/crypto';

describe('encryptPushPayload — vecteur de test RFC 8291, annexe A', () => {
  // Valeurs publiées dans la RFC : si la sortie est identique octet pour octet, le
  // chiffrement est conforme — ce que tous les services de push (FCM, APNs, Mozilla)
  // implémentent de leur côté pour déchiffrer.
  const vector = {
    plaintext: 'When I grow up, I want to be a watermelon',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    expected: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  };

  it('produit exactement le corps chiffré attendu', async () => {
    const body = await encryptPushPayload(
      b64urlDecode(vector.uaPublic),
      b64urlDecode(vector.authSecret),
      utf8(vector.plaintext),
      { asPrivate: b64urlDecode(vector.asPrivate), asPublic: b64urlDecode(vector.asPublic), salt: b64urlDecode(vector.salt) }
    );
    expect(b64urlEncode(body)).toBe(vector.expected);
  });

  it('utilise une clé éphémère et un sel différents à chaque message', async () => {
    const a = await encryptPushPayload(b64urlDecode(vector.uaPublic), b64urlDecode(vector.authSecret), utf8('x'));
    const b = await encryptPushPayload(b64urlDecode(vector.uaPublic), b64urlDecode(vector.authSecret), utf8('x'));
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
  });
});

describe('vapidAuthorization (RFC 8292)', () => {
  it('produit un JWT ES256 vérifiable avec la clé publique, audience = origine du service', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey) as ArrayBuffer);

    const header = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc123', 'https://example.com/',
      b64urlEncode(pubRaw), jwk.d!, 1_000_000
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match!;
    expect(k).toBe(b64urlEncode(pubRaw));

    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 12 * 3600, sub: 'https://example.com/' });

    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, b64urlDecode(s), utf8(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe('chiffrement au repos du refresh token', () => {
  const key = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));

  it('fait l aller-retour, avec un IV différent à chaque chiffrement', async () => {
    const a = await encryptString('1//refresh-token', key);
    const b = await encryptString('1//refresh-token', key);
    expect(a).not.toBe(b);
    expect(await decryptString(a, key)).toBe('1//refresh-token');
  });

  it('refuse de déchiffrer avec une autre clé (authentification GCM)', async () => {
    const other = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    await expect(decryptString(await encryptString('secret', key), other)).rejects.toThrow();
  });

  it('refuse une clé de mauvaise taille', async () => {
    await expect(encryptString('x', b64urlEncode(new Uint8Array(16)))).rejects.toThrow(/32 bytes/);
  });

  it('hache les jetons de façon déterministe', async () => {
    expect(await sha256b64url('abc')).toBe(await sha256b64url('abc'));
    expect(await sha256b64url('abc')).not.toBe(await sha256b64url('abd'));
  });
});
