import { describe, it, expect } from 'vitest';
import { buildAskSnapshot, ASK_SNAPSHOT_MAX_CHARS } from './askSnapshot';
import { AccountType, type AccountMovement, type GlobalAppData, type SavingsAccount } from '../types';

const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'x', name: 'x', type: AccountType.LIVRET_A, institution: 'Banque',
  totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, interestRate: 0, movements: [], ...over,
});
const mv = (date: string, amount: number, type: 'IN' | 'OUT' = 'IN', label = 'Épargne'): AccountMovement => ({ id: `${date}-${amount}-${type}`, date, amount, label, type });

const NOW = new Date(2026, 9, 28, 10); // 28 octobre 2026

const base = (over: Partial<GlobalAppData> = {}): GlobalAppData => ({
  accounts: [
    acc({
      id: 'id-livret-secret', name: 'Livret A', totalAmount: 20000.456, ownedAmount: 15000.004, parentalCapital: 5000.452, interestRate: 2.4, openingDate: '2019-03-01',
      movements: [mv('2026-07-05', 300), mv('2026-08-05', 200.333), mv('2026-10-05', 150, 'IN', 'Note privée sur ce versement'), mv('2026-10-10', 50, 'OUT')],
    }),
    acc({ id: 'pea', name: 'PEA Bourse', type: AccountType.PEA, totalAmount: 8000, ownedAmount: 8000, interestRate: 5, openingDate: '2023-02-01' }),
  ],
  expenses: [],
  history: [
    { date: '2026-08-31', totalAmount: 27000.111, ownedAmount: 22000 },
    { date: '2026-09-02', totalAmount: 27500, ownedAmount: 22400 },
    { date: '2026-09-30', totalAmount: 27800, ownedAmount: 22700 },
  ],
  subscriptions: [{ id: 's1', name: 'Musique', amount: 10.99, debitAccount: 'Carte', frequency: 'monthly', anchorDate: '2026-01-03', active: true },
    { id: 's2', name: 'Ancien', amount: 5, debitAccount: 'Carte', frequency: 'monthly', anchorDate: '2026-01-03', active: false }],
  recurringMovements: [{ id: 'r1', accountId: 'id-livret-secret', amount: 100, type: 'IN', label: 'Virement auto', dayOfMonth: 5, active: true }],
  payslips: [{
    id: 'p1', fileId: 'DRIVE-FILE-ID-123', fileName: 'paie-septembre.pdf', addedAt: '2026-09-30T10:00:00Z', reviewed: true,
    extracted: { employer: 'Employeur', period: '2026-09', netPaid: 2345.678, grossAmount: 3000 },
  }],
  donations: [{ id: 'd1', date: '2026-02-01', amount: 50, organization: 'Asso', rate: 66, receiptReceived: true, receiptFileId: 'RECEIPT-ID', note: 'NOTE-DON-PRIVEE' }],
  parentalRestitution: { plannedDate: '2027-01-01' },
  config: {
    grossAnnual: 36000, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0,
    geminiApiKey: 'AIza-SECRET-GEMINI', pickerApiKey: 'PICKER-SECRET', rfrByYear: { '2025': 28000 },
  },
  ...over,
} as GlobalAppData);

