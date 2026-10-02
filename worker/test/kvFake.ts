import { b64urlEncode } from '../src/crypto';

// KV en mémoire pour les tests : get/put/delete/list, expiration selon Date.now() (donc
// pilotable par vi.setSystemTime), et compteur d'écritures pour surveiller le quota gratuit.
export class MemoryKV {
  data = new Map<string, { value: string; expiresAt?: number }>();
  writes = 0;

  private live(key: string) {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== undefined && Date.now() >= e.expiresAt) { this.data.delete(key); return undefined; }
    return e;
  }

  async get(key: string, type?: string | { type?: string }): Promise<any> {
    const e = this.live(key);
    if (!e) return null;
    const t = typeof type === 'string' ? type : type?.type;
    return t === 'json' ? JSON.parse(e.value) : e.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    if (opts?.expirationTtl !== undefined && opts.expirationTtl < 60) throw new Error(`KV: expirationTtl ${opts.expirationTtl} < 60`);
    this.writes++;
    this.data.set(key, { value, expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined });
  }

  async delete(key: string): Promise<void> { this.writes++; this.data.delete(key); }

  async list(opts: { prefix?: string; cursor?: string } = {}): Promise<any> {
    const keys = [...this.data.keys()].filter(k => this.live(k) && k.startsWith(opts.prefix || '')).sort().map(name => ({ name }));
    return { keys, list_complete: true, cursor: '' };
  }

  keysWithPrefix(prefix: string): string[] {
    return [...this.data.keys()].filter(k => this.live(k) && k.startsWith(prefix)).sort();
  }

  asKV(): KVNamespace { return this as unknown as KVNamespace; }
}

/** Clés d'abonnement push valides (point P-256 réel, secret de 16 octets). */
export const makeKeys = async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey) as ArrayBuffer);
  return { p256dh: b64urlEncode(raw), auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
};
