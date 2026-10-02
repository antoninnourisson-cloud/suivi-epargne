import { describe, it, expect } from 'vitest';
import { buildAccountsUpdateMail, buildRestitutionMail, esc, eurHtml } from './mailTemplates';
import { AccountType } from '../types';

const acc = (over: any = {}) => ({ id: 'a', name: 'LA', institution: 'B', type: AccountType.LIVRET_A, totalAmount: 100, ownedAmount: 50, parentalCapital: 50, ...over });

describe('mailTemplates', () => {
  it('échappe le HTML', () => {
    expect(esc('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
  });
  it("n'affiche jamais une chaîne brute à la place d'un montant", () => {
    expect(eurHtml('<img onerror=1>')).not.toContain('<');
  });
  it('ne produit un e-mail que pour le Livret A et le LEP', () => {
    expect(buildAccountsUpdateMail([acc({ type: AccountType.PEA })], [{ account: acc({ type: AccountType.PEA, totalAmount: 200 }) }])).toBeNull();
    expect(buildAccountsUpdateMail([acc()], [{ account: acc({ totalAmount: 150 }) }])).toContain('Mise à jour des comptes');
  });
  it('échappe les noms de comptes dans le récapitulatif de restitution', () => {
    const html = buildRestitutionMail('01/01/2027', [{ name: '<b>pirate</b>', amount: 10 }], 10, 0);
    expect(html).not.toContain('<b>pirate</b>');
    expect(html).toContain('&lt;b&gt;pirate');
  });
});
