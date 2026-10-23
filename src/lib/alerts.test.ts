import { describe, it, expect } from 'vitest';
import { computeAlerts, sortAlerts, yearlyValue, AlertsInput, Alert } from './alerts';
import { AccountType, PayslipRecord, SavingsAccount } from '../types';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { withAssumedRates } from './performance';

const fiscal = { ...DEFAULT_FISCAL_CONFIG, ceilings: { livretA: 22950, ldds: 12000, lep: 10000 } };
const TODAY = new Date(2026, 9, 7); // 7 octobre 2026

const acc = (id: string, type: AccountType, amount: number, over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id, name: id, institution: 'B', type, totalAmount: amount, ownedAmount: amount, parentalCapital: 0, interestRate: 0, movements: [], ...over,
});
const la = (amount: number, over: Partial<SavingsAccount> = {}) => acc('Livret A', AccountType.LIVRET_A, amount, { id: 'la', interestRate: 1.7, ...over });
const ldds = (amount: number, over: Partial<SavingsAccount> = {}) => acc('LDDS', AccountType.LDDS, amount, { id: 'ldds', interestRate: 1.7, ...over });
const lep = (amount: number, over: Partial<SavingsAccount> = {}) => acc('LEP', AccountType.LEP, amount, { id: 'lep', interestRate: 2.5, ...over });
// Solde du compte courant vérifié il y a 3 jours (l'alerte exige un solde de moins de 15 jours).
const cc = (amount: number, over: Partial<SavingsAccount> = {}) => acc('Compte courant', AccountType.COMPTE_COURANT, amount, { id: 'cc', balanceCheckedAt: '2026-10-04', ...over });

const run = (over: Partial<AlertsInput>): Alert[] => computeAlerts({ accounts: [], fiscalConfig: fiscal, today: TODAY, ...over });
const byKind = (alerts: Alert[], kind: Alert['kind']) => alerts.filter(a => a.kind === kind);

