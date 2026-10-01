import { describe, it, expect } from 'vitest';
import { computeReminders } from '../src/reminders';
import { AccountType, GlobalAppData } from '../../src/types';
import { DEFAULT_FISCAL_CONFIG } from '../../src/constants';

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

  describe('liens et bilan mensuel', () => {
    it("ouvre l'écran concerné au clic", () => {
      const data = base({
        accounts: [livret],
        recurringMovements: [{ id: 'r1', accountId: 'la', amount: 200, type: 'IN', label: 'x', dayOfMonth: 5, active: true }],
      });
      const r = computeReminders(data, new Date(2026, 8, 28, 9), APP);
      expect(r[0].message.url).toBe(APP); // échéance → Dashboard
      const stale = computeReminders(base({ accounts: [{ ...livret, movements: [{ id: 'm', date: '2026-07-01', amount: 1, label: 'x', type: 'IN' as const }] }] }), new Date(2026, 8, 28, 9), APP)
        .find(x => x.key.startsWith('stale:'));
      expect(stale?.message.url).toBe(`${APP}?view=update`);
    });

    it('envoie le bilan du mois écoulé les 3 premiers jours', () => {
      const acc = { ...livret, totalAmount: 1300, ownedAmount: 1300, movements: [
        { id: 'a', date: '2026-08-10', amount: 1000, label: 'x', type: 'IN' as const },
        { id: 'b', date: '2026-09-05', amount: 300, label: 'x', type: 'IN' as const },
      ] };
      const data = base({ accounts: [acc], config: { ...base().config, paydayAmount: 300 } });
      const r = computeReminders(data, new Date(2026, 9, 1, 9), APP).find(x => x.key === 'recap:2026-09');
      expect(r?.message.title).toBe('Bilan de septembre');
      expect(r?.message.body).toMatch(/\+300\s€ placés \(objectif 300\s€\)/);
      expect(r?.message.body).not.toContain('% de ta paie'); // paie inconnue dans ce jeu de test
      expect(r?.message.body).toMatch(/\+30 %/);
      expect(computeReminders(data, new Date(2026, 9, 4, 9), APP).some(x => x.key.startsWith('recap:'))).toBe(false);
    });

    it('détaille toute la paie dans le rappel du jour de paie', () => {
      const data = base({
        accounts: [livret],
        expenses: [{ id: 'e', name: 'Revolut commun', amount: 900 }],
        subscriptions: [{ id: 's', name: 'Spotify', amount: 11, debitAccount: 'Revolut perso', frequency: 'monthly', anchorDate: '2026-01-10', active: true }],
        config: { ...base().config, leisureBudget: 750, projectSavings: 200, paydayDay: 28, paydayAmount: 500 },
      });
      const r = computeReminders(data, new Date(2026, 8, 28, 9), APP).find(x => x.key === 'payday:2026-09');
      expect(r?.message.body).toMatch(/900.*Revolut commun · 11.*Abonnements \(Revolut perso\) · 200.*Épargne projets · 750.*Argent plaisir.*Épargne : 500.*Livret A/);
      expect(r?.message.url).toBe(`${APP}?view=pilot`);
    });
  });

  describe('relevés annuels', () => {
    const pea = { ...livret, id: 'pea', name: 'PEA', type: AccountType.PEA, totalDeposits: 800 };
    it('rappelle mi-janvier les placements non actualisés, pas les livrets', () => {
      const r = computeReminders(base({ accounts: [livret, pea] }), new Date(2027, 0, 15, 9), APP).find(x => x.key === 'annual-statement:2027');
      expect(r?.message.body).toContain('PEA');
      expect(r?.message.body).not.toContain('Livret A');
      expect(r?.message.url).toBe(`${APP}?view=update`);
    });
    it('se tait si la valeur a déjà été reportée cette année', () => {
      const updated = { ...pea, movements: [{ id: 'v', date: '2027-01-08', amount: 40, label: 'Valorisation (+)', type: 'IN' as const, kind: 'valuation' as const }] };
      expect(computeReminders(base({ accounts: [updated] }), new Date(2027, 0, 15, 9), APP).some(x => x.key.startsWith('annual-statement'))).toBe(false);
    });
  });

  describe('dons', () => {
    const donations = [
      { id: 'd1', date: '2026-03-01', amount: 100, organization: 'Restos du cœur', rate: 75 as const, receiptReceived: true },
      { id: 'd2', date: '2026-11-20', amount: 50, organization: 'MSF', rate: 66 as const, receiptReceived: false },
      { id: 'd3', date: '2027-01-05', amount: 999, organization: 'Hors période', rate: 66 as const, receiptReceived: false },
    ];
    it("rappelle en avril les dons de l'année écoulée et les reçus manquants", () => {
      const r = computeReminders(base({ donations }), new Date(2027, 3, 10, 9), APP).find(x => x.key === 'donations:2026');
      expect(r?.message.title).toMatch(/150\s€ de dons en 2026/);
      expect(r?.message.body).toMatch(/108\s€ de réduction.*1 reçu fiscal manquant/);
      expect(r?.message.url).toBe(`${APP}?view=donations`);
      expect(computeReminders(base({ donations }), new Date(2027, 3, 25, 9), APP).some(x => x.key.startsWith('donations'))).toBe(false);
    });
  });

  describe('paramètres fiscaux', () => {
    it('rappelle fin janvier de vérifier les paramètres, sauf si déjà fait', () => {
      const at = (reviewed?: number) => computeReminders(base({ fiscalConfig: { ...DEFAULT_FISCAL_CONFIG, paramsReviewedYear: reviewed } }), new Date(2027, 0, 20, 9), APP)
        .find(x => x.key === 'fiscal-review:2027');
      expect(at()?.message.url).toBe(`${APP}?view=settings`);
      expect(at(2027)).toBeUndefined();
    });
  });

  describe('relance des virements de paie', () => {
    const data = (done?: Record<string, { amount: number }>) => base({
      accounts: [livret],
      expenses: [{ id: 'e', name: 'Revolut commun', amount: 900 }],
      config: { ...base().config, paydayDay: 27, paydayAmount: 500 },
      payChecklist: done ? {
        month: '2026-09',
        lines: [
          { key: 't:Revolut commun', label: 'Revolut commun', amount: 900, kind: 'transfer' },
          { key: 's:la', label: 'Livret A', amount: 500, kind: 'saving', accountId: 'la' },
        ],
        done,
      } : undefined,
    });
    const at = (d: ReturnType<typeof data>, day: number) => computeReminders(d, new Date(2026, 8, day, 9), APP).find(x => x.key === 'payday-followup:2026-09');

    it('relance 3 jours après la paie les virements non cochés', () => {
      const r = at(data({ 't:Revolut commun': { amount: 900 } }), 30);
      expect(r?.message.title).toBe('1 virement de paie à faire ou à cocher');
      expect(r?.message.body).toContain('Livret A');
      expect(r?.message.body).not.toContain('Revolut commun');
    });
    it("relance tout si la liste n'a pas été touchée, et rien avant le délai", () => {
      expect(at(data(), 30)?.message.title).toBe('2 virements de paie à faire ou à cocher');
      expect(at(data(), 28)).toBeUndefined();
    });
    it('se tait quand tout est coché', () => {
      expect(at(data({ 't:Revolut commun': { amount: 900 }, 's:la': { amount: 500 } }), 30)).toBeUndefined();
    });
  });

  describe('restitution du capital parental', () => {
    const lep = { ...livret, id: 'lep', name: 'LEP', type: AccountType.LEP, totalAmount: 10000, ownedAmount: 1754, parentalCapital: 8246, interestRate: 2.4 };
    const data = (done = false) => base({ accounts: [lep], parentalRestitution: { plannedDate: '2027-01-01', ...(done ? { done: { date: '2027-01-01', accounts: [], interestsOffered: [] } } : {}) } });
    const keys = (d: ReturnType<typeof data>, date: Date) => computeReminders(d, date, APP).map(x => x.key);

    it('prévient début décembre puis le jour J', () => {
      expect(keys(data(), new Date(2026, 11, 1, 9))).toContain('restitution-prep:2027-01-01');
      expect(keys(data(), new Date(2026, 11, 10, 9))).not.toContain('restitution-prep:2027-01-01');
      const day = computeReminders(data(), new Date(2027, 0, 1, 9), APP).find(x => x.key === 'restitution-day:2027-01-01');
      expect(day?.message.title).toMatch(/8\s246\s€ à rendre/);
      expect(day?.message.url).toBe(`${APP}?view=parental`);
    });
    it('se tait une fois la restitution enregistrée', () => {
      expect(keys(data(true), new Date(2027, 0, 1, 9)).some(k => k.startsWith('restitution'))).toBe(false);
    });
  });
});
