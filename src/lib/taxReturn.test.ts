import { describe, it, expect } from 'vitest';
import {
  buildTaxReturnChecklist, buildTaxReturnAlert, buildTaxReturnReminder, taxReturnSeason, taxReturnTopics,
  isLikelyForeignAccount, TAX_RETURN_CALENDAR_TEXT,
} from './taxReturn';
import { buildAgenda } from './agenda';
import { migrate } from './schema';
import { AccountMovement, AccountType, GlobalAppData, SavingsAccount } from '../types';

const mv = (date: string, amount: number, type: 'IN' | 'OUT' = 'IN', extra: Partial<AccountMovement> = {}): AccountMovement =>
  ({ id: `${date}-${amount}-${type}-${extra.kind ?? ''}`, date, amount, type, label: 'x', ...extra });

const acc = (over: Partial<SavingsAccount> & { id: string; type: AccountType }): SavingsAccount => ({
  name: over.id, institution: 'Banque', totalAmount: over.ownedAmount ?? 0, ownedAmount: 0, parentalCapital: 0, movements: [], ...over,
});

const data = (accounts: SavingsAccount[], extra: Partial<GlobalAppData> = {}) => ({ accounts, payslips: [], donations: [], ...extra });
const line = (lines: ReturnType<typeof buildTaxReturnChecklist>, id: string) => lines.find(l => l.id === id);

describe('aide à la déclaration : intérêts imposables', () => {
  const livretBancaire = acc({ id: 'lb', name: 'Livret Boursorama', type: AccountType.AUTRE, ownedAmount: 1000, totalAmount: 1000, interestRate: 3,
    movements: [mv('2025-01-01', 1000, 'IN', { tag: 'initial', label: 'Solde initial' })] });

  it('calcule 2TR et l’acompte 2CK (12,8 %) sur un livret bancaire, pas sur le Livret A', () => {
    const livretA = acc({ id: 'la', type: AccountType.LIVRET_A, ownedAmount: 5000, totalAmount: 5000, interestRate: 1.7, movements: [mv('2025-01-01', 5000)] });
    const lines = buildTaxReturnChecklist(data([livretBancaire, livretA]), 2025);
    expect(line(lines, 'interest')).toMatchObject({ box: '2TR', amount: 30, confidence: 'estimate', section: 'savings' });
    expect(line(lines, 'interest')!.note).toMatch(/pré-rempli/);
    expect(line(lines, 'interest-credit')).toMatchObject({ box: '2CK', amount: 4 });
    expect(line(lines, 'interest-credit')!.note).toMatch(/25 000 €.*30 novembre/);
    expect(line(lines, 'interest-option')?.box).toBe('2OP');
    expect(line(lines, 'livrets')?.note).toMatch(/exonérés/);
    expect(lines.every(l => !l.link || l.link.url.startsWith('https://www.'))).toBe(true);
  });

  it('un compte à l’étranger : rien de pré-rempli, formulaire 2047', () => {
    const lines = buildTaxReturnChecklist(data([{ ...livretBancaire, heldAbroad: true }]), 2025);
    expect(line(lines, 'interest')).toBeUndefined();
    expect(line(lines, 'interest-abroad')).toMatchObject({ box: '2047 → 2TR', amount: 30, confidence: 'todo' });
  });

  it('rien sans intérêts', () => {
    const cc = acc({ id: 'cc', type: AccountType.COMPTE_COURANT, ownedAmount: 2000, totalAmount: 2000, interestRate: 0 });
    const lines = buildTaxReturnChecklist(data([cc]), 2025);
    expect(lines.some(l => l.id.startsWith('interest'))).toBe(false);
  });
});

