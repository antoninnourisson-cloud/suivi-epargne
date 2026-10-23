import { describe, it, expect } from 'vitest';
import { ACCOUNT_TYPE_LABELS, defaultCeiling, hasCeiling, describeAccountTax, totalsForTag, PEL_DEPOSIT_CEILING, CEL_DEPOSIT_CEILING } from './accountTypes';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountType } from '../types';

const CFG = DEFAULT_FISCAL_CONFIG;
const NOW = new Date(2026, 9, 21);

describe('catalogue des types de compte', () => {
  it('chaque type a un nom affiché ; les valeurs enregistrées ne changent pas', () => {
    for (const t of Object.values(AccountType)) expect(ACCOUNT_TYPE_LABELS[t]).toBeTruthy();
    expect(AccountType.LIVRET_BANCAIRE).toBe('Livret bancaire');
    expect(AccountType.CTO).toBe('Compte-titres');
    expect(AccountType.COMPTE_A_TERME).toBe('Compte à terme');
    expect(AccountType.COMPTE_COURANT).toBe('Compte Courant');
  });

  it('plafonds proposés : livrets réglementés, PEL 61 200 €, CEL 15 300 €', () => {
    expect(defaultCeiling(AccountType.LIVRET_A, CFG)).toBe(CFG.ceilings.livretA);
    expect(defaultCeiling(AccountType.LEP, CFG)).toBe(CFG.ceilings.lep);
    expect(defaultCeiling(AccountType.PEL, CFG)).toBe(PEL_DEPOSIT_CEILING);
    expect(PEL_DEPOSIT_CEILING).toBe(61200);
    expect(defaultCeiling(AccountType.CEL, CFG)).toBe(CEL_DEPOSIT_CEILING);
    expect(CEL_DEPOSIT_CEILING).toBe(15300);
    expect(defaultCeiling(AccountType.CTO, CFG)).toBe(0);
    expect(hasCeiling(AccountType.LIVRET_BANCAIRE)).toBe(true);
    expect(hasCeiling(AccountType.PEA)).toBe(false);
    expect(hasCeiling(AccountType.COMPTE_COURANT)).toBe(false);
  });
});

describe('règle fiscale en mots simples', () => {
  it('livret bancaire et compte à terme : PFU chaque année, 18,6 % de prélèvements sociaux', () => {
    expect(describeAccountTax({ type: AccountType.LIVRET_BANCAIRE }, CFG, NOW)).toMatch(/12,8\s%.*18,6\s%/);
    expect(describeAccountTax({ type: AccountType.COMPTE_A_TERME }, CFG, NOW)).toMatch(/bloqué jusqu'à l'échéance/);
  });

  it('épargne logement : régime selon la date d’ouverture, 17,2 % de prélèvements sociaux', () => {
    expect(describeAccountTax({ type: AccountType.PEL, openingDate: '2016-05-01' }, CFG, NOW)).toMatch(/Ouvert avant 2018 : intérêts sans impôt sur le revenu pendant 12 ans\. Prélèvements sociaux : 17,2\s%/);
    expect(describeAccountTax({ type: AccountType.PEL, openingDate: '2019-05-01' }, CFG, NOW)).toMatch(/^Intérêts imposés chaque année : 12,8\s%/);
    expect(describeAccountTax({ type: AccountType.PEL }, CFG, NOW)).toMatch(/Date d'ouverture inconnue/);
    expect(describeAccountTax({ type: AccountType.CEL, openingDate: '2010-01-01' }, CFG, NOW)).toMatch(/sans impôt sur le revenu\. .*Retraits libres/);
  });

  it('compte-titres : dividendes imposés chaque année, plus-values à la vente ; crypto : à la vente seulement', () => {
    const cto = describeAccountTax({ type: AccountType.CTO }, CFG, NOW);
    expect(cto).toMatch(/^Dividendes et intérêts imposés chaque année : 12,8\s% d'impôt \(retenus à l'avance par la banque\) et 18,6\s%/);
    expect(cto).toMatch(/Plus-values imposées seulement quand vous vendez/);
    expect(describeAccountTax({ type: AccountType.CRYPTO }, CFG, NOW)).toMatch(/^Gains imposés seulement quand vous vendez/);
  });

  it('« Autre » : disponible et imposé ; PER : déduction ; immobilier : non calculé', () => {
    expect(describeAccountTax({ type: AccountType.AUTRE }, CFG, NOW)).toMatch(/disponible.*Argent bloqué/);
    expect(describeAccountTax({ type: AccountType.PER }, CFG, NOW)).toMatch(/déduits de votre revenu imposable/);
    expect(describeAccountTax({ type: AccountType.IMMOBILIER }, CFG, NOW)).toMatch(/non calculée/);
    for (const t of Object.values(AccountType)) expect(describeAccountTax({ type: t }, CFG, NOW)).not.toBe('');
  });
});

describe('total par étiquette (projets)', () => {
  it('votre part et celle des parents des comptes étiquetés', () => {
    const accounts = [
      { tags: ['Voyage'], ownedAmount: 800, parentalCapital: 0 },
      { tags: ['Voyage', 'Précaution'], ownedAmount: 1000.1, parentalCapital: 500 },
      { tags: ['Précaution'], ownedAmount: 3000, parentalCapital: 0 },
      { ownedAmount: 50, parentalCapital: 0 },
    ];
    expect(totalsForTag(accounts, 'Voyage')).toEqual({ owned: 1800.1, parental: 500, count: 2 });
    expect(totalsForTag(accounts, 'Inconnu')).toEqual({ owned: 0, parental: 0, count: 0 });
  });
});
