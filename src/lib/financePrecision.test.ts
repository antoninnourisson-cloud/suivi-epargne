// Précision des calculs financiers (audit, lot 3) : intérêts acquis par quinzaine terminée,
// retraits d'assurance vie au prorata des gains, dons 2025 (deux plafonds), remboursement
// transport (régime temporaire), crypto (seuil annuel de 305 €), option pour le barème,
// argent qui dort et projections partagées. Valeurs attendues écrites en dur.
import { describe, it, expect } from 'vitest';
import {
  computeAccruedInterest, computeCapitalGainsTax, computeWithdrawalTax, computeGainsWithdrawal,
  socialChargesShareAtWithdrawal, cryptoDisposalsOfYear, compareProgressiveOption, adviseProgressiveOption,
  computeDonationSummary, splitTransportRefund, transportExemptShare, transportExemptUntil, computeIncome,
  monthsUntilRestitution, salaryTaxEstimate,
} from './finance';
import { buildTaxReturnChecklist } from './taxReturn';
import { FISCAL_WATCH_PROMPT, buildSourcesPrompt, diffFiscalWatch, isOfficialSource } from './fiscalWatch';
import { computeIdleCash, currentAccountBuffer, describeIdleDestinations, idleDestinations, lepStillEligible } from './idleCash';
import { computeEmergencyFund, emergencySavingsOf, buildSoloPlan } from './planning';
import { projectSavings } from './projection';
import { simulate } from './simulator';
import { DEFAULT_FISCAL_CONFIG as CFG, DEFAULT_WORK_BENEFITS } from '../constants';
import { AccountType, type AccountMovement, type Donation, type SavingsAccount } from '../types';

const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'a', name: 'Compte', type: AccountType.LIVRET_A, institution: 'Banque', totalAmount: 0, ownedAmount: 0, parentalCapital: 0, movements: [], ...over,
});
const mv = (over: Partial<AccountMovement>): AccountMovement => ({ id: Math.random().toString(36).slice(2), date: '2026-01-01', amount: 0, label: 'Retrait', type: 'OUT', ...over });

// ---------------------------------------------------------------------------
// #96 : une quinzaine n'est acquise qu'une fois terminée
// ---------------------------------------------------------------------------
describe('intérêts acquis : quinzaines terminées seulement', () => {
  // 10 000 € sur un Livret A à 1,7 %, sans mouvement en 2026 : 10 000 × 1,7 % / 24 = 7,083 € par quinzaine.
  const la = acc({ totalAmount: 10000, ownedAmount: 10000, interestRate: 1.7 });

  it('au 1er octobre : 18 quinzaines (janvier à septembre)', () => {
    expect(computeAccruedInterest(la, 2026, new Date(2026, 9, 1))).toBeCloseTo(127.5, 2);
  });
  it('le 2 ou le 15 octobre : la quinzaine en cours n’est pas encore gagnée', () => {
    expect(computeAccruedInterest(la, 2026, new Date(2026, 9, 2))).toBeCloseTo(127.5, 2);
    expect(computeAccruedInterest(la, 2026, new Date(2026, 9, 15))).toBeCloseTo(127.5, 2);
  });
  it('le 16 octobre : la quinzaine du 1er au 15 est acquise', () => {
    expect(computeAccruedInterest(la, 2026, new Date(2026, 9, 16))).toBeCloseTo(134.58, 2);
  });
  it('« Attendu 31/12 » (1er janvier suivant) : les 24 quinzaines', () => {
    expect(computeAccruedInterest(la, 2026, new Date(2027, 0, 1))).toBeCloseTo(170, 2);
  });
});