describe('aide à la déclaration : PER', () => {
  it('somme les versements de l’année (6NS), hors solde initial, valorisation, part des parents et corrections', () => {
    const per = acc({ id: 'per', type: AccountType.PER, ownedAmount: 5000, totalAmount: 5000, movements: [
      mv('2025-01-10', 3000, 'IN', { tag: 'initial', label: 'Solde initial' }),
      mv('2025-03-01', 1000), mv('2025-09-01', 500),
      mv('2025-12-31', 200, 'IN', { kind: 'valuation' }),
      mv('2025-06-01', 300, 'IN', { kind: 'adjustment' }),
      mv('2024-12-31', 999),
      mv('2025-10-01', 100, 'OUT'),
    ] });
    const l = line(buildTaxReturnChecklist(data([per]), 2025), 'per');
    expect(l).toMatchObject({ box: '6NS', amount: 1500, confidence: 'estimate', section: 'deductions' });
    expect(l!.note).toMatch(/plafond.*avis d'impôt/);
    expect(l!.note).toMatch(/6NT/);
    // Solde initial daté de 2025 : il peut contenir des versements de l'année.
    expect(l!.note).toMatch(/solde de départ/);
  });

  it('PER sans versement : rien à déclarer', () => {
    const per = acc({ id: 'per', type: AccountType.PER, ownedAmount: 5000, totalAmount: 5000 });
    const l = line(buildTaxReturnChecklist(data([per]), 2025), 'per');
    expect(l?.confidence).toBe('info');
    expect(l?.amount).toBeUndefined();
    expect(l!.note).toMatch(/rien à déclarer en 6NS/);
  });

  it('PER ajouté pendant l’année : son solde de départ peut contenir des versements, pas de « rien à déclarer »', () => {
    const withInitial = acc({ id: 'per', type: AccountType.PER, ownedAmount: 5000, totalAmount: 5000, movements: [
      mv('2025-06-01', 5000, 'IN', { tag: 'initial', label: 'Solde initial' }),
    ] });
    const opened = acc({ id: 'per', type: AccountType.PER, ownedAmount: 5000, totalAmount: 5000, openingDate: '2025-03-15' });
    for (const per of [withInitial, opened]) {
      const l = line(buildTaxReturnChecklist(data([per]), 2025), 'per');
      expect(l).toMatchObject({ box: '6NS', confidence: 'check' });
      expect(l?.amount).toBeUndefined();
      expect(l!.note).toMatch(/solde de départ.*2025.*attestation/);
      expect(l!.note).not.toMatch(/rien à déclarer/);
    }
    // Ajouté l'année d'avant : la conclusion « rien à déclarer » reste juste.
    const older = acc({ id: 'per', type: AccountType.PER, ownedAmount: 5000, totalAmount: 5000, openingDate: '2023-01-01',
      movements: [mv('2024-06-01', 5000, 'IN', { tag: 'initial', label: 'Solde initial' })] });
    expect(line(buildTaxReturnChecklist(data([older]), 2025), 'per')?.confidence).toBe('info');
  });
});

describe('aide à la déclaration : comptes à l’étranger', () => {
  it('une ligne 8UU par compte tenu à l’étranger : 3916, 3916-bis pour la crypto', () => {
    const lines = buildTaxReturnChecklist(data([
      acc({ id: 'rev', name: 'Revolut', institution: 'Revolut', type: AccountType.COMPTE_COURANT, heldAbroad: true }),
      acc({ id: 'bin', name: 'Binance', institution: 'Binance', type: AccountType.CRYPTO, heldAbroad: true }),
      acc({ id: 'av', name: 'AV Luxembourg', institution: 'Lux Vie', type: AccountType.ASSURANCE_VIE, heldAbroad: true }),
    ]), 2025);
    expect(line(lines, 'abroad-rev')).toMatchObject({ box: '8UU · 3916', confidence: 'todo', label: 'Revolut' });
    expect(line(lines, 'abroad-rev')!.note).toMatch(/1 500 €/);
    expect(line(lines, 'abroad-bin')).toMatchObject({ box: '8UU · 3916-bis' });
    expect(line(lines, 'abroad-bin')!.note).toMatch(/750 €.*1 500 €.*50 000 €/);
    expect(line(lines, 'abroad-av')!.note).toMatch(/3916/);
    expect(taxReturnTopics(lines)).toContain("3 comptes à l'étranger (8UU)");
  });

  it('crypto ou néobanque non précisée : à vérifier ; « non » explicite : rien', () => {
    const lines = buildTaxReturnChecklist(data([
      acc({ id: 'c', name: 'Mon wallet', institution: 'Kraken', type: AccountType.CRYPTO }),
      acc({ id: 'n', name: 'Compte N26', institution: 'N26', type: AccountType.COMPTE_COURANT }),
      acc({ id: 'f', name: 'Coinhouse', institution: 'Coinhouse', type: AccountType.CRYPTO, heldAbroad: false }),
      acc({ id: 'b', name: 'Compte joint', institution: 'BNP', type: AccountType.COMPTE_COURANT }),
    ]), 2025);
    expect(line(lines, 'abroad-check-c')).toMatchObject({ confidence: 'check', box: '3916-bis ?' });
    expect(line(lines, 'abroad-check-n')!.note).toMatch(/IBAN.*FR/);
    expect(line(lines, 'abroad-check-n')!.note).toMatch(/« Compte détenu à l'étranger \? » \(Oui ou Non\)/);
    expect(lines.some(l => l.id.endsWith('-f'))).toBe(false);
    expect(lines.some(l => l.id.endsWith('-b'))).toBe(false);
    expect(taxReturnTopics(lines)).toContain("2 comptes peut-être tenus à l'étranger");
  });

  it('ignore un compte ouvert après l’année déclarée', () => {
    const lines = buildTaxReturnChecklist(data([acc({ id: 'rev', type: AccountType.COMPTE_COURANT, heldAbroad: true, openingDate: '2026-03-01' })]), 2025);
    expect(line(lines, 'abroad-rev')).toBeUndefined();
  });

  it('repère les établissements souvent étrangers', () => {
    expect(isLikelyForeignAccount({ type: AccountType.COMPTE_COURANT, institution: 'Trade Republic', name: 'CTO' })).toBe(true);
    expect(isLikelyForeignAccount({ type: AccountType.COMPTE_COURANT, institution: 'Crédit Agricole', name: 'CCP' })).toBe(false);
    expect(isLikelyForeignAccount({ type: AccountType.CRYPTO, institution: 'Ledger', name: 'Clé', heldAbroad: false })).toBe(false);
  });
});

describe('aide à la déclaration : ventes de crypto', () => {
  const crypto = (movements: AccountMovement[]) => acc({ id: 'c', type: AccountType.CRYPTO, heldAbroad: true, ownedAmount: 1000, totalAmount: 1000, movements });

  it('retraits jusqu’à 305 € : exonérés, mais le 2086 reste à remplir', () => {
    const l = line(buildTaxReturnChecklist(data([crypto([mv('2025-05-01', 200, 'OUT'), mv('2025-06-01', 50, 'OUT', { kind: 'valuation' })])]), 2025), 'crypto-sales');
    // Rien ne va en 3AN / 3BN sous le seuil : seul le formulaire 2086 est cité.
    expect(l).toMatchObject({ box: '2086', amount: 200, confidence: 'todo' });
    expect(l!.note).toMatch(/305 €.*exonérées.*2086/);
  });

  it('au-delà de 305 € : plus-value en 3AN, moins-value en 3BN, et quoi rassembler', () => {
    const l = line(buildTaxReturnChecklist(data([crypto([mv('2025-05-01', 400, 'OUT')])]), 2025), 'crypto-sales');
    expect(l).toMatchObject({ box: '2086 · 3AN / 3BN', amount: 400 });
    expect(l!.note).toMatch(/3AN.*3BN/);
    expect(l!.note).toMatch(/valeur totale de votre portefeuille/);
    // Un retrait n'est qu'un indice de vente : rien d'affirmé.
    expect(l!.note).toMatch(/Si vos ventes de l'année dépassent 305 €.*plus-value éventuelle/);
    expect(l!.note).toMatch(/pas forcément une vente/);
    expect(l!.note).not.toMatch(/la plus-value est imposable/);
  });

  it('sans retrait noté : à vérifier (ventes restées sur la plateforme)', () => {
    const l = line(buildTaxReturnChecklist(data([crypto([mv('2024-05-01', 400, 'OUT')])]), 2025), 'crypto-sales');
    expect(l).toMatchObject({ box: '2086', confidence: 'check' });
    expect(l?.amount).toBeUndefined();
  });
});

describe('saison de la déclaration', () => {
  it('du 1er avril au 10 juin, pour les revenus de l’année écoulée', () => {
    expect(taxReturnSeason(new Date(2027, 2, 31))).toBeNull();
    expect(taxReturnSeason(new Date(2027, 3, 1))).toEqual({ incomeYear: 2026 });
    expect(taxReturnSeason(new Date(2027, 5, 10))).toEqual({ incomeYear: 2026 });
    expect(taxReturnSeason(new Date(2027, 5, 11))).toBeNull();
  });

  it('alerte pour tout le monde, sans date inventée', () => {
    const a = buildTaxReturnAlert(data([]), new Date(2027, 3, 15));
    expect(a).toEqual({ key: 'tax-return-2026', incomeYear: 2026, title: 'Déclaration des revenus 2026', detail: TAX_RETURN_CALENDAR_TEXT });
    expect(TAX_RETURN_CALENDAR_TEXT).not.toMatch(/\d/);
    expect(buildTaxReturnAlert(data([]), new Date(2027, 8, 1))).toBeNull();
  });

  it('le rappel résume ce qui concerne l’utilisateur', () => {
    const r = buildTaxReturnReminder(data([acc({ id: 'per', type: AccountType.PER, movements: [mv('2026-02-01', 100)] })], {
      donations: [{ id: 'd', date: '2026-05-01', amount: 50, organization: 'X', rate: 66, receiptReceived: true }],
    }), 2026);
    expect(r.detail).toMatch(/^À vérifier : vos versements PER \(6NS\) et vos dons \(7UD, 7UF\)\. La déclaration en ligne/);
  });

  it('l’agenda annonce la déclaration même sans don', () => {
    const full = { ...data([]), expenses: [], history: [], config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 } } as GlobalAppData;
    const e = buildAgenda(full, new Date(2026, 9, 14)).events.find(x => x.date === '2027-04-10');
    expect(e).toMatchObject({ kind: 'fiscal', title: 'Déclaration des revenus 2026', view: 'donations' });
    expect(e!.detail).toMatch(/fin mai ou début juin/);
  });
});

describe('format du fichier : compte détenu à l’étranger', () => {
  it('garde un oui/non, écarte une valeur illisible', () => {
    const raw = (v: unknown) => ({ accounts: [{ id: 'a', name: 'A', type: AccountType.CRYPTO, institution: 'X', totalAmount: 0, ownedAmount: 0, parentalCapital: 0, heldAbroad: v }] });
    expect(migrate(raw(true)).accounts[0].heldAbroad).toBe(true);
    expect(migrate(raw(false)).accounts[0].heldAbroad).toBe(false);
    expect('heldAbroad' in migrate(raw('oui')).accounts[0]).toBe(false);
    expect('heldAbroad' in migrate({ accounts: [{ id: 'b', name: 'B', type: AccountType.LIVRET_A, institution: 'X', totalAmount: 0, ownedAmount: 0, parentalCapital: 0 }] }).accounts[0]).toBe(false);
  });
});
