import { describe, expect, it } from 'vitest';
import { canonicalize, migrate, withoutDeviceOnlyFields, APP_SCHEMA_VERSION } from '../../lib/schema';
import { canonicalDoc } from './syncShared';

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
