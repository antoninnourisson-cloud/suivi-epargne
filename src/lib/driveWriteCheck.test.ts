import { describe, it, expect } from 'vitest';
import { orderRevisions, verifyWriteChain } from './driveWriteCheck';

const r = (id: string, modifiedTime?: string) => ({ id, modifiedTime });

describe('orderRevisions', () => {
  it("trie par date quand toutes les révisions en ont une, l'ordre de l'API départageant", () => {
    const ordered = orderRevisions([r('c', '2026-10-07T10:00:02Z'), r('a', '2026-10-07T10:00:00Z'), r('b1', '2026-10-07T10:00:01Z'), r('b2', '2026-10-07T10:00:01Z')]);
    expect(ordered).toEqual(['a', 'b1', 'b2', 'c']);
  });
  it("garde l'ordre de l'API si une date manque", () => {
    expect(orderRevisions([r('x', '2026-10-07T10:00:02Z'), r('y')])).toEqual(['x', 'y']);
  });
});

describe('verifyWriteChain', () => {
  it('accepte une écriture qui suit directement la révision attendue', () => {
    expect(verifyWriteChain([r('r1'), r('r2'), r('r3')], 'r2', 'r3')).toEqual({ kind: 'clean' });
  });
  it('ignore une écriture distante arrivée APRÈS la nôtre', () => {
    expect(verifyWriteChain([r('r1'), r('r2'), r('r3'), r('other')], 'r2', 'r3')).toEqual({ kind: 'clean' });
  });
  it("détecte une écriture intercalée et désigne la révision de l'autre appareil", () => {
    expect(verifyWriteChain([r('r1'), r('r2'), r('other'), r('r3')], 'r2', 'r3'))
      .toEqual({ kind: 'intervened', otherRevisionId: 'other' });
  });
  it('désigne la DERNIÈRE des écritures intercalées', () => {
    expect(verifyWriteChain([r('r2'), r('o1'), r('o2'), r('r3')], 'r2', 'r3'))
      .toEqual({ kind: 'intervened', otherRevisionId: 'o2' });
  });
  it("conclut à une intercalation même si l'attendue a disparu de la liste", () => {
    expect(verifyWriteChain([r('o1'), r('r3')], 'r2', 'r3')).toEqual({ kind: 'intervened', otherRevisionId: 'o1' });
  });
  it('liste en retard sans notre révision : intercalation si quelque chose suit déjà l’attendue', () => {
    expect(verifyWriteChain([r('r2'), r('other')], 'r2', 'r3')).toEqual({ kind: 'intervened', otherRevisionId: 'other' });
    expect(verifyWriteChain([r('r1'), r('r2')], 'r2', 'r3')).toEqual({ kind: 'unknown' });
  });
  it('historique tronqué ou vide : pas de conclusion', () => {
    expect(verifyWriteChain([r('r3'), r('r4')], 'r2', 'r3')).toEqual({ kind: 'unknown' });
    expect(verifyWriteChain([], 'r2', 'r3')).toEqual({ kind: 'unknown' });
  });
  it("s'appuie sur les dates plutôt que sur l'ordre de l'API", () => {
    const listed = [r('r3', '2026-10-07T10:00:03Z'), r('other', '2026-10-07T10:00:02Z'), r('r2', '2026-10-07T10:00:01Z')];
    expect(verifyWriteChain(listed, 'r2', 'r3')).toEqual({ kind: 'intervened', otherRevisionId: 'other' });
  });
});