describe('buildAskSnapshot', () => {
  it('ne contient ni clé, ni identifiant Drive, ni texte libre, ni identifiant interne', () => {
    const { json } = buildAskSnapshot(base(), NOW);
    for (const secret of ['AIza-SECRET-GEMINI', 'PICKER-SECRET', 'DRIVE-FILE-ID-123', 'paie-septembre.pdf', 'RECEIPT-ID', 'NOTE-DON-PRIVEE', 'Note privée', 'id-livret-secret', 'Employeur', 'Virement auto', '@']) {
      expect(json).not.toContain(secret);
    }
  });

  it('arrondit les montants au centime et agrège ce qui est déjà calculé', () => {
    const { json, asOf, truncated } = buildAskSnapshot(base(), NOW, { monthPlan: 700.129 });
    const s = JSON.parse(json);
    expect(asOf).toBe('2026-10-28');
    expect(truncated).toBe(false);
    expect(s.totaux).toEqual({ solde: 28000.46, partPropre: 23000, capitalParental: 5000.45, nombreDeComptes: 2 });
    const livret = s.comptes.find((c: { nom: string }) => c.nom === 'Livret A');
    expect(livret).toMatchObject({ solde: 20000.46, partPropre: 15000, capitalParental: 5000.45, plafond: 22950, resteSousPlafond: 2949.54 });
    const pea = s.comptes.find((c: { nom: string }) => c.nom === 'PEA Bourse');
    expect(pea.maturiteFiscale.date).toBe('2028-02-01');
    // Épargne : octobre 150 − 50, trimestre (oct.) 100, depuis janvier 300 + 200,33 + 100.
    expect(s.epargne).toMatchObject({ ceMois: 100, ceTrimestre: 100, depuisLe1erJanvier: 600.33, prevueChaqueMois: 700.13 });
    expect(s.epargneParMois).toHaveLength(24);
    // Sans jour de paie : les mois d'épargne sont les mois civils.
    expect(s.epargne.moisEpargneEnCours).toBe('2026-10');
    expect(s.epargneParMois[23]).toEqual({ moisEpargne: '2026-10', depuisLe: '2026-10-01', epargne: 100 });
  });

  it("compte l'épargne par mois d'épargne avec un jour de paie (paie du 27 octobre = novembre)", () => {
    const data = base();
    const s = JSON.parse(buildAskSnapshot({ ...data, config: { ...data.config, paydayDay: 27 } }, NOW).json);
    expect(s.epargne.moisEpargneEnCours).toBe('2026-11');
    expect(s.epargne.note).toMatch(/mois d'épargne/);
    expect(s.epargneParMois).toHaveLength(24);
    expect(s.epargneParMois[23]).toMatchObject({ moisEpargne: '2026-11', depuisLe: '2026-10-27' });
    // Un relevé par mois : le dernier de septembre.
    expect(s.soldesParMois).toEqual([{ mois: '2026-08', total: 27000.11, partPropre: 22000 }, { mois: '2026-09', total: 27800, partPropre: 22700 }]);
    expect(s.abonnements).toEqual([{ nom: 'Musique', montant: 10.99, frequence: 'monthly', coutMensuel: 10.99, compteDebite: 'Carte' }]);
    expect(s.virementsRecurrents[0]).toMatchObject({ compte: 'Livret A', sens: 'versement', montant: 100, jourDuMois: 5 });
    expect(s.paieNetteParMois).toEqual([{ mois: '2026-09', netVerse: 2345.68, brut: 3000 }]);
    expect(s.restitutionParentale).toEqual({ faite: false, datePrevue: '2027-01-01', capitalParentalARendre: 5000.45 });
    expect(s.revenuFiscalDeReference).toEqual([{ anneeDesRevenus: 2025, rfr: 28000 }]);
    expect(s.interets.annee).toBe(2026);
    expect(s.interets.acquisADate).toBeGreaterThan(0);
    expect(s.aVenir60Jours.every((e: { date: string }) => e.date >= '2026-10-28' && e.date <= '2026-12-27')).toBe(true);
  });

  it('est déterministe : même document, même date, même texte', () => {
    expect(buildAskSnapshot(base(), NOW).json).toBe(buildAskSnapshot(base(), NOW).json);
  });

  it('raccourcit les listes au-delà de la taille maximale', () => {
    const many = Array.from({ length: 80 }, (_, i) => acc({ id: `a${i}`, name: `Compte numéro ${i} avec un nom assez long`, type: AccountType.ASSURANCE_VIE, totalAmount: 1000 + i }));
    const subs = Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, name: `Abonnement ${i}`, amount: 9.99, debitAccount: 'Carte', frequency: 'monthly' as const, anchorDate: '2026-01-03', active: true }));
    const data = base({ accounts: many, subscriptions: subs });
    expect(buildAskSnapshot(data, NOW, {}, 1_000_000).truncated).toBe(false);
    const r = buildAskSnapshot(data, NOW, {}, 8_000);
    expect(r.truncated).toBe(true);
    expect(r.json.length).toBeLessThanOrEqual(8_000);
    const s = JSON.parse(r.json);
    expect(s.tronque).toBe(true);
    // Le plus gros solde reste en tête.
    expect(s.comptes[0].nom).toBe('Compte numéro 79 avec un nom assez long');
    expect(ASK_SNAPSHOT_MAX_CHARS).toBeGreaterThan(8_000);
  });

  it('résume une restitution déjà faite et un document vide', () => {
    const done = base({ parentalRestitution: { done: { date: '2026-01-01', accounts: [{ accountId: 'x', name: 'Livret A', amount: 4000.004 }], interestsOffered: [] } } });
    expect(JSON.parse(buildAskSnapshot(done, NOW).json).restitutionParentale).toEqual({ faite: true, date: '2026-01-01', montantRendu: 4000 });
    const empty = buildAskSnapshot({ accounts: [], expenses: [], history: [], config: {} } as unknown as GlobalAppData, NOW, { taxEstimate: { taxDue: 1234.567, taxableIncome: 30000 } as never });
    const s = JSON.parse(empty.json);
    expect(s.comptes).toEqual([]);
    expect(s.restitutionParentale).toBeUndefined();
    expect(s.impot).toEqual({ annee: 2026, impotEstime: 1234.57, revenuImposableSalaires: 30000 });
  });
});
