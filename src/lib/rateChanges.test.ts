import { describe, it, expect } from 'vitest';
import { isRateProposal, otherRateAccounts, splitFiscalProposals } from './rateChanges';
import { AccountType, type SavingsAccount } from '../types';

describe('rituel « Les taux ont changé »', () => {
  it('sépare les taux des livrets (le rituel) des autres propositions (la carte de la veille)', () => {
    const ps = [{ key: 'rate.livretA' }, { key: 'ceiling.livretA' }, { key: 'rate.lep' }, { key: 'inflation' }, { key: 'taxBrackets' }];
    const { rates, others } = splitFiscalProposals(ps);
    expect(rates.map(p => p.key)).toEqual(['rate.livretA', 'rate.lep']);
    expect(others.map(p => p.key)).toEqual(['ceiling.livretA', 'inflation', 'taxBrackets']);
    expect(isRateProposal({ key: 'socialChargesCapital' })).toBe(false);
  });

  it('autres comptes : livrets bancaires et assurance vie seulement', () => {
    const acc = (id: string, type: AccountType) => ({ id, type }) as SavingsAccount;
    const list = [acc('la', AccountType.LIVRET_A), acc('lb', AccountType.LIVRET_BANCAIRE), acc('av', AccountType.ASSURANCE_VIE), acc('pel', AccountType.PEL)];
    expect(otherRateAccounts(list).map(a => a.id)).toEqual(['lb', 'av']);
  });
});
