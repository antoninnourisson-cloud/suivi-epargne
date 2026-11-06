import { describe, it, expect } from 'vitest';
import { migrate, canonicalize, isFromNewerApp, validateImport, withoutDeviceOnlyFields, APP_SCHEMA_VERSION, stableStringify } from './schema';
import { DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../constants';

describe('migrate', () => {
  it('donne un document complet à partir de rien', () => {
    const d = migrate(null);
    expect(d.accounts).toEqual([]);
    expect(d.config.grossAnnual).toBe(45000);
    expect(d.schemaVersion).toBe(APP_SCHEMA_VERSION);
    expect(d.fiscalConfig?.decote?.single).toBe(897);
  });
  it('conserve les champs inconnus (ajoutés par une version plus récente)', () => {
    const d = migrate({ accounts: [], config: { grossAnnual: 30000, futureField: 1 }, futureTop: { a: 1 } }) as any;
    expect(d.futureTop).toEqual({ a: 1 });
    expect(d.config.futureField).toBe(1);
    expect(d.config.grossAnnual).toBe(30000);
  });
  it("reprend l'ancien Navigo stocké dans config", () => {
    const d = migrate({ accounts: [], config: { navigoBase: 86.4, navigoRate: 50 } });
    expect(d.workBenefits?.navigo).toEqual({ active: true, basePrice: 86.4, refundRate: 50 });
  });
  it('est idempotente', () => {
    const raw = { accounts: [{ id: 'a', name: ' Livret  A ', institution: 'B', type: 'Livret A', totalAmount: 1, ownedAmount: 1, parentalCapital: 0 }], config: {} };
    expect(canonicalize(migrate(raw))).toBe(canonicalize(raw));
  });
  it('ne garde pas la vue courante', () => {
    expect((migrate({ accounts: [], lastView: 'agenda' }) as any).lastView).toBeUndefined();
  });
});

describe('canonicalize', () => {
  it("ignore l'ordre des clés, la vue et la clé Gemini", () => {
    const a = { accounts: [], config: { grossAnnual: 1, leisureBudget: 2 }, lastView: 'x' };
    const b = { config: { leisureBudget: 2, grossAnnual: 1, geminiApiKey: 'secret' }, accounts: [] };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
  it('détecte un vrai changement', () => {
    expect(canonicalize({ accounts: [], config: { grossAnnual: 1 } })).not.toBe(canonicalize({ accounts: [], config: { grossAnnual: 2 } }));
  });
});

describe('garde-fous', () => {
  it('repère un fichier écrit par une version plus récente', () => {
    expect(isFromNewerApp({ schemaVersion: APP_SCHEMA_VERSION + 1 })).toBe(true);
    expect(isFromNewerApp({ schemaVersion: APP_SCHEMA_VERSION })).toBe(false);
    expect(isFromNewerApp({})).toBe(false);
  });
  it("schéma v3 : une app d'avant les paies reçues (v2) n'écrit pas ce fichier ; une plus récente ne le défait pas", () => {
    // L'app v2 déjà installée compare au numéro 2 : un fichier v3 est « plus récent », elle
    // refuse d'écrire et demande une mise à jour (useDriveSync, état « outdated »).
    expect(APP_SCHEMA_VERSION).toBe(3);
    expect((migrate({}).schemaVersion ?? 0) > 2).toBe(true);
    const pays = [{ id: 'p', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {}, futur: 1 }];
    const v4 = { schemaVersion: APP_SCHEMA_VERSION + 1, pays, config: { paydayDay: 27, payReviewsDone: ['2026-11'] }, nouveau: { x: 1 } };
    expect(isFromNewerApp(v4)).toBe(true);
    const m = migrate(v4) as unknown as Record<string, unknown> & ReturnType<typeof migrate>;
    // Lu pour l'affichage sans rien perdre : paies et champs inconnus gardés, points de paie
    // validés jamais reconvertis (déjà au mois d'épargne).
    expect(m.pays).toEqual(pays);
    expect(m.nouveau).toEqual({ x: 1 });
    expect(m.config.payReviewsDone).toEqual(['2026-11']);
    // Un fichier v3 relu ne bouge plus.
    const v3 = { ...v4, schemaVersion: 3 };
    expect(migrate(migrate(v3))).toEqual(migrate(v3));
    expect(migrate(v3).config.payReviewsDone).toEqual(['2026-11']);
  });
  it("schéma v2 sans liste ni réglage de la paie : rien d'inventé", () => {
    const m = migrate({ schemaVersion: 2, config: { paydayDay: 27, payReviewsDone: ['2026-09'] } });
    expect(m.pays).toEqual([]);
    expect(m.config.payReviewsDone).toEqual(['2026-10']);
    // Sans jour de paie, mois de versement = mois d'épargne (mois civils).
    expect(migrate({ schemaVersion: 2, config: { payReviewsDone: ['2026-09', 'vu'] } }).config.payReviewsDone).toEqual(['2026-09', 'vu']);
    // Paie le 5 : la paie d'octobre finance octobre.
    expect(migrate({ schemaVersion: 2, config: { paydayDay: 5, payReviewsDone: ['2026-12'] } }).config.payReviewsDone).toEqual(['2026-12']);
    expect(migrate({ schemaVersion: 2, config: { paydayDay: 27, payReviewsDone: ['2026-12'] } }).config.payReviewsDone).toEqual(['2027-01']);
  });
  it('liste de la paie (v2) : reprise par une paie déjà déclarée pour ce mois si elle est vide, sinon la paie gagne', () => {
    const checklist = { month: '2026-10', lines: [{ key: 's:la', label: 'Livret A', amount: 500, kind: 'saving' }], done: { 's:la': { amount: 500 } } };
    const empty = { id: 'p', receivedOn: '2026-10-26', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} };
    expect(migrate({ config: { paydayDay: 27 }, pays: [empty], payChecklist: checklist }).pays).toEqual([{ ...empty, lines: checklist.lines, done: checklist.done }]);
    const filled = { ...empty, lines: [{ key: 's:av', label: 'AV', amount: 300, kind: 'saving' }] };
    expect(migrate({ config: { paydayDay: 27 }, pays: [filled], payChecklist: checklist }).pays).toEqual([filled]);
    // Liste sans mois lisible : laissée telle quelle (rien n'est perdu).
    expect((migrate({ payChecklist: { lines: [] } }) as unknown as Record<string, unknown>).payChecklist).toEqual({ lines: [] });
  });
  it("refuse un import invalide et accepte un fichier correct", () => {
    expect(validateImport('x').length).toBeGreaterThan(0);
    expect(validateImport({ accounts: [{ id: 'a', name: 'A', totalAmount: '<script>' }] }).length).toBe(1);
    expect(validateImport({ accounts: [{ id: 'a', name: 'A', totalAmount: 10 }] })).toEqual([]);
  });
  it('retire la clé Gemini avant tout envoi', () => {
    const d = withoutDeviceOnlyFields(migrate({ accounts: [], config: { geminiApiKey: 'k', pickerApiKey: 'p' } }));
    expect((d.config as any).geminiApiKey).toBeUndefined();
    expect(d.config.pickerApiKey).toBe('p');
  });
  it('stableStringify omet les undefined', () => {
    expect(stableStringify({ b: 1, a: undefined })).toBe('{"b":1}');
  });
});

describe('migrate : fichier abîmé', () => {
  const acc = (over: Record<string, unknown>) => ({ id: 'a', name: 'Livret A', institution: 'B', type: 'Livret A', ...over });

  it('reconstitue un montant illisible et garde total = part propre + parents', () => {
    const [a] = migrate({ accounts: [acc({ totalAmount: 1000, ownedAmount: 'abc', parentalCapital: 400 })] }).accounts;
    expect(a.ownedAmount).toBe(600);
    expect(a.totalAmount).toBe(1000);
  });

  it('accepte un montant écrit en texte et recalcule un total incohérent', () => {
    const [a] = migrate({ accounts: [acc({ totalAmount: 5, ownedAmount: '12.5', parentalCapital: 0 })] }).accounts;
    expect(a.ownedAmount).toBe(12.5);
    expect(a.totalAmount).toBe(12.5);
  });

  it('ne laisse passer aucun NaN ni Infinity', () => {
    const [a] = migrate({ accounts: [acc({ ownedAmount: Number.NaN, parentalCapital: Number.POSITIVE_INFINITY, interestRate: 'x', ceiling: 22950 })] }).accounts;
    expect(a.ownedAmount).toBe(0);
    expect(a.parentalCapital).toBe(0);
    expect(a.totalAmount).toBe(0);
    expect(a.interestRate).toBeUndefined();
    expect(a.ceiling).toBe(22950);
  });

  it('écarte les mouvements illisibles et garde les autres, champs inconnus compris', () => {
    const movements = [
      { id: '1', date: '2026-01-02', amount: 50, type: 'IN', futur: 'x' },
      { id: '2', date: '2026-01-03', amount: 'NaN', type: 'IN' },
      { id: '3', date: '2026-01-04', amount: 10, type: 'AUTRE' },
      { id: '4', amount: 10, type: 'OUT' },
      null,
      { id: '5', date: '2026-01-05', amount: '20', type: 'OUT' },
    ];
    const [a] = migrate({ accounts: [acc({ ownedAmount: 30, parentalCapital: 0, movements })] }).accounts;
    expect(a.movements!.map(m => m.id)).toEqual(['1', '5']);
    expect(a.movements![1].amount).toBe(20);
    expect((a.movements![0] as unknown as Record<string, unknown>).futur).toBe('x');
  });

  it('ignore les entrées de comptes qui ne sont pas des objets', () => {
    const accounts = migrate({ accounts: [null, 'x', acc({ ownedAmount: 1, parentalCapital: 0 })] }).accounts;
    expect(accounts).toHaveLength(1);
  });

  it("est stable : migrer deux fois donne le même résultat (pas d'écriture inutile à l'ouverture)", () => {
    const raw = { accounts: [acc({ totalAmount: 1000, ownedAmount: 'abc', parentalCapital: 400, movements: [{ id: '1', date: '2026-01-02', amount: '5', type: 'IN' }] })] };
    expect(canonicalize(migrate(raw))).toBe(canonicalize(raw));
  });

  it("écarte les points d'historique illisibles au lieu de planter", () => {
    const m = migrate({
      accounts: [],
      history: [{}, null, { date: 1 }, 'x', { date: '2026-01-05', totalAmount: 'abc', ownedAmount: 1 }, { date: '2026-02-01', totalAmount: '200', ownedAmount: 150, futur: 1 }],
      expensesHistory: [null, { date: {} }, { total: 3 }, { date: '2026-03-01', total: 42 }],
    });
    expect(m.history).toEqual([{ date: '2026-02-01', totalAmount: 200, ownedAmount: 150, futur: 1 }]);
    expect(m.expensesHistory).toEqual([{ date: '2026-03-01', total: 42 }]);
  });

  it('complète des paramètres fiscaux incomplets ou abîmés, sans perdre les champs inconnus', () => {
    const f = migrate({
      accounts: [],
      fiscalConfig: { salaryChargesRate: 'x', ceilings: { livretA: 30000, lep: 'abc' }, taxBrackets: [], futur: 'garde', lepHouseholdParts: '1.5', decote: 'x' },
    }).fiscalConfig!;
    expect(f.salaryChargesRate).toBe(DEFAULT_FISCAL_CONFIG.salaryChargesRate);
    expect(f.ceilings).toEqual({ ...DEFAULT_FISCAL_CONFIG.ceilings, livretA: 30000 });
    expect(f.legalMaturity).toEqual(DEFAULT_FISCAL_CONFIG.legalMaturity);
    expect(f.taxBrackets).toEqual(DEFAULT_FISCAL_CONFIG.taxBrackets);
    expect(f.decote).toEqual(DEFAULT_FISCAL_CONFIG.decote);
    expect(f.lepHouseholdParts).toBe(1.5);
    expect((f as unknown as Record<string, unknown>).futur).toBe('garde');
    // Un champ facultatif absent le reste : son absence a un sens (barème saisi à la main…).
    expect(f.taxScaleYear).toBeUndefined();
    expect(f.lepIncomeCeiling).toBeUndefined();
  });

  it('garde un barème lisible, limite infinie comprise, et écarte les tranches illisibles', () => {
    const brackets = [{ limit: 10000, rate: 0 }, { limit: 'x', rate: 0.1 }, null, { limit: null, rate: 0.3 }];
    const f = migrate({ accounts: [], fiscalConfig: { ...DEFAULT_FISCAL_CONFIG, taxBrackets: brackets } }).fiscalConfig!;
    expect(f.taxBrackets).toEqual([{ limit: 10000, rate: 0 }, { limit: null, rate: 0.3 }]);
  });

  it('complète des avantages salariaux incomplets ou abîmés', () => {
    const wb = migrate({ accounts: [], workBenefits: { navigo: { active: false }, mutuelle: 'x', mealVouchers: { faceValue: '12', employerRate: null }, futur: 2 } }).workBenefits!;
    expect(wb.navigo).toEqual({ ...DEFAULT_WORK_BENEFITS.navigo, active: false });
    expect(wb.mutuelle).toEqual(DEFAULT_WORK_BENEFITS.mutuelle);
    expect(wb.mealVouchers).toEqual({ ...DEFAULT_WORK_BENEFITS.mealVouchers, faceValue: 12 });
    expect((wb as unknown as Record<string, unknown>).futur).toBe(2);
  });

  it('ne plante sur aucune forme de fichier, et reste idempotente', () => {
    const junk: unknown[] = [null, 0, 'x', [], {}, { a: 1 }, [null], { toString: 1 }];
    const fields = ['accounts', 'history', 'expensesHistory', 'expenses', 'goals', 'payslips', 'subscriptions', 'donations',
      'recurringMovements', 'fiscalConfig', 'workBenefits', 'config', 'payChecklist', 'parentalRestitution', 'activePayslipId'];
    for (const field of fields) for (const v of junk) {
      const raw = { [field]: v };
      const m = migrate(raw);
      expect(m.fiscalConfig!.taxBrackets.length).toBeGreaterThan(0);
      expect(typeof m.workBenefits!.navigo.active).toBe('boolean');
      expect(Number.isFinite(m.config.grossAnnual)).toBe(true);
      expect(canonicalize(migrate(m))).toBe(canonicalize(raw));
    }
  });
});

describe('migrate : compte courant de la paie (refonte du Pilotage)', () => {
  const pay = (over: Record<string, unknown>) => ({ id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2000, lines: [], done: {}, ...over });

  it('nature de l’argent reçu : gardée sur un versement en plus, retirée ailleurs ou illisible', () => {
    expect(migrate({ pays: [pay({ kind: 'extra', nature: 'gift' })] }).pays![0].nature).toBe('gift');
    expect('nature' in migrate({ pays: [pay({ kind: 'extra', nature: 'loterie' })] }).pays![0]).toBe(false);
    expect('nature' in migrate({ pays: [pay({ nature: 'refund' })] }).pays![0]).toBe(false);
    // Ancien versement sans nature : valide tel quel (il se lit « Autre »).
    expect(migrate({ pays: [pay({ kind: 'extra' })] }).pays![0]).toEqual(pay({ kind: 'extra' }));
  });

  it('garde un solde lisible, champs inconnus compris ; une ancienne paie sans solde reste telle quelle', () => {
    const ok = { before: 30, seen: 2030, source: 'typed', note: 'banque' };
    expect(migrate({ pays: [pay({ balance: ok })] }).pays![0].balance).toEqual(ok);
    expect(migrate({ pays: [pay({ balance: { before: -50, source: 'estimated' } })] }).pays![0].balance).toEqual({ before: -50, source: 'estimated' });
    expect('balance' in migrate({ pays: [pay({})] }).pays![0]).toBe(false);
  });

  it('écarte un solde illisible, retire un solde vu illisible, une source inconnue vaut « inconnu »', () => {
    expect('balance' in migrate({ pays: [pay({ balance: { before: 'beaucoup', source: 'typed' } })] }).pays![0]).toBe(false);
    expect('balance' in migrate({ pays: [pay({ balance: 30 })] }).pays![0]).toBe(false);
    expect(migrate({ pays: [pay({ balance: { before: 30, seen: Number.NaN, source: 'typed' } })] }).pays![0].balance).toEqual({ before: 30, source: 'typed' });
    expect(migrate({ pays: [pay({ balance: { before: 30, source: 'deviné' } })] }).pays![0].balance).toEqual({ before: 30, source: 'unknown' });
  });

  it('garde le compte où arrive la paie s\'il est lisible ; le solde de départ garde la clé leisureBudget', () => {
    expect(migrate({ config: { payAccountId: 'cc' } }).config.payAccountId).toBe('cc');
    expect('payAccountId' in migrate({ config: { payAccountId: '' } }).config).toBe(false);
    expect('payAccountId' in migrate({ config: { payAccountId: 42 } }).config).toBe(false);
    expect(migrate({ config: { leisureBudget: 400 } }).config.leisureBudget).toBe(400);
  });
});

describe('migrate : retraits prévus (« J’ai besoin d’argent »)', () => {
  const plan = { id: 'p1', date: '2026-11-16', needDate: '2026-11-20', lines: [{ accountId: 'la', amount: 800 }] };
  it('garde un retrait prévu lisible, retire le reste, sans changer de version', () => {
    const ok = migrate({ config: { plannedWithdrawals: [plan, { id: 'abîmé' }] } });
    expect(ok.config.plannedWithdrawals).toEqual([plan]);
    expect(ok.schemaVersion).toBe(migrate({}).schemaVersion);
    expect('plannedWithdrawals' in migrate({ config: { plannedWithdrawals: [{ id: 'abîmé' }] } }).config).toBe(false);
    expect('plannedWithdrawals' in migrate({ config: { plannedWithdrawals: 'non' } }).config).toBe(false);
    expect('plannedWithdrawals' in migrate({ config: {} }).config).toBe(false);
  });
});

describe('migrate : objectifs annuels (clôture de l’année)', () => {
  it('garde les années « AAAA » à montant positif, retire le reste, sans changer de version', () => {
    const ok = migrate({ config: { yearGoals: { 2027: 9000, 2028: -5, abc: 100, 2029: 'beaucoup', 2030: 0 } } });
    expect(ok.config.yearGoals).toEqual({ 2027: 9000 });
    expect(ok.schemaVersion).toBe(migrate({}).schemaVersion);
    expect('yearGoals' in migrate({ config: { yearGoals: { 2027: Number.NaN } } }).config).toBe(false);
    expect('yearGoals' in migrate({ config: { yearGoals: 'non' } }).config).toBe(false);
    expect('yearGoals' in migrate({ config: {} }).config).toBe(false);
  });
});

describe('migrate : soldes des avis d\'imposition', () => {
  it('garde les soldes valides, retire le reste, sans changer de version', () => {
    const ok = migrate({ config: { taxNoticeBalances: {
      2025: { kind: 'due', amount: 320.456, date: '2026-12-15' },
      2024: { kind: 'refund', amount: 150, date: '2025-02-30' },
      2023: { kind: 'autre', amount: 10 }, 2022: { kind: 'due', amount: -1 }, abc: { kind: 'due', amount: 5 },
    } } });
    expect(ok.config.taxNoticeBalances).toEqual({ 2025: { kind: 'due', amount: 320.46, date: '2026-12-15' }, 2024: { kind: 'refund', amount: 150 } });
    expect(ok.schemaVersion).toBe(migrate({}).schemaVersion);
    expect('taxNoticeBalances' in migrate({ config: { taxNoticeBalances: 'non' } }).config).toBe(false);
    expect('taxNoticeBalances' in migrate({ config: {} }).config).toBe(false);
  });
});

describe('migrate : envies', () => {
  const wish = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Envie ${id}`, price: 40, priceDate: '2026-11-01', category: 'Livres', ...over });

  it("garde absente une liste d'envies absente, sans changer de version", () => {
    const d = migrate({});
    expect('wishes' in d).toBe(false);
    expect('wishCategories' in d.config).toBe(false);
    expect(d.schemaVersion).toBe(APP_SCHEMA_VERSION);
    expect(APP_SCHEMA_VERSION).toBe(3);
  });

  it('nettoie la liste : entrées illisibles écartées, lien non http(s) retiré', () => {
    const d = migrate({ wishes: [
      wish('ok', { url: 'https://exemple.fr/livre', note: 'Poche' }),
      wish('nom', { name: '' }),
      wish('lien', { url: 'javascript:alert(1)' }),
      'pas un objet', null,
    ] });
    expect(d.wishes?.map(w => w.id)).toEqual(['ok', 'lien']);
    expect(d.wishes?.[0]).toMatchObject({ url: 'https://exemple.fr/livre', note: 'Poche' });
    expect(d.wishes?.[1].url).toBeUndefined();
  });

  it("une envie sans prix reste (à compléter) ; un prix illisible est retiré avec sa date, l'envie reste", () => {
    const d = migrate({ wishes: [
      { id: 'sans', name: 'Valise', category: 'Loisirs' },
      wish('inf', { price: Number.POSITIVE_INFINITY }),
      wish('neg', { price: -5 }),
      wish('date', { priceDate: '2026-13-01' }),
      wish('bon'),
    ] });
    expect(d.wishes?.map(w => w.id)).toEqual(['sans', 'inf', 'neg', 'date', 'bon']);
    for (const w of d.wishes!.slice(0, 4)) { expect('price' in w).toBe(false); expect('priceDate' in w).toBe(false); }
    expect(d.wishes?.[4]).toMatchObject({ price: 40, priceDate: '2026-11-01' });
    expect(d.schemaVersion).toBe(APP_SCHEMA_VERSION);
  });

  it("une liste qui n'en est pas une est retirée ; une liste vide reste vide", () => {
    expect('wishes' in migrate({ wishes: 'non' })).toBe(false);
    expect(migrate({ wishes: [] }).wishes).toEqual([]);
  });

  it('nettoie les catégories : noms propres, sans doublon, retirées si rien de lisible', () => {
    expect(migrate({ config: { wishCategories: [' Maison ', 'maison', 3, 'Voyages'] } }).config.wishCategories).toEqual(['Maison', 'Voyages']);
    expect('wishCategories' in migrate({ config: { wishCategories: [1, ''] } }).config).toBe(false);
    expect('wishCategories' in migrate({ config: { wishCategories: 'Maison' } }).config).toBe(false);
  });

  it('est stable (pas d’écriture inutile à l’ouverture) et se retrouve dans la forme comparable', () => {
    const raw = { wishes: [wish('a', { url: 'https://exemple.fr' }), wish('b', { boughtAt: '2026-10-10', boughtPrice: 35 })], config: { wishCategories: ['Livres', 'Maison'] } };
    const once = migrate(raw);
    expect(migrate(once)).toEqual(once);
    expect(canonicalize(once)).toBe(canonicalize(raw));
    expect(canonicalize(raw)).not.toBe(canonicalize({ ...raw, wishes: [wish('a')] }));
  });

  it("garde l'envie achetée avec sa date et son prix payé", () => {
    expect(migrate({ wishes: [wish('b', { boughtAt: '2026-10-10', boughtPrice: 35 })] }).wishes?.[0]).toMatchObject({ boughtAt: '2026-10-10', boughtPrice: 35 });
  });
});
