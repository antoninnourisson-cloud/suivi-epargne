import { describe, it, expect } from 'vitest';
import { duePlannedWithdrawals, sanitizePlannedWithdrawals } from './plannedWithdrawals';

const plan = (over: Record<string, unknown> = {}) => ({ id: 'p1', date: '2026-11-16', needDate: '2026-11-20', lines: [{ accountId: 'la', amount: 800 }], ...over });

describe('retraits prévus', () => {
  it('garde les retraits lisibles (champs inconnus compris), écarte le reste', () => {
    expect(sanitizePlannedWithdrawals([plan({ note: 'vacances' })])).toEqual([plan({ note: 'vacances' })]);
    expect(sanitizePlannedWithdrawals([
      plan({ id: '' }), plan({ date: '16/11/2026' }), plan({ needDate: undefined }), plan({ lines: [] }), 'x', null,
      plan({ id: 'p2', lines: [{ accountId: 'la', amount: -5 }, { accountId: '', amount: 10 }, { accountId: 'ldds', amount: 20 }, { amount: Number.NaN }] }),
    ])).toEqual([plan({ id: 'p2', lines: [{ accountId: 'ldds', amount: 20 }] })]);
    expect(sanitizePlannedWithdrawals([plan({ lines: 'non' })])).toBeUndefined();
    expect(sanitizePlannedWithdrawals({})).toBeUndefined();
  });

  it('dit ceux dont le jour est venu', () => {
    const plans = [plan(), plan({ id: 'p2', date: '2026-11-04' })];
    expect(duePlannedWithdrawals(plans, '2026-11-04').map(p => p.id)).toEqual(['p2']);
    expect(duePlannedWithdrawals(plans, '2026-11-16').map(p => p.id)).toEqual(['p1', 'p2']);
    expect(duePlannedWithdrawals(undefined, '2026-11-16')).toEqual([]);
  });
});
