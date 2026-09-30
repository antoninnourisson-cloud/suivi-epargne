import { describe, it, expect } from 'vitest';
import { computeReminders } from '../src/reminders';
import { AccountType, GlobalAppData } from '../../src/types';

const base = (over: Partial<GlobalAppData> = {}): GlobalAppData => ({
  accounts: [], expenses: [], history: [],
  config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0 },
  ...over,
});
const APP = 'https://example.github.io/app/';

describe('computeReminders', () => {
  const livret = {
    id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B',
    totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, interestRate: 3,
    movements: [{ id: 'm', date: '2026-09-20', amount: 10, label: 'x', type: 'IN' as const }],
  };

  it("n'envoie rien quand rien n'est à signaler", () => {
    expect(computeReminders(base({ accounts: [livret] }), new Date(2026, 8, 28, 9), APP)).toEqual([]);
  });

  it('annonce une échéance récurrente due, avec une clé propre au mois', () => {
    const data = base({
      accounts: [livret],
      recurringMovements: [{ id: 'r1', accountId: 'la', amount: 200, type: 'IN', label: 'Épargne auto', dayOfMonth: 5, active: true }],
    });
    const r = computeReminders(data, new Date(2026, 8, 28, 9), APP);
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('recurring:r1:2026-09');
    expect(r[0].message.body).toContain('Livret A');
  });

  it('signale la révision des taux dans sa fenêtre', () => {
    const r = computeReminders(base({ accounts: [livret] }), new Date(2026, 1, 10, 9), APP);
    expect(r.map(x => x.key)).toContain('rates:2026-02');
  });

  it("n'annonce les intérêts parentaux qu'en décembre, et seulement s'il y en a", () => {
    const withParents = { ...livret, totalAmount: 2000, ownedAmount: 1000, parentalCapital: 1000, movements: [{ id: 'm', date: '2026-12-01', amount: 1, label: 'x', type: 'IN' as const }] };
    const dec = computeReminders(base({ accounts: [withParents] }), new Date(2026, 11, 15, 9), APP);
    expect(dec.map(x => x.key)).toContain('parental:2026');
    const nov = computeReminders(base({ accounts: [withParents] }), new Date(2026, 10, 15, 9), APP);
    expect(nov.map(x => x.key)).not.toContain('parental:2026');
  });

  it('rappelle une actualisation après 30 jours sans mouvement, une fois par dernière date', () => {
    const old = { ...livret, movements: [{ id: 'm', date: '2026-07-01', amount: 10, label: 'x', type: 'IN' as const }] };
    const r = computeReminders(base({ accounts: [old] }), new Date(2026, 8, 28, 9), APP);
    expect(r.map(x => x.key)).toContain('stale:2026-07-01');
  });

  describe('jour de paie', () => {
    const lep = { ...livret, id: 'lep', name: 'LEP', type: AccountType.LEP, totalAmount: 9600, ownedAmount: 9600, interestRate: 3.5 };
    const livA = { ...livret, totalAmount: 1000, ownedAmount: 1000, interestRate: 2.4 };
    const withPayday = (paydayDay: number, paydayAmount?: number) => base({
      accounts: [lep, livA],
      config: { ...base().config, paydayDay, paydayAmount },
    });

    it('annonce le plan de placement le jour de paie (LEP plein en premier)', () => {
      const r = computeReminders(withPayday(28, 650), new Date(2026, 8, 28, 9), APP)
        .filter(x => x.key.startsWith('payday'));
      expect(r).toHaveLength(1);
      expect(r[0].key).toBe('payday:2026-09');
      // Plafond LEP par défaut 10 000 € : 400 € de place, le reste sur le Livret A.
      expect(r[0].message.body).toMatch(/400.*LEP.*250.*Livret A/);
    });

    it('reste valable 3 jours puis se tait', () => {
      const keys = (d: Date) => computeReminders(withPayday(25, 100), d, APP).map(x => x.key);
      expect(keys(new Date(2026, 8, 24, 9))).not.toContain('payday:2026-09');
      expect(keys(new Date(2026, 8, 27, 9))).toContain('payday:2026-09');
      expect(keys(new Date(2026, 8, 28, 9))).not.toContain('payday:2026-09');
    });

    it('ramène le 31 au dernier jour des mois courts', () => {
      const r = computeReminders(withPayday(31, 100), new Date(2026, 8, 30, 9), APP);
      expect(r.map(x => x.key)).toContain('payday:2026-09');
    });

    it("sans montant saisi, prend la capacité calculée du Pilotage et se tait si elle est nulle", () => {
      const data = withPayday(28);
      expect(computeReminders(data, new Date(2026, 8, 28, 9), APP).map(x => x.key)).not.toContain('payday:2026-09');
      data.config.grossAnnual = 45000;
      const r = computeReminders(data, new Date(2026, 8, 28, 9), APP).find(x => x.key === 'payday:2026-09');
      expect(r?.message.title).toMatch(/à placer/);
    });
  });

  describe('abonnements', () => {
    const subs = [
      { id: 'n', name: 'Netflix', amount: 13.49, debitAccount: 'Compte BP', frequency: 'monthly' as const, anchorDate: '2026-09-05', active: true },
      { id: 'a', name: 'Assurance auto', amount: 420, debitAccount: '', frequency: 'yearly' as const, anchorDate: '2025-10-05', active: true },
    ];
    const at = (d: Date) => computeReminders(base({ subscriptions: subs }), d, APP).filter(r => r.key.startsWith('sub:'));

    it('prévient une semaine avant pour 100 € et plus, la veille sinon', () => {
      const week = at(new Date(2026, 8, 28, 9));
      expect(week.map(r => r.key)).toEqual(['sub:a:2026-10-05']);
      expect(week[0].message.title).toBe('Prélèvement dans 7 jours : Assurance auto');
      const eve = at(new Date(2026, 9, 4, 9));
      expect(eve.map(r => r.key)).toEqual(['sub:n:2026-10-05', 'sub:a:2026-10-05']);
      expect(eve[0].message.body).toContain('Compte BP');
      expect(eve[0].message.title).toBe('Prélèvement demain : Netflix');
    });
  });
});
