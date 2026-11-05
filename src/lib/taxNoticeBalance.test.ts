import { describe, it, expect } from 'vitest';
import { taxBalanceSentence } from './taxNoticeBalance';

describe('taxBalanceSentence', () => {
  it('reste à payer avec sa date, remboursement, et sans date', () => {
    const flat = (s: string) => s.replace(/\s/g, ' ');
    expect(flat(taxBalanceSentence({ kind: 'due', amount: 320, date: '2026-12-15' }))).toBe('Reste à payer : 320 €, prélevé le 15 décembre 2026');
    expect(flat(taxBalanceSentence({ kind: 'refund', amount: 150.5, date: '2026-09-01' }))).toBe('Remboursement : 150,50 €, versé vers le 1er septembre 2026');
    expect(flat(taxBalanceSentence({ kind: 'due', amount: 80 }))).toBe('Reste à payer : 80 €');
  });
});
