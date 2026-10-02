// ================================================
// FILE: worker/src/webpush.ts
// Envoi de notifications Web Push, sans dépendance :
// - chiffrement du contenu : RFC 8291 (« aes128gcm ») — le service de push (Google,
//   Apple, Mozilla) transporte le message sans pouvoir le lire ;
// - authentification du serveur : RFC 8292 (VAPID, JWT signé ES256).
// La bibliothèque de référence `web-push` dépend du module crypto de Node, indisponible
// dans les Workers ; tout est donc fait avec WebCrypto. L'implémentation est validée
// contre le vecteur de test de la RFC 8291 (annexe A), voir test/webpush.test.ts.
// ================================================
import { b64urlDecode, b64urlEncode, concatBytes, utf8 } from './crypto';

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const hmacSha256 = async (key: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
};

/** Point P-256 non compressé (0x04 || x || y) → JWK public ou privé. */
const p256Jwk = (publicRaw: Uint8Array, privateD?: Uint8Array): JsonWebKey => {
  if (publicRaw.length !== 65 || publicRaw[0] !== 0x04) throw new Error('INVALID_P256_PUBLIC_KEY');
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: b64urlEncode(publicRaw.slice(1, 33)),
    y: b64urlEncode(publicRaw.slice(33, 65)),
    ext: true,
  };
  if (privateD) jwk.d = b64urlEncode(privateD);
  return jwk;
};

export interface FixedEncryptionParams {
  // Réservé aux tests : clé éphémère et sel imposés pour reproduire le vecteur de la RFC.
  asPrivate: Uint8Array;
  asPublic: Uint8Array;
  salt: Uint8Array;
}

/**
 * Chiffre `plaintext` pour l'abonnement (clé p256dh `uaPublic`, secret `authSecret`),
 * selon RFC 8291 §3-4. Renvoie le corps complet de la requête (en-tête aes128gcm inclus).
 */
export const encryptPushPayload = async (
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  plaintext: Uint8Array,
  fixed?: FixedEncryptionParams
): Promise<Uint8Array> => {
  // Paire de clés éphémère du serveur d'application (une par message).
  let asPrivateKey: CryptoKey;
  let asPublic: Uint8Array;
  if (fixed) {
    asPrivateKey = await crypto.subtle.importKey('jwk', p256Jwk(fixed.asPublic, fixed.asPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    asPublic = fixed.asPublic;
  } else {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    asPrivateKey = kp.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey) as ArrayBuffer);
  }

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // Les types Workers nomment la clé `$public`, mais le runtime attend bien `public`.
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as SubtleCryptoDeriveKeyAlgorithm, asPrivateKey, 256));

  // HKDF (extract + expand sur un seul bloc, les sorties faisant <= 32 octets).
  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concatBytes(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hmacSha256(prkKey, concatBytes(keyInfo, [1]));

  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = (await hmacSha256(prk, concatBytes(utf8('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmacSha256(prk, concatBytes(utf8('Content-Encoding: nonce\0'), [1]))).slice(0, 12);

  // Enregistrement unique : contenu suivi du délimiteur de dernier enregistrement (0x02).
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concatBytes(plaintext, [2])));

  // En-tête : salt (16) || rs (4, big-endian) || idlen (1) || keyid (= as_public)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concatBytes(header, ciphertext);
};

/**
 * En-tête `Authorization` VAPID (RFC 8292) : JWT ES256 dont l'audience est l'origine du
 * service de push. WebCrypto signe déjà au format brut r||s exigé par JWS, sans conversion.
 */
export const vapidAuthorization = async (
  endpoint: string,
  subject: string,
  vapidPublicB64: string,
  vapidPrivateB64: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> => {
  const header = b64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(utf8(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: nowSeconds + 12 * 3600, // maximum autorisé : 24 h
    sub: subject,
  })));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'jwk', p256Jwk(b64urlDecode(vapidPublicB64), b64urlDecode(vapidPrivateB64)),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signingInput)));
  return `vapid t=${signingInput}.${b64urlEncode(sig)}, k=${vapidPublicB64}`;
};

export interface PushMessage {
  title: string;
  body: string;
  url?: string;   // ouvert au clic
  tag?: string;   // regroupe/remplace les notifications d'un même sujet
}

/**
 * Envoie un message. Renvoie le statut HTTP du service de push : 404/410 signifient que
 * l'abonnement n'existe plus (appareil désinscrit) et doit être supprimé par l'appelant.
 */
export const sendPush = async (
  subscription: PushSubscriptionJSON,
  message: PushMessage,
  vapid: { publicKey: string; privateKey: string; subject: string }
): Promise<number> => {
  const body = await encryptPushPayload(
    b64urlDecode(subscription.keys.p256dh),
    b64urlDecode(subscription.keys.auth),
    utf8(JSON.stringify(message))
  );
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 3600),
      Urgency: 'normal',
    },
    body,
  });
  return res.status;
};