// ---------------------------------------------------------------------------
// #93 : assurance vie, prélèvements sociaux du fonds euros et part de gains
// ---------------------------------------------------------------------------
describe('assurance vie : « Si vous retiriez vos gains »', () => {
  const av = (over: Partial<SavingsAccount> = {}) => acc({
    type: AccountType.ASSURANCE_VIE, openingDate: '2022-01-01', totalAmount: 10250, ownedAmount: 10250, euroFundPct: 100, ...over,
  });
  const asOf = new Date(2026, 9, 22);

  it('fonds euros à 100 % : aucun prélèvement social au retrait (déjà payés chaque année)', () => {
    expect(socialChargesShareAtWithdrawal(av())).toBe(0);
    expect(socialChargesShareAtWithdrawal(av({ euroFundPct: 40 }))).toBeCloseTo(0.6, 10);
    expect(socialChargesShareAtWithdrawal(av({ euroFundPct: undefined }))).toBe(1);
    expect(socialChargesShareAtWithdrawal({ type: AccountType.PEA, euroFundPct: 100 })).toBe(1);
    // 250 € d'intérêts, contrat de moins de 8 ans : 12,8 % d'impôt seulement (32 €), net 218 €.
    const t = computeCapitalGainsTax(av(), 250, CFG, asOf);
    expect(t.socialCharges).toBe(0);
    expect(t.incomeTax).toBeCloseTo(32, 2);
    expect(t.netInterest).toBeCloseTo(218, 2);
  });

  it('versements connus : seul le prorata de gains du retrait est imposé', () => {
    // 10 000 € versés, contrat à 10 250 € : un retrait de 250 € contient 250 × 250 / 10 250 = 6,10 € de gains.
    const g = computeGainsWithdrawal(av({ totalDeposits: 10000 }), 250, CFG, asOf);
    expect(g.proRata).toBe(true);
    expect(g.socialCharges).toBe(0);
    expect(g.taxableGain).toBeCloseTo(6.0976, 3);
    expect(g.incomeTax).toBeCloseTo(0.78, 2);
    expect(g.netInterest).toBeCloseTo(249.22, 2);
    // Même chiffre que computeWithdrawalTax pour le même retrait.
    expect(g.netInterest).toBeCloseTo(computeWithdrawalTax(av({ totalDeposits: 10000 }), 250, CFG, asOf).net, 10);
  });

  it('exemple du prorata : 20 000 € versés, 30 000 € de valeur, retrait de 6 000 € = 2 000 € de gains', () => {
    const t = computeWithdrawalTax(av({ totalAmount: 30000, totalDeposits: 20000, euroFundPct: 0 }), 6000, CFG, asOf);
    expect(t.gainPart).toBeCloseTo(2000, 6);
    // Unités de compte : 17,2 % de prélèvements sociaux et 12,8 % d'impôt sur ces 2 000 €.
    expect(t.socialCharges).toBeCloseTo(344, 2);
    expect(t.incomeTax).toBeCloseTo(256, 2);
  });

  it('versements inconnus : estimation simple, tout le montant compté comme gain', () => {
    const g = computeGainsWithdrawal(av(), 250, CFG, asOf);
    expect(g.proRata).toBe(false);
    expect(g.taxableGain).toBe(250);
    expect(g.netInterest).toBeCloseTo(218, 2);
    // Livret exonéré : rien d'imposable.
    const la = computeGainsWithdrawal(acc({ totalAmount: 1000 }), 10, CFG, asOf);
    expect(la.taxableGain).toBe(0);
    expect(computeGainsWithdrawal(acc({ type: AccountType.PER, totalAmount: 1000 }), 10, CFG, asOf).proRata).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #94 : dons 2025, 1 000 € jusqu'au 13 octobre, 2 000 € au total sur l'année
// ---------------------------------------------------------------------------
describe('dons à 75 % : plafond selon la date du don', () => {
  const don = (date: string, amount: number, rate: 66 | 75 = 75): Donation => ({ id: `${date}-${amount}`, date, amount, organization: 'Restos', rate, receiptReceived: true });

  it('1 500 € le 10 mars 2025 : 1 000 € à 75 %, 500 € à 66 % (réduction 1 080 €)', () => {
    const s = computeDonationSummary([don('2025-03-10', 1500)], 2025);
    expect(s.total75).toBe(1000);
    expect(s.total66).toBe(500);
    expect(s.reduction).toBeCloseTo(1080, 6);
    expect(s.boxes75).toEqual([{ box: '7UD', amount: 1000, period: 'du 1er janvier au 13 octobre 2025' }]);
  });

  it('2025 : 7UD pour les dons jusqu’au 13 octobre, 7UQ ensuite, 2 000 € au total', () => {
    const s = computeDonationSummary([don('2025-05-01', 800), don('2025-10-14', 1500)], 2025);
    expect(s.total75).toBe(2000);
    expect(s.total66).toBe(300);
    expect(s.boxes75.map(b => [b.box, b.amount])).toEqual([['7UD', 800], ['7UQ', 1200]]);
    const t = computeDonationSummary([don('2025-10-13', 1500), don('2025-12-01', 1000)], 2025);
    expect(t.boxes75.map(b => [b.box, b.amount])).toEqual([['7UD', 1000], ['7UQ', 1000]]);
    expect(t.total66).toBe(500);
    // Seulement des dons de fin d'année : 2 000 € en 7UQ.
    expect(computeDonationSummary([don('2025-11-02', 2500)], 2025).boxes75).toEqual([{ box: '7UQ', amount: 2000, period: 'du 14 octobre au 31 décembre 2025' }]);
  });

  it('2024 : 1 000 € ; 2026 : 2 000 € (réglage de la veille)', () => {
    expect(computeDonationSummary([don('2024-06-01', 1200)], 2024).total75).toBe(1000);
    const s = computeDonationSummary([don('2026-03-01', 2500)], 2026);
    expect(s.total75).toBe(2000);
    expect(s.boxes75).toEqual([{ box: '7UD', amount: 2000 }]);
    expect(computeDonationSummary([don('2026-03-01', 2500)], 2026, { ceiling75: 2500 }).total75).toBe(2500);
  });

  it('aide à la déclaration 2025 : deux lignes, 7UD et 7UQ', () => {
    const lines = buildTaxReturnChecklist({ accounts: [], payslips: [], donations: [don('2025-03-10', 600), don('2025-11-20', 900)] } as never, 2025);
    const ud = lines.find(l => l.box === '7UD')!;
    const uq = lines.find(l => l.box === '7UQ')!;
    expect(ud.amount).toBe(600);
    expect(uq.amount).toBe(900);
    expect(ud.label).toContain('du 1er janvier au 13 octobre 2025');
    expect(uq.note).toContain("l'excédent passe en case 7UF");
    expect(lines.some(l => l.box === '7UF')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #99 : remboursement transport, exonéré jusqu'à 75 % en 2026, 50 % ensuite
// ---------------------------------------------------------------------------
describe('remboursement transport : régime temporaire', () => {
  const navigo = { active: true, basePrice: 90.8, refundRate: 67.24 };

  it('part exonérée : 75 % de 2022 à 2026, 50 % avant et après (sauf prorogation)', () => {
    expect(transportExemptShare(2021)).toBe(50);
    expect(transportExemptShare(2022)).toBe(75);
    expect(transportExemptShare(2026)).toBe(75);
    expect(transportExemptShare(2027)).toBe(50);
    expect(transportExemptShare(2027, { transportExemptUntil: 2027 })).toBe(75);
    expect(transportExemptUntil({})).toBe(2026);
    expect(transportExemptUntil({ transportExemptUntil: 2025 })).toBe(2026);
    expect(transportExemptUntil({ transportExemptUntil: 2027.5 })).toBe(2026);
  });

  it('67,24 % : rien d’imposable en 2026 ; en 2027, la part au-delà de 50 % (15,65 € par mois)', () => {
    expect(splitTransportRefund(navigo, 2026)).toEqual({ refund: 90.8 * 0.6724, taxable: 0 });
    expect(splitTransportRefund(navigo, 2027).taxable).toBeCloseTo(90.8 * 0.1724, 6);
    expect(splitTransportRefund({ ...navigo, refundRate: 80 }, 2026).taxable).toBeCloseTo(4.54, 6);
    expect(splitTransportRefund({ ...navigo, active: false }, 2027)).toEqual({ refund: 0, taxable: 0 });
  });

  it('la part imposable entre dans le net imposable de l’année', () => {
    const benefits = { ...DEFAULT_WORK_BENEFITS, navigo };
    const input = { grossAnnual: 32000, extraMonthlyIncome: 0, taxRateManual: 0 };
    const y2026 = computeIncome(input, CFG, benefits, 2026);
    const y2027 = computeIncome(input, CFG, benefits, 2027);
    expect(y2026.navigoTaxable).toBe(0);
    expect(y2027.netTaxableBeforeAllowance - y2026.netTaxableBeforeAllowance).toBeCloseTo(90.8 * 0.1724 * 12, 6);
    // Le remboursement versé, lui, ne change pas.
    expect(y2027.navigoGain).toBeCloseTo(y2026.navigoGain, 10);
  });

  it('au printemps 2027, l’estimation des revenus 2026 suit la règle de 2026 (case 1AJ, dons)', () => {
    const benefits = { ...DEFAULT_WORK_BENEFITS, navigo };
    const input = { grossAnnual: 32000, extraMonthlyIncome: 0, taxRateManual: 0 };
    const of2026 = salaryTaxEstimate(input, CFG, benefits, 2026);
    const of2027 = salaryTaxEstimate(input, CFG, benefits, 2027);
    const pilot2026 = computeIncome(input, CFG, benefits, 2026);
    expect(of2026).toEqual({ taxDue: pilot2026.taxAmount, taxableIncome: pilot2026.netTaxableYear, beforeAllowance: pilot2026.netTaxableBeforeAllowance });
    // 15,65 € par mois de plus dans les salaires de 2027 seulement : 187,85 € sur l'année.
    expect(of2027.beforeAllowance - of2026.beforeAllowance).toBeCloseTo(187.85, 2);
    expect(of2027.taxDue).toBeGreaterThan(of2026.taxDue);
  });
});

// ---------------------------------------------------------------------------
// #100 : veille fiscale, exemple à jour et pas de baisse de plafond sans source officielle
// ---------------------------------------------------------------------------
describe('veille fiscale : plafonds légaux', () => {
  it('l’exemple du plafond des dons à 75 % est la valeur en vigueur (2 000 €)', () => {
    expect(FISCAL_WATCH_PROMPT).toContain('"donation75Ceiling": {"value": 2000');
    expect(FISCAL_WATCH_PROMPT).not.toContain('"donation75Ceiling": {"value": 1000');
    expect(buildSourcesPrompt([])).toContain('"donation75Ceiling": {"value": 2000');
  });

  it('source officielle : un site en gouv.fr, en https', () => {
    expect(isOfficialSource('https://www.service-public.gouv.fr/particuliers/vosdroits/F426')).toBe(true);
    expect(isOfficialSource('https://bofip.impots.gouv.fr/bofip/1.html')).toBe(true);
    expect(isOfficialSource('http://www.impots.gouv.fr/')).toBe(false);
    expect(isOfficialSource('https://www.legifiscal.fr/actualites')).toBe(false);
    expect(isOfficialSource('https://gouv.fr.example.com/')).toBe(false);
    expect(isOfficialSource(undefined)).toBe(false);
  });

  it('une baisse du plafond des dons n’est proposée que sur une source officielle ; une hausse, toujours', () => {
    const fiscal = { ...CFG, donation75Ceiling: 2000 };
    const keys = (r: Parameters<typeof diffFiscalWatch>[0]) => diffFiscalWatch(r, fiscal, []).map(p => p.key);
    expect(keys({ donation75Ceiling: { value: 1000, source: 'https://www.exemple.fr/dons' } })).not.toContain('donation75Ceiling');
    expect(keys({ donation75Ceiling: { value: 1000 } })).not.toContain('donation75Ceiling');
    expect(keys({ donation75Ceiling: { value: 2500, source: 'https://www.exemple.fr/dons' } })).toContain('donation75Ceiling');
    // Une baisse sous 2 000 € annoncée officiellement, en vigueur après le relèvement : proposée.
    expect(keys({ donation75Ceiling: { value: 1500, effectiveDate: '2027-01-01', source: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F426' } })).toContain('donation75Ceiling');
    // Retour d'un plafond relevé (2 500 €) à 2 000 € sur une source officielle : proposé.
    expect(diffFiscalWatch({ donation75Ceiling: { value: 2000, source: 'https://www.service-public.gouv.fr/x' } }, { ...CFG, donation75Ceiling: 2500 }, []).map(p => p.key)).toContain('donation75Ceiling');
  });

  it('dons : l’ancien plafond de 1 000 €, même lu sur service-public, n’est pas proposé', () => {
    const fiscal = { ...CFG, donation75Ceiling: 2000 };
    const keys = (r: Parameters<typeof diffFiscalWatch>[0]) => diffFiscalWatch(r, fiscal, []).map(p => p.key);
    const F426 = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F426';
    // La page cite les deux plafonds : 1 000 € (dons d'avant le 14 octobre 2025) et 2 000 €.
    expect(keys({ donation75Ceiling: { value: 1000, source: F426 } })).not.toContain('donation75Ceiling');
    expect(keys({ donation75Ceiling: { value: 1000, effectiveDate: '2020-01-01', source: F426 } })).not.toContain('donation75Ceiling');
    expect(keys({ donation75Ceiling: { value: 1000, effectiveDate: '2025-10-14', source: F426 } })).not.toContain('donation75Ceiling');
    expect(keys({ donation75Ceiling: { value: 1000, effectiveDate: 'bientôt', source: F426 } })).not.toContain('donation75Ceiling');
    // La consigne du relevé sur pages officielles précise « pour un don fait aujourd'hui ».
    expect(buildSourcesPrompt([])).toContain('"donation75Ceiling" = plafond des dons ouvrant droit à 75 % pour un don fait aujourd\'hui');
    // Même règle pour les plafonds des livrets.
    expect(keys({ livretACeiling: { value: 15000, source: 'https://www.exemple.fr/' } })).not.toContain('ceiling.livretA');
  });

  it('remboursement transport : seule une prorogation sourcée officiellement est proposée', () => {
    const keys = (source?: string, value = 2027) => diffFiscalWatch({ transportExemptUntil: { value, source } }, CFG, []).map(p => p.key);
    expect(keys('https://www.service-public.gouv.fr/particuliers/vosdroits/F19846')).toContain('transportExemptUntil');
    expect(keys('https://www.exemple.fr/')).not.toContain('transportExemptUntil');
    expect(keys('https://www.service-public.gouv.fr/', 2026)).not.toContain('transportExemptUntil');
    const p = diffFiscalWatch({ transportExemptUntil: { value: 2027, source: 'https://www.service-public.gouv.fr/x' } }, CFG, [])[0];
    expect(p.apply({ fiscal: CFG } as never).fiscal.transportExemptUntil).toBe(2027);
  });
});

// ---------------------------------------------------------------------------
// #101 : crypto, seuil de 305 € sur le total des ventes de l'année
// ---------------------------------------------------------------------------
describe('crypto : exonération sur le total annuel des ventes', () => {
  const wallet = (movements: AccountMovement[] = []) => acc({ type: AccountType.CRYPTO, totalAmount: 900, ownedAmount: 900, totalDeposits: 300, movements });
  const asOf = new Date(2026, 9, 22);

  it('ventes de l’année : retraits de votre part seulement, année civile, avant une date', () => {
    const w = wallet([
      mv({ date: '2026-02-01', amount: 100 }),
      mv({ date: '2026-09-01', amount: 150 }),
      mv({ date: '2025-12-31', amount: 999 }),
      mv({ date: '2026-03-01', amount: 50, kind: 'valuation', label: 'Valorisation (-)' }),
      mv({ date: '2026-03-02', amount: 70, kind: 'parental', label: 'Part parentale' }),
      mv({ date: '2026-04-01', amount: 500, type: 'IN', label: 'Achat' }),
    ]);
    expect(cryptoDisposalsOfYear([w, acc({ movements: [mv({ date: '2026-05-01', amount: 40 })] })], 2026)).toBe(250);
    expect(cryptoDisposalsOfYear([w], 2026, '2026-09-01')).toBe(100);
  });

  it('300 € seul dans l’année : exonéré ; après 100 € de ventes, imposé et signalé', () => {
    const alone = computeWithdrawalTax(wallet(), 300, CFG, asOf);
    expect(alone.incomeTax).toBe(0);
    expect(alone.net).toBe(300);
    expect(alone.cryptoThreshold).toBeUndefined();
    const after = computeWithdrawalTax(wallet(), 300, CFG, asOf, { cryptoDisposalsThisYear: 100 });
    // Plus-value : 2/3 du retrait (200 €), 12,8 % d'impôt.
    expect(after.gainPart).toBeCloseTo(200, 6);
    expect(after.incomeTax).toBeCloseTo(25.6, 6);
    // Ce retrait ferait passer le total au-delà : rien n'était encore dépassé avant lui.
    expect(after.cryptoThreshold).toBe('with-this-sale');
    // 205 € déjà vendus + 100 € : 305 € pile, encore exonéré.
    expect(computeWithdrawalTax(wallet(), 100, CFG, asOf, { cryptoDisposalsThisYear: 205 }).incomeTax).toBe(0);
  });

  it('ventes de l’année déjà au-delà de 305 € : signalé comme déjà dépassé ; gros retrait seul : imposé, sans mention', () => {
    expect(computeWithdrawalTax(wallet(), 50, CFG, asOf, { cryptoDisposalsThisYear: 400 }).cryptoThreshold).toBe('already-past');
    // 305 € pile déjà vendus : pas encore dépassé, c'est ce retrait qui le fait.
    expect(computeWithdrawalTax(wallet(), 50, CFG, asOf, { cryptoDisposalsThisYear: 305 }).cryptoThreshold).toBe('with-this-sale');
    const alone = computeWithdrawalTax(wallet(), 600, CFG, asOf);
    expect(alone.incomeTax).toBeGreaterThan(0);
    expect(alone.cryptoThreshold).toBeUndefined();
  });

  it('l’écran Rendement et le simulateur reçoivent le même indicateur', () => {
    const g = computeGainsWithdrawal(wallet(), 300, CFG, asOf, { cryptoDisposalsThisYear: 100 });
    expect(g.cryptoThreshold).toBe('with-this-sale');
    expect(computeGainsWithdrawal(wallet(), 300, CFG, asOf, { cryptoDisposalsThisYear: 400 }).cryptoThreshold).toBe('already-past');
    expect(g.proRata).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #102 : option pour le barème quand la tranche est à 0 ou 11 %
// ---------------------------------------------------------------------------
describe('option pour le barème', () => {
  it('tranche à 11 % : 1 000 € de gains coûtent 110 € au lieu de 128 €', () => {
    expect(compareProgressiveOption([{ incomeTax: 128, taxableGain: 1000 }], 0.11)).toEqual({ flat: 128, progressive: 110, saving: 18 });
    expect(compareProgressiveOption([{ incomeTax: 128, taxableGain: 1000 }], 0)).toEqual({ flat: 128, progressive: 0, saving: 128 });
  });
  it('tranche à 30 % ou plus, ou rien à gagner : pas de suggestion', () => {
    expect(compareProgressiveOption([{ incomeTax: 128, taxableGain: 1000 }], 0.3)).toBeNull();
    expect(compareProgressiveOption([{ incomeTax: 0, taxableGain: 0 }], 0.11)).toBeNull();
    // Assurance vie de plus de 8 ans à 7,5 % : le barème à 11 % coûterait plus.
    expect(compareProgressiveOption([{ incomeTax: 75, taxableGain: 1000 }], 0.11)).toBeNull();
  });
  it('crypto à part (case 3CN), placements ensemble (case 2OP)', () => {
    const items = [
      { type: AccountType.LIVRET_BANCAIRE, incomeTax: 64, taxableGain: 500 },
      { type: AccountType.CRYPTO, incomeTax: 128, taxableGain: 1000 },
    ];
    const a = adviseProgressiveOption(items, 0.11)!;
    expect(a.marginalRate).toBe(0.11);
    expect(a.securities).toEqual({ flat: 64, progressive: 55, saving: 9 });
    expect(a.crypto).toEqual({ flat: 128, progressive: 110, saving: 18 });
    expect(adviseProgressiveOption(items, undefined)).toBeNull();
    expect(adviseProgressiveOption(items, 0.3)).toBeNull();
    expect(adviseProgressiveOption([items[0]], 0.11)!.crypto).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #19 et #98 : argent qui dort et épargne de précaution, une seule règle
// ---------------------------------------------------------------------------
describe('argent qui dort : même calcul pour l’Accueil et Rendement', () => {
  const today = new Date(2026, 9, 7);
  const cc = (amount: number, checked = '2026-10-04') => acc({ id: 'cc', name: 'Compte courant', type: AccountType.COMPTE_COURANT, totalAmount: amount, ownedAmount: amount, balanceCheckedAt: checked });
  const la = (amount: number) => acc({ id: 'la', name: 'Livret A', totalAmount: amount, ownedAmount: amount, interestRate: 1.7 });
  const lep = (amount: number) => acc({ id: 'lep', name: 'LEP', type: AccountType.LEP, totalAmount: amount, ownedAmount: amount, interestRate: 2.5 });

  it('3 800 € sur le compte courant, 1 000 € de dépenses : 1 500 € gardés, 2 300 € placés, environ 39 € par an', () => {
    const idle = computeIdleCash({ accounts: [cc(3800), la(10000)], fiscalConfig: CFG, today, monthlySpending: 1000 })!;
    expect(idle.cash).toBe(3800);
    expect(idle.buffer).toBe(1500);
    expect(idle.excess).toBe(2300);
    expect(idle.placed).toBe(2300);
    expect(idle.gain).toBeCloseTo(39.1, 6);
    expect(idle.bestRate).toBe(1.7);
    expect(idle.steps.map(s => s.accountId)).toEqual(['la']);
  });

  it('plafond du livret respecté : le reste va vers un LDDS à ouvrir', () => {
    const idle = computeIdleCash({ accounts: [cc(9000), la(22000)], fiscalConfig: CFG, today, monthlySpending: 1000 })!;
    expect(idle.steps.map(s => [s.accountId, s.fillAmount])).toEqual([['la', 950], [undefined, 6550]]);
    expect(idle.placed).toBe(7500);
    expect(describeIdleDestinations(idle)).toBe('le Livret A et un LDDS à ouvrir');
    expect(describeIdleDestinations({ steps: [] })).toBe('');
  });

  it('rien sans dépenses connues, avec un solde ancien, ou sous 300 €', () => {
    expect(computeIdleCash({ accounts: [cc(3800), la(10000)], fiscalConfig: CFG, today })).toBeNull();
    expect(computeIdleCash({ accounts: [cc(3800, '2026-09-01'), la(10000)], fiscalConfig: CFG, today, monthlySpending: 1000 })).toBeNull();
    expect(computeIdleCash({ accounts: [cc(1700), la(10000)], fiscalConfig: CFG, today, monthlySpending: 1000 })).toBeNull();
  });

  it('LEP écarté s’il va fermer', () => {
    expect(lepStillEligible(null)).toBe(true);
    expect(lepStillEligible({ status: 'watch' })).toBe(true);
    expect(lepStillEligible({ status: 'closing' })).toBe(false);
    expect(lepStillEligible({ status: 'closed-due' })).toBe(false);
    expect(idleDestinations([la(1), lep(1)], false).map(a => a.id)).toEqual(['la']);
    const withLep = computeIdleCash({ accounts: [cc(3800), la(10000), lep(1000)], fiscalConfig: CFG, today, monthlySpending: 1000 })!;
    expect(withLep.steps[0].accountId).toBe('lep');
    const noLep = computeIdleCash({ accounts: [cc(3800), la(10000), lep(1000)], fiscalConfig: CFG, today, monthlySpending: 1000, lepEligible: false })!;
    expect(noLep.steps.map(s => s.accountId)).toEqual(['la']);
  });

  it('épargne de précaution : le coussin du compte courant ne compte pas deux fois', () => {
    expect(currentAccountBuffer(1000)).toBe(1500);
    expect(currentAccountBuffer(0)).toBe(0);
    expect(emergencySavingsOf([cc(3800), la(10000)], 1500)).toBe(12300);
    expect(emergencySavingsOf([cc(1000), la(10000)], 1500)).toBe(10000);
    const f = computeEmergencyFund([cc(3800), la(10000)], 1000, 3)!;
    expect(f.cashBuffer).toBe(1500);
    expect(f.current).toBe(12300);
    expect(f.target).toBe(3000);
    expect(f.reached).toBe(true);
  });

  it('plan solo : l’étape « précaution atteinte » applique le même coussin', () => {
    const accounts = [cc(2000), la(500)];
    const milestone = (cashBuffer?: number) => buildSoloPlan(accounts, CFG, 500, '2027-01-01', { years: 1, emergencyTarget: 3000, cashBuffer })
      .milestones.find(m => m.label === 'Épargne de précaution atteinte')?.date;
    // Sans coussin : 2 500 € + 500 € dès le premier mois. Avec 1 500 € gardés : 1 000 € + 500 € par mois, atteint en avril.
    expect(milestone()).toBe('2027-01-01');
    expect(milestone(1500)).toBe('2027-04-01');
  });
});

describe('projections « selon votre plan » : un seul moteur', () => {
  const accounts = [
    acc({ id: 'la', name: 'Livret A', totalAmount: 5000, ownedAmount: 5000, interestRate: 1.7, openingDate: '2020-01-01', movements: [mv({ type: 'IN', date: '2020-01-01', amount: 5000, label: 'Solde initial', tag: 'initial' })] }),
    acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, totalAmount: 2000, ownedAmount: 2000, interestRate: 2.5, openingDate: '2015-01-01', totalDeposits: 1800 }),
  ];

  it('Rendement, simulateur et plan solo donnent le même solde au même mois', () => {
    const projected = projectSavings(accounts, CFG, 300, 2, undefined, undefined, new Date(2026, 2, 1)).total;
    const sim = simulate({ accounts, fiscal: CFG, monthlyPlan: 300, horizon: 24, today: '2026-03-01', band: false });
    const solo = buildSoloPlan(accounts, CFG, 300, '2026-03-01', { years: 2 });
    expect(sim.baselineEnd).toBeCloseTo(projected, 6);
    expect(solo.years[solo.years.length - 1].total).toBe(Math.round(projected));
  });

  // Livret A presque plein à cause du capital des parents (12 000 € sur 20 000 €) : la
  // restitution libère de la place sous le plafond de 22 950 €, le reste va à l'assurance vie.
  const withParents = [
    acc({ id: 'la', name: 'Livret A', totalAmount: 20000, ownedAmount: 8000, parentalCapital: 12000, interestRate: 1.7 }),
    acc({ id: 'av', name: 'AV', type: AccountType.ASSURANCE_VIE, totalAmount: 2000, ownedAmount: 2000, interestRate: 2.5, openingDate: '2015-01-01', totalDeposits: 1800 }),
  ];
  const asOf = new Date(2026, 2, 10);
  const both = (plannedDate: string) => {
    const months = monthsUntilRestitution({ plannedDate }, asOf);
    const projected = projectSavings(withParents, CFG, 800, 2, undefined, months, asOf).total;
    const sim = simulate({ accounts: withParents, fiscal: CFG, monthlyPlan: 800, horizon: 24, today: '2026-03-10', band: false, restitution: { plannedDate } });
    return { months, projected, sim: sim.baselineEnd };
  };

  it('avec la restitution des parents : même solde, ce mois-ci, dans 3 mois ou date passée', () => {
    const now = both('2026-03-31');
    expect(now.months).toBe(0);
    expect(now.sim).toBeCloseTo(now.projected, 6);
    const later = both('2026-06-01');
    expect(later.months).toBe(3);
    expect(later.sim).toBeCloseTo(later.projected, 6);
    // Date passée, restitution pas encore notée : appliquée tout de suite par les deux.
    const past = both('2026-01-01');
    expect(past.months).toBe(0);
    expect(past.sim).toBeCloseTo(past.projected, 6);
    expect(past.projected).toBeCloseTo(now.projected, 6);
    // Restituer plus tard laisse le Livret A plein plus longtemps : moins d'intérêts.
    expect(later.projected).not.toBeCloseTo(now.projected, 2);
  });
});