describe('compte courant dormant', () => {
  it('propose de placer ce qui dépasse 1,5 mois de dépenses, au taux du meilleur livret qui a de la place', () => {
    // 1 000 € de dépenses : coussin 1 500 €, 3 800 − 1 500 = 2 300 € dorment.
    const alerts = run({ accounts: [cc(3800), la(10000), lep(10000)], monthlySpending: 1000 });
    const [a] = byKind(alerts, 'dormant-cash');
    expect(a.title).toMatch(/^2\s300\s€ dorment sur votre compte courant : placés sur le Livret A, environ 39\s€ d'intérêts par an\.$/);
    expect(a.gain).toEqual({ amount: 2300 * 0.017, per: 'an', label: "d'intérêts par an" });
    expect(a.tone).toBe('action');
    expect(a.action?.view).toBe('pilot');
  });

  it('remplit le LEP en premier, puis le livret suivant', () => {
    const [a] = byKind(run({ accounts: [cc(5500), la(10000), lep(9000)], monthlySpending: 1000 }), 'dormant-cash');
    // 4 000 € : 1 000 € sur le LEP (2,5 %), 3 000 € sur le Livret A (1,7 %).
    expect(a.title).toContain('placés sur le LEP et le Livret A');
    expect(a.gain?.amount).toBeCloseTo(1000 * 0.025 + 3000 * 0.017, 6);
  });

  it("ne propose pas le LEP s'il va fermer", () => {
    const [a] = byKind(run({ accounts: [cc(5500), la(10000), lep(9000)], monthlySpending: 1000, lepEligible: false }), 'dormant-cash');
    expect(a.title).toContain('placés sur le Livret A,');
  });

  it('aucune alerte sans dépenses connues, sous le coussin, ou sans livret qui ait de la place', () => {
    expect(byKind(run({ accounts: [cc(9000), la(1000)] }), 'dormant-cash')).toHaveLength(0);
    expect(byKind(run({ accounts: [cc(1700), la(1000)], monthlySpending: 1000 }), 'dormant-cash')).toHaveLength(0);
    expect(byKind(run({ accounts: [cc(9000), la(22950), ldds(12000)], monthlySpending: 1000 }), 'dormant-cash')).toHaveLength(0);
  });

  it('aucune alerte si le solde du compte courant date de plus de 15 jours (ou n’a jamais été constaté)', () => {
    const accounts = (over: Partial<SavingsAccount>) => [cc(3800, over), la(10000), lep(10000)];
    expect(byKind(run({ accounts: accounts({ balanceCheckedAt: '2026-09-22' }), monthlySpending: 1000 }), 'dormant-cash')).toHaveLength(1);
    expect(byKind(run({ accounts: accounts({ balanceCheckedAt: '2026-09-21' }), monthlySpending: 1000 }), 'dormant-cash')).toHaveLength(0);
    expect(byKind(run({ accounts: accounts({ balanceCheckedAt: undefined }), monthlySpending: 1000 }), 'dormant-cash')).toHaveLength(0);
    // Un versement prévu n'est pas un constat ; une actualisation, si.
    const pay = { id: 'p', date: '2026-10-05', amount: 100, label: 'Épargne du mois', type: 'OUT' as const };
    const upd = { id: 'u', date: '2026-10-05', amount: 100, label: 'Actualisation (-)', type: 'OUT' as const };
    expect(byKind(run({ accounts: accounts({ balanceCheckedAt: undefined, movements: [pay] }), monthlySpending: 1000 }), 'dormant-cash')).toHaveLength(0);
    expect(byKind(run({ accounts: accounts({ balanceCheckedAt: undefined, movements: [upd] }), monthlySpending: 1000 }), 'dormant-cash')).toHaveLength(1);
  });
});

describe('taux sous-optimal', () => {
  it("signale l'argent d'un livret moins rémunéré quand un meilleur a de la place", () => {
    const [a] = byKind(run({ accounts: [ldds(3000), lep(8000)] }), 'better-rate');
    // 2 000 € de place sur le LEP : 2 000 × (2,5 − 1,7) % = 16 €.
    expect(a.title).toMatch(/^2\s000\s€ du LDDS rapporteraient plus sur le LEP \(2,5 % au lieu de 1,7 %\) : environ 16\s€ de plus par an\.$/);
    expect(a.gain?.amount).toBeCloseTo(16, 6);
    expect(a.id).toBe('better-rate-ldds-lep');
    expect(a.detail).toContain('quinzaine');
  });

  it('rien entre deux livrets au même taux, ni vers un LEP plein ou qui va fermer', () => {
    expect(byKind(run({ accounts: [la(3000), ldds(3000)] }), 'better-rate')).toHaveLength(0);
    expect(byKind(run({ accounts: [ldds(3000), lep(10000)] }), 'better-rate')).toHaveLength(0);
    expect(byKind(run({ accounts: [ldds(3000), lep(8000)], lepEligible: false }), 'better-rate')).toHaveLength(0);
  });

  it("ne propose pas deux fois la même place (compte courant d'abord)", () => {
    // 2 000 € de place sur le LEP, entièrement prise par l'argent du compte courant.
    const alerts = run({ accounts: [cc(4000), ldds(3000), lep(8000)], monthlySpending: 1000 });
    expect(byKind(alerts, 'dormant-cash')[0].title).toContain('placés sur le LEP');
    expect(byKind(alerts, 'better-rate')).toHaveLength(0);
  });
});

describe('livret plein prévu', () => {
  it('annonce le mois où le livret sera plein et la suite du plan', () => {
    // 1 000 € de place sur le LEP à 500 €/mois : plein en décembre 2026 (2e mois).
    const [a] = byKind(run({ accounts: [lep(9000), ldds(0)], monthlyPlan: 500 }), 'livret-full');
    expect(a.title).toBe('Votre LEP sera plein vers décembre 2026 : prévoyez la suite sur le LDDS.');
    expect(a.tone).toBe('action'); // dans les trois mois
    expect(a.id).toBe('livret-full-lep-2026-12');
    expect(a.accountId).toBe('lep');
    // Suite laissée sur le compte courant : 500 × 1,7 % × 6,5 mois.
    expect(a.gain?.amount).toBeCloseTo(500 * 0.017 * 6.5, 6);
  });

  it('information seulement quand c’est loin, et suggestion d’un LDDS à ouvrir', () => {
    const [a] = byKind(run({ accounts: [la(20000)], monthlyPlan: 500 }), 'livret-full');
    expect(a.title).toBe("Votre Livret A sera plein vers avril 2027 : prévoyez d'ouvrir un LDDS pour la suite.");
    expect(a.tone).toBe('info');
  });

  it('tient compte de la restitution prévue', () => {
    const accounts = [la(20000, { ownedAmount: 15000, parentalCapital: 5000 }), ldds(0)];
    const without = byKind(run({ accounts, monthlyPlan: 500 }), 'livret-full')[0];
    const withR = byKind(run({ accounts, monthlyPlan: 500, restitution: { plannedDate: '2027-01-01' } }), 'livret-full')[0];
    expect(without.title).toContain('avril 2027');
    // Même moteur que les projections (lib/projectionEngine) : les intérêts de 2027 (≈ 330 €),
    // versés au 31 décembre, remplissent le livret dès le 1er janvier 2028.
    expect(withR.title).toContain('janvier 2028');
    expect(withR.detail).toContain('restitution');
  });

  it('aucune alerte sans plan mensuel, livret déjà plein, ou au-delà de deux ans', () => {
    expect(byKind(run({ accounts: [lep(9000)] }), 'livret-full')).toHaveLength(0);
    expect(byKind(run({ accounts: [lep(10000)], monthlyPlan: 500 }), 'livret-full')).toHaveLength(0);
    expect(byKind(run({ accounts: [la(0)], monthlyPlan: 100 }), 'livret-full')).toHaveLength(0);
  });
});

describe('place libérée après la restitution', () => {
  const accounts = [la(15200, { ownedAmount: 8200, parentalCapital: 7000 }), lep(10000, { ownedAmount: 7500, parentalCapital: 2500 })];

  it('chiffre la place rendue sur chaque livret et ce qu’elle rapporte VRAIMENT en plus', () => {
    const [a] = byKind(run({ accounts, restitution: { plannedDate: '2027-01-01' } }), 'restitution-room');
    expect(a.title).toMatch(/^Après la restitution \(1er janvier 2027\), 7\s000\s€ de place sur le Livret A et 2\s500\s€ sur le LEP\.$/);
    expect(a.tone).toBe('info');
    // Sans cette place, l'argent irait sur un LDDS à ouvrir (1,7 %) : seul l'écart compte.
    // Livret A : 1,7 − 1,7 = 0 ; LEP : 2 500 € × (2,5 − 1,7) % = 20 €.
    expect(a.gain?.amount).toBeCloseTo(20, 6);
    expect(a.detail).toContain('un LDDS à ouvrir');
    // Les intérêts offerts par les parents (7 000 × 1,7 % + 2 500 × 2,5 % = 181,50 €) s'arrêtent.
    expect(a.detail).toMatch(/environ 182\s€ par an\), s'arrêtent à la restitution\./);
    expect(a.id).toBe('restitution-room-2027-01-01');
  });

  it('compare au taux NET de l’assurance vie où irait l’argent sinon', () => {
    // AV ouverte en 2024 : à la restitution elle a moins de 8 ans. 3 % brut × (1 − 17,2 % − 12,8 %) = 2,1 % net.
    const av = acc('Assurance vie', AccountType.ASSURANCE_VIE, 4000, { id: 'av', interestRate: 3, openingDate: '2024-06-15' });
    const [a] = byKind(run({ accounts: [...accounts, av], restitution: { plannedDate: '2027-01-01' } }), 'restitution-room');
    // Livret A 1,7 % < 2,1 % : rien ; LEP : 2 500 € × (2,5 − 2,1) % = 10 €.
    expect(a.gain?.amount).toBeCloseTo(10, 6);
    expect(a.detail).toContain("de plus que sur l'Assurance vie (2,1 % net)");
  });

  it('assurance vie en unités de compte sans taux saisi : son rendement observé, comme au Rendement', () => {
    // Ouverte en 2024 : 4 000 € devenus 4 400 € en 2 ans et 9 mois (≈ +3,5 % par an observés).
    const av = acc('Assurance vie', AccountType.ASSURANCE_VIE, 4400, {
      id: 'av', openingDate: '2024-01-01',
      movements: [
        { id: 'i', date: '2024-01-01', amount: 4000, type: 'IN', label: 'Ouverture', tag: 'initial' },
        { id: 'v', date: '2026-10-01', amount: 400, type: 'IN', label: 'Valorisation', kind: 'valuation' },
      ],
    });
    const withLdds = [...accounts, ldds(12000), av];
    const [observed] = byKind(run({ accounts: withLdds, restitution: { plannedDate: '2027-01-01' } }), 'restitution-room');
    expect(observed.detail).toContain("l'Assurance vie");
    // Même calcul qu'avec ce rendement passé explicitement (useDerivedData le calcule une fois).
    const rate = withAssumedRates(withLdds, TODAY).rates.av;
    expect(rate).toBeGreaterThan(3);
    const [explicit] = byKind(run({ accounts: withLdds, restitution: { plannedDate: '2027-01-01' }, assumedRates: { av: rate } }), 'restitution-room');
    expect(explicit.detail).toBe(observed.detail);
    // Sans hypothèse (rendement à 0 %), la place rendue paraîtrait rapporter bien plus.
    const [flat] = byKind(run({ accounts: withLdds, restitution: { plannedDate: '2027-01-01' }, assumedRates: {} }), 'restitution-room');
    expect(flat.gain!.amount).toBeGreaterThan(observed.gain?.amount ?? 0);
  });

  it('sans gain notable, ne promet rien mais rappelle la souplesse', () => {
    const laOnly = [la(15200, { ownedAmount: 8200, parentalCapital: 7000 })];
    const [a] = byKind(run({ accounts: laOnly, restitution: { plannedDate: '2027-01-01' } }), 'restitution-room');
    expect(a.gain).toBeUndefined();
    expect(a.detail).toContain('peu ou pas d\'intérêts en plus');
  });

  it('rien si la restitution est faite, non prévue, ou sans capital parental', () => {
    expect(byKind(run({ accounts, restitution: { plannedDate: '2027-01-01', done: true } }), 'restitution-room')).toHaveLength(0);
    expect(byKind(run({ accounts }), 'restitution-room')).toHaveLength(0);
    expect(byKind(run({ accounts: [la(1000)], restitution: { plannedDate: '2027-01-01' } }), 'restitution-room')).toHaveLength(0);
  });
});

describe('fiche de paie à vérifier', () => {
  const slip = (period: string, netPaid: number): PayslipRecord =>
    ({ id: `ps-${period}`, fileId: 'f', fileName: 'f.pdf', addedAt: `${period}-27T09:00:00Z`, reviewed: true, extracted: { period, netPaid } });

  it('signale la dernière fiche qui s’écarte, sans montant', () => {
    const payslips = [slip('2026-05', 2050), slip('2026-06', 2070), slip('2026-07', 2040), slip('2026-08', 1700)];
    const [a] = byKind(run({ payslips }), 'payslip-anomaly');
    expect(a.id).toBe('payslip-anomaly-ps-2026-08');
    expect(a.title).toBe('Fiche de paie de août 2026 à vérifier.');
    expect(a.detail).toContain('Net payé');
    expect(a.gain).toBeUndefined();
    expect(a.tone).toBe('info');
  });

  it('rien si la dernière fiche est normale', () => {
    const payslips = [slip('2026-05', 2050), slip('2026-06', 2070), slip('2026-07', 2040), slip('2026-08', 2060)];
    expect(byKind(run({ payslips }), 'payslip-anomaly')).toHaveLength(0);
  });
});

describe('ordre et stabilité', () => {
  it('actions par valeur en euros décroissante, puis informations', () => {
    const accounts = [cc(3800), ldds(9000), lep(5000), la(15200, { ownedAmount: 8200, parentalCapital: 7000 })];
    const alerts = run({ accounts, monthlySpending: 1000, monthlyPlan: 300, restitution: { plannedDate: '2027-01-01' } });
    const kinds = alerts.map(a => a.kind);
    expect(kinds.slice(0, 2).sort()).toEqual(['better-rate', 'dormant-cash']);
    const actions = alerts.filter(a => a.tone === 'action');
    for (let i = 1; i < actions.length; i++) expect(yearlyValue(actions[i - 1].gain)).toBeGreaterThanOrEqual(yearlyValue(actions[i].gain));
    const firstInfo = alerts.findIndex(a => a.tone === 'info');
    expect(alerts.slice(firstInfo).every(a => a.tone === 'info')).toBe(true);
  });

  it('identifiants stables d’un calcul à l’autre', () => {
    const input = { accounts: [cc(3800), ldds(3000), lep(8000)], monthlySpending: 1000, monthlyPlan: 400 };
    expect(run(input).map(a => a.id)).toEqual(run(input).map(a => a.id));
  });

  it('sortAlerts : euros par mois annualisés, ordre d’origine en cas d’égalité', () => {
    const a = { tone: 'info' as const, gain: { amount: 10, per: 'mois' as const, label: '' } };
    const b = { tone: 'info' as const, gain: { amount: 100, per: 'an' as const, label: '' } };
    const c = { tone: 'action' as const };
    const d = { tone: 'action' as const };
    expect(sortAlerts([b, a, c, d])).toEqual([c, d, a, b]);
  });

  it('aucune alerte pour des données vides', () => {
    expect(run({})).toEqual([]);
  });
});
