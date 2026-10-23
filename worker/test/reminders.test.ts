import { describe, it, expect } from 'vitest';
import { computeReminders, parisCivilDate, applyDiscreetMode, isDiscreet, Reminder } from '../src/reminders';
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
    balanceCheckedAt: '2026-09-20',
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

  it('nomme les comptes dont le solde est à revérifier ; un versement prévu ne compte pas comme un constat', () => {
    // Livret : solde lu il y a plus de 90 jours, puis seulement des versements de la paie.
    const old = { ...livret, balanceCheckedAt: '2026-06-01', movements: [{ id: 'm', date: '2026-09-27', amount: 10, label: 'Épargne du mois', type: 'IN' as const }] };
    const r = computeReminders(base({ accounts: [old] }), new Date(2026, 8, 28, 9), APP);
    const stale = r.find(x => x.key.startsWith('stale:'))!;
    expect(stale.message.title).toBe('Solde à vérifier');
    expect(stale.message.body).toBe('Livret A (vérifié il y a 4 mois). Comparez avec votre banque, puis Actualiser.');
    // Mode discret : ni nom de compte ni montant sur l'écran verrouillé.
    expect(applyDiscreetMode([stale])[0].message.body).not.toContain('Livret A');
    // Même liste le lendemain : même clé (un seul envoi) ; un nouveau constat la change.
    const next = computeReminders(base({ accounts: [old] }), new Date(2026, 8, 29, 9), APP).find(x => x.key.startsWith('stale:'))!;
    expect(next.key).toBe(stale.key);
    const fresh = computeReminders(base({ accounts: [{ ...old, balanceCheckedAt: '2026-09-28' }] }), new Date(2026, 8, 29, 9), APP);
    expect(fresh.some(x => x.key.startsWith('stale:'))).toBe(false);
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
      const stale = computeReminders(base({ accounts: [{ ...livret, balanceCheckedAt: '2026-05-01' }] }), new Date(2026, 8, 28, 9), APP)
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

  describe('point de paie', () => {
    // Paie le 27 : la fenêtre « paie de septembre » va du 27 sept. au 26 oct. inclus.
    const acc = {
      id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B',
      totalAmount: 1620, ownedAmount: 1620, parentalCapital: 0, interestRate: 3,
      movements: [
        { id: 'a', date: '2026-09-01', amount: 1000, label: 'x', type: 'IN' as const },
        { id: 'b', date: '2026-10-05', amount: 620, label: 'x', type: 'IN' as const },
      ],
    };
    const data = (config: Partial<GlobalAppData['config']> = {}) => base({
      accounts: [acc],
      config: { ...base().config, paydayDay: 27, paydayAmount: 650, ...config },
    });
    const at = (d: GlobalAppData, day: number, month = 10) => computeReminders(d, { year: 2026, month, day }, APP);

    it('part le premier jour de la nouvelle fenêtre avec les chiffres de la paie écoulée', () => {
      const r = at(data({ notificationPrefs: { payday: false } }), 27).find(x => x.key === 'recap:2026-09');
      expect(r?.message.title).toBe('Point de paie de septembre');
      expect(r?.message.body).toMatch(/^\+620\s€ mis de côté sur la paie de septembre \(objectif 650\s€, bon mois ✓\) · série de 2 · épargne 1\s620\s€ \(\+62 %\) · ≈ \d+\s€ d'intérêts\.$/);
      expect(r?.message.url).toBe(APP);
    });

    it('rattrape 3 jours un cron manqué, puis se tait ; plus de bilan calendaire le 1er', () => {
      const keys = (day: number, month = 10) => at(data({ notificationPrefs: { payday: false } }), day, month).map(x => x.key).filter(k => k.startsWith('recap:'));
      expect(keys(26)).toEqual([]);
      expect(keys(29)).toEqual(['recap:2026-09']);
      expect(keys(30)).toEqual([]);
      expect(keys(1)).toEqual([]); // 1er octobre : la paie d'août s'est terminée le 27 septembre
    });

    it('sans gamification : ni « bon mois » ni « série », les chiffres restent', () => {
      const r = at(data({ gamification: false, notificationPrefs: { payday: false } }), 27).find(x => x.key === 'recap:2026-09');
      expect(r?.message.body).toMatch(/^\+620\s€ mis de côté sur la paie de septembre \(objectif 650\s€\) · épargne/);
      expect(r?.message.body).not.toMatch(/bon mois|série/);
    });

    it('le jour de paie, une seule notification : le bilan est replié dans le rappel de paie', () => {
      for (const day of [27, 28, 29]) {
        const r = at(data(), day);
        expect(r.some(x => x.key.startsWith('recap:'))).toBe(false);
        const pay = r.find(x => x.key === 'payday:2026-10');
        expect(pay?.message.body).toMatch(/Paie précédente : \+620\s€ mis de côté, bon mois ✓, série de 2\.$/);
      }
      const off = at(data({ gamification: false }), 27).find(x => x.key === 'payday:2026-10');
      expect(off?.message.body).toMatch(/Paie précédente : \+620\s€ mis de côté\.$/);
    });

    it('bilan désactivé : le rappel de paie reste tel quel', () => {
      const r = at(data({ notificationPrefs: { recap: false } }), 27);
      expect(r.find(x => x.key === 'payday:2026-10')?.message.body).not.toContain('Paie précédente');
    });

    it('sans jour de paie ni fiche de paie : bilan du mois calendaire du 1er au 3', () => {
      const d = data({ paydayDay: undefined });
      const r = at(d, 1).find(x => x.key.startsWith('recap:'));
      expect(r?.key).toBe('recap:2026-09');
      expect(r?.message.title).toBe('Bilan de septembre');
      expect(at(d, 27).some(x => x.key.startsWith('recap:'))).toBe(false);
    });

    it('en mode discret, aucun montant', () => {
      const [r] = applyDiscreetMode(at(data({ notificationPrefs: { payday: false } }), 27).filter(x => x.key.startsWith('recap:')));
      expect(r.message).toMatchObject({ title: 'Point de paie de septembre', body: 'Le point de paie est prêt.' });
    });
  });

  describe('relevés annuels (étape de la clôture)', () => {
    const pea = { ...livret, id: 'pea', name: 'PEA', type: AccountType.PEA, totalDeposits: 800 };
    it("n'envoient plus de rappel à part mi-janvier : la clôture nomme les placements à relever", () => {
      expect(computeReminders(base({ accounts: [livret, pea] }), new Date(2027, 0, 15, 9), APP).some(x => x.key.startsWith('annual-statement'))).toBe(false);
      const closing = computeReminders(base({ accounts: [livret, pea] }), new Date(2027, 0, 3, 9), APP).find(x => x.key === 'year-closing:2026');
      expect(closing?.message.body).toContain('relevés de PEA');
      expect(closing?.message.body).not.toContain('relevés de Livret A');
    });
    it('ne nomme pas un placement dont la valeur est déjà reportée cette année', () => {
      const updated = { ...pea, movements: [...pea.movements, { id: 'v', date: '2027-01-02', amount: 40, label: 'Valorisation (+)', type: 'IN' as const, kind: 'valuation' as const }] };
      const closing = computeReminders(base({ accounts: [updated] }), new Date(2027, 0, 3, 9), APP).find(x => x.key === 'year-closing:2026');
      expect(closing?.message.body).not.toContain('relevés');
    });
  });

  describe('déclaration de revenus', () => {
    const donations = [
      { id: 'd1', date: '2026-03-01', amount: 100, organization: 'Restos du cœur', rate: 75 as const, receiptReceived: true },
      { id: 'd2', date: '2026-11-20', amount: 50, organization: 'MSF', rate: 66 as const, receiptReceived: false },
      { id: 'd3', date: '2027-01-05', amount: 999, organization: 'Hors période', rate: 66 as const, receiptReceived: false },
    ];
    it("rappelle en avril la déclaration, avec les dons de l'année écoulée et les reçus manquants", () => {
      const r = computeReminders(base({ donations }), new Date(2027, 3, 10, 9), APP).find(x => x.key === 'tax-return:2026');
      expect(r?.message.title).toBe('Déclaration des revenus 2026');
      expect(r?.message.body).toMatch(/À vérifier : vos dons \(7UD, 7UF\)/);
      expect(r?.message.body).toMatch(/fin mai ou début juin selon votre département/);
      expect(r?.message.body).toMatch(/Dons : 150\s€, ≈ 108\s€ de réduction d'impôt, 1 reçu fiscal manquant/);
      expect(r?.message.url).toBe(`${APP}?view=donations`);
      expect(computeReminders(base({ donations }), new Date(2027, 3, 25, 9), APP).some(x => x.key.startsWith('tax-return'))).toBe(false);
    });

    it('rappelle la déclaration à tout le monde, même sans don, avec les comptes à déclarer', () => {
      const crypto = { id: 'c', name: 'Binance', type: AccountType.CRYPTO, institution: 'Binance', totalAmount: 500, ownedAmount: 500, parentalCapital: 0, heldAbroad: true, movements: [] };
      const r = computeReminders(base({ accounts: [crypto] }), new Date(2027, 3, 12, 9), APP).find(x => x.key === 'tax-return:2026');
      expect(r?.message.body).toMatch(/1 compte à l'étranger \(8UU\)/);
      expect(r?.message.body).not.toMatch(/Dons/);
      const none = computeReminders(base(), new Date(2027, 3, 12, 9), APP).find(x => x.key === 'tax-return:2026');
      expect(none?.message.body).toBe('La déclaration en ligne ouvre en avril ; la date limite tombe fin mai ou début juin selon votre département.');
    });
  });

  describe('paramètres fiscaux', () => {
    it('rappelle fin janvier de vérifier les paramètres, sauf si déjà fait', () => {
      const at = (reviewed?: number) => computeReminders(base({ fiscalConfig: { ...DEFAULT_FISCAL_CONFIG, paramsReviewedYear: reviewed } }), new Date(2027, 0, 20, 9), APP)
        .find(x => x.key === 'fiscal-review:2027');
      expect(at()?.message.url).toBe(`${APP}?view=settings&section=fiscal`);
      expect(at(2027)).toBeUndefined();
    });
    it("se tait tant que la clôture de l'année écoulée est ouverte (c'en est une étape), revient une fois clôturée", () => {
      const fiscal = (config?: Record<string, unknown>) => computeReminders(base({ accounts: [livret], ...(config ? { config: { ...base().config, ...config } } : {}) }), new Date(2027, 0, 20, 9), APP)
        .some(x => x.key === 'fiscal-review:2027');
      expect(fiscal()).toBe(false);
      expect(fiscal({ yearClosings: { 2026: { closedOn: '2027-01-12' } } })).toBe(true);
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
    it('compte la somme en plus saisie dans le Pilotage pour cette paie, pas celle de la paie précédente', () => {
      // Rien à placer d'habitude (0 €) : seule la prime saisie pour cette paie crée la ligne d'épargne.
      const withExtra = (period?: string) => {
        const d = data();
        return { ...d, config: { ...d.config, paydayAmount: 0, ...(period ? { payAdjustment: { period, extra: 300 } } : {}) } };
      };
      expect(at(withExtra(), 30)?.message.title).toBe('1 virement de paie à faire ou à cocher');
      expect(at(withExtra('2026-09'), 30)?.message.title).toBe('2 virements de paie à faire ou à cocher');
      expect(at(withExtra('2026-08'), 30)?.message.title).toBe('1 virement de paie à faire ou à cocher');
      // Le rappel du jour de paie annonce le même objectif que le Pilotage.
      const pay = (d: GlobalAppData) => computeReminders(d, new Date(2026, 8, 27, 9), APP).find(x => x.key === 'payday:2026-09')?.message.title;
      const d = data();
      expect(pay({ ...d, config: { ...d.config, payAdjustment: { period: '2026-09', extra: 300 } } })).toMatch(/^Salaire versé : 800\s€ à placer$/);
      expect(pay({ ...d, config: { ...d.config, payAdjustment: { period: '2026-08', extra: 300 } } })).toMatch(/^Salaire versé : 500\s€ à placer$/);
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

  describe("clôture de l'année", () => {
    it('une seule notification début janvier, vers Historique, avec les chiffres du bilan', () => {
      const r = computeReminders(base({ accounts: [livret] }), new Date(2027, 0, 2, 9), APP).filter(x => x.key.startsWith('year-'));
      expect(r.map(x => x.key)).toEqual(['year-closing:2026']);
      expect(r[0].message.title).toBe("Clôture de l'année 2026");
      expect(r[0].message.body).toMatch(/mis de côté, .*d'intérêts\. Soldes au 31 décembre, intérêts, paramètres fiscaux, bilan et archive : tout est dans Historique, étape par étape\.$/);
      expect(r[0].message.url).toBe(`${APP}?view=history`);
      expect(applyDiscreetMode(r)[0].message.body).toBe('La clôture de l’année est prête dans Historique.');
      // Fenêtre d'une semaine pour un cron manqué, puis plus rien.
      expect(computeReminders(base({ accounts: [livret] }), new Date(2027, 0, 8, 9), APP).some(x => x.key === 'year-closing:2026')).toBe(true);
      expect(computeReminders(base({ accounts: [livret] }), new Date(2027, 0, 10, 9), APP).some(x => x.key.startsWith('year-'))).toBe(false);
    });
    it("se tait si l'année est déjà clôturée dans l'app, ou sans compte", () => {
      const closed = base({ accounts: [livret], config: { ...base().config, yearClosings: { 2026: { closedOn: '2027-01-02' } } } });
      expect(computeReminders(closed, new Date(2027, 0, 3, 9), APP).some(x => x.key.startsWith('year-closing'))).toBe(false);
      expect(computeReminders(base(), new Date(2027, 0, 3, 9), APP).some(x => x.key.startsWith('year-closing'))).toBe(false);
      // Tout nouvel utilisateur (compte ajouté en janvier) : rien à clôturer.
      const added = { ...livret, movements: [{ id: 'i', date: '2027-01-02', amount: 1000, label: 'Solde initial', type: 'IN' as const, tag: 'initial' as const }] };
      expect(computeReminders(base({ accounts: [added] }), new Date(2027, 0, 3, 9), APP).some(x => x.key.startsWith('year-closing'))).toBe(false);
    });
  });
});

describe('fuseau Europe/Paris', () => {
  const livret = {
    id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B',
    totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, interestRate: 3,
    movements: [{ id: 'm', date: '2026-09-20', amount: 10, label: 'x', type: 'IN' as const }],
  };

  it("donne le jour parisien, pas le jour UTC, autour des changements d'heure", () => {
    // Passage à l'heure d'été (29 mars 2026, 2 h → 3 h) : UTC+1 avant, UTC+2 après.
    expect(parisCivilDate(new Date('2026-03-28T22:59:00Z'))).toEqual({ year: 2026, month: 3, day: 28 });
    expect(parisCivilDate(new Date('2026-03-28T23:30:00Z'))).toEqual({ year: 2026, month: 3, day: 29 });
    expect(parisCivilDate(new Date('2026-03-29T21:59:00Z'))).toEqual({ year: 2026, month: 3, day: 29 });
    expect(parisCivilDate(new Date('2026-03-29T22:30:00Z'))).toEqual({ year: 2026, month: 3, day: 30 });
    // Retour à l'heure d'hiver (25 octobre 2026, 3 h → 2 h) : UTC+2 avant, UTC+1 après.
    expect(parisCivilDate(new Date('2026-10-24T22:30:00Z'))).toEqual({ year: 2026, month: 10, day: 25 });
    expect(parisCivilDate(new Date('2026-10-25T22:30:00Z'))).toEqual({ year: 2026, month: 10, day: 25 });
    expect(parisCivilDate(new Date('2026-10-25T23:30:00Z'))).toEqual({ year: 2026, month: 10, day: 26 });
  });

  it("change de mois et d'année à minuit à Paris", () => {
    expect(parisCivilDate(new Date('2026-09-30T22:30:00Z'))).toEqual({ year: 2026, month: 10, day: 1 });
    expect(parisCivilDate(new Date('2026-12-31T22:59:00Z'))).toEqual({ year: 2026, month: 12, day: 31 });
    expect(parisCivilDate(new Date('2026-12-31T23:00:00Z'))).toEqual({ year: 2027, month: 1, day: 1 });
  });

  it('le bilan mensuel suit le 1er du mois parisien, même encore la veille en UTC', () => {
    const data = base({ accounts: [livret] });
    const keys = (d: Date) => computeReminders(data, d, APP).map(r => r.key);
    expect(keys(new Date('2026-09-30T22:30:00Z'))).toContain('recap:2026-09');     // 1er oct. 00:30 à Paris
    expect(keys(new Date('2026-09-30T21:30:00Z'))).not.toContain('recap:2026-09'); // 30 sept. 23:30
    expect(keys(new Date('2026-12-31T23:30:00Z'))).toContain('recap:2026-12');     // 1er janv. 2027
  });

  it('accepte une date civile explicite, et la clé mensuelle suit ce mois', () => {
    const data = base({
      accounts: [livret],
      recurringMovements: [{ id: 'r1', accountId: 'la', amount: 200, type: 'IN', label: 'x', dayOfMonth: 1, active: true }],
    });
    const r = computeReminders(data, { year: 2026, month: 10, day: 1 }, APP);
    expect(r.map(x => x.key)).toContain('recurring:r1:2026-10');
  });

  it("compte les jours sans mise à jour en jours civils, à travers le changement d'heure", () => {
    // Compte courant : à revérifier au bout de 30 jours.
    const acc = { ...livret, type: AccountType.COMPTE_COURANT, name: 'Compte courant', balanceCheckedAt: '2026-09-25', movements: [] };
    const stale = (day: number) => computeReminders(base({ accounts: [acc] }), { year: 2026, month: 10, day }, APP).some(r => r.key.startsWith('stale:'));
    expect(stale(24)).toBe(false); // 29 jours
    expect(stale(25)).toBe(true);  // 30 jours, jour du passage à l'heure d'hiver
    expect(stale(26)).toBe(true);
  });

  it('la fenêtre de paie suit le jour parisien', () => {
    const lep = { ...livret, id: 'lep', name: 'LEP', type: AccountType.LEP, totalAmount: 9600, ownedAmount: 9600, interestRate: 3.5 };
    const data = base({ accounts: [lep], config: { ...base().config, paydayDay: 1, paydayAmount: 100 } });
    const keys = (d: Date) => computeReminders(data, d, APP).map(r => r.key);
    expect(keys(new Date('2026-09-30T22:30:00Z'))).toContain('payday:2026-10');
    expect(keys(new Date('2026-09-30T21:30:00Z'))).not.toContain('payday:2026-10');
  });
});

describe('mode discret', () => {
  const r = (key: string, title: string, body: string): Reminder => ({ key, message: { title, body, url: `${APP}?view=x`, tag: key } });

  it('remplace les corps chiffrés par un texte générique par type, garde titres, liens et clés', () => {
    const out = applyDiscreetMode([
      r('recurring:r1:2026-10', 'Échéance : Épargne auto', "+200 € sur Livret A — à enregistrer dans l'app."),
      r('sub:n:2026-10-05', 'Prélèvement demain : Netflix', '13,49 € sur Compte BP, lundi 5 octobre.'),
      r('recap:2026-09', 'Bilan de septembre', '+300 € placés · épargne 1 300 €.'),
      r('rates:2026-08', 'Taux réglementés révisés', 'Révision du 1er août : pensez à mettre à jour Livret A.'),
    ]);
    expect(out.map(x => x.message.body)).toEqual([
      'Une échéance est à enregistrer dans l’app.',
      'Un prélèvement approche : le détail est dans l’app.',
      'Le point de paie est prêt.',
      'Révision du 1er août : pensez à mettre à jour Livret A.', // sans montant : inchangé
    ]);
    expect(out.map(x => x.message.title)).toEqual(['Échéance : Épargne auto', 'Prélèvement demain : Netflix', 'Bilan de septembre', 'Taux réglementés révisés']);
    expect(out.map(x => x.key)).toEqual(['recurring:r1:2026-10', 'sub:n:2026-10-05', 'recap:2026-09', 'rates:2026-08']);
    expect(out.every(x => x.message.url === `${APP}?view=x`)).toBe(true);
  });

  it('retire aussi les montants des titres qui en portent', () => {
    const [pay, don, unknown] = applyDiscreetMode([
      r('payday:2026-10', 'Salaire versé : 2 000 € à placer', '900 € Revolut commun · Épargne : 500 € sur Livret A.'),
      r('tax-return:2026', 'Déclaration des revenus 2026', 'À vérifier : vos dons (7UD, 7UF). Dons : 150 €, ≈ 108 € de réduction.'),
      r('nouveau:1', 'Titre 12 €', 'Corps 12 €'),
    ]);
    expect(pay.message).toMatchObject({ title: 'Salaire versé', body: 'Votre rappel de paie est prêt.' });
    // Un titre sans montant (l'année seule) est gardé ; le corps devient générique.
    expect(don.message).toMatchObject({ title: 'Déclaration des revenus 2026', body: 'Votre aide à la déclaration de revenus est prête dans l’app.' });
    expect(unknown.message).toMatchObject({ title: 'Pécule', body: 'Ouvrez Pécule pour voir le détail.' });
    expect(JSON.stringify([pay, don, unknown].map(x => x.message))).not.toMatch(/\d\s?€/);
  });

  it('ne s’active que si config.discreetNotifications vaut true', () => {
    expect(isDiscreet(base())).toBe(false);
    expect(isDiscreet(base({ config: { ...base().config, discreetNotifications: true } as any }))).toBe(true);
    expect(isDiscreet(base({ config: { ...base().config, discreetNotifications: 'yes' } as any }))).toBe(false);
  });

  it('sur des rappels réels, aucun montant ne subsiste', () => {
    const data = base({
      accounts: [{ id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'B', totalAmount: 1300, ownedAmount: 1300, parentalCapital: 0, interestRate: 3,
        movements: [{ id: 'a', date: '2026-08-10', amount: 1000, label: 'x', type: 'IN' as const }, { id: 'b', date: '2026-09-05', amount: 300, label: 'x', type: 'IN' as const }] }],
      config: { ...base().config, paydayDay: 1, paydayAmount: 300 },
    });
    const raw = computeReminders(data, { year: 2026, month: 10, day: 1 }, APP);
    expect(raw.some(x => /€/.test(x.message.body))).toBe(true);
    const out = applyDiscreetMode(raw);
    expect(out.some(x => /€/.test(x.message.title + x.message.body))).toBe(false);
  });
});
