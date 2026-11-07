import { describe, expect, it } from 'vitest';
import { canonicalize, migrate, withoutDeviceOnlyFields, APP_SCHEMA_VERSION } from '../../lib/schema';
import { canonicalDoc, classifySyncError } from './syncShared';
import { NetworkError } from '../../lib/networkError';

describe('forme canonique du document', () => {
  const doc = migrate({ accounts: [{ id: 'a', name: 'Livret A', totalAmount: 10, ownedAmount: 10, parentalCapital: 0 }], config: { leisureBudget: 120 } });

  it('equals the canonical form of what would be written to Drive', () => {
    // currentData() : le document, sans secret d'appareil, avec la version et la vue courante.
    const written = { ...withoutDeviceOnlyFields(doc), schemaVersion: APP_SCHEMA_VERSION, lastView: 'pilot' };
    expect(canonicalDoc(doc)).toBe(canonicalize(written));
  });

  it('is computed once per document version (the state is never changed in place)', () => {
    const first = canonicalDoc(doc);
    // Une modification en place (interdite dans l'app) ne serait pas vue : preuve du cache.
    (doc.config as { leisureBudget: number }).leisureBudget = 999;
    expect(canonicalDoc(doc)).toBe(first);
    // Une nouvelle version (nouvel objet, comme setDoc) est recalculée.
    expect(canonicalDoc({ ...doc })).not.toBe(first);
  });
});

describe('classement des erreurs de synchronisation', () => {
  it('seule une NetworkError est « hors ligne »', () => {
    expect(classifySyncError(new NetworkError('NETWORK_TIMEOUT'))).toBe('offline');
  });

  it('une autre TypeError (bug de code) est une erreur inattendue, pas « hors ligne »', () => {
    const bug = (() => { try { (undefined as unknown as { x: number }).x.toFixed(); } catch (e) { return e; } })();
    expect(bug).toBeInstanceOf(TypeError);
    expect(classifySyncError(bug)).toBe('error');
    expect(classifySyncError(new TypeError('Failed to fetch'))).toBe('error');
  });

  it('les autres cas restent classés comme avant', () => {
    expect(classifySyncError(new Error('SESSION_EXPIRED'))).toBe('session');
    expect(classifySyncError(new Error('autre'))).toBe('error');
  });
});
