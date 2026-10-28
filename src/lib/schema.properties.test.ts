// Tests « par propriétés » de migrate() (fast-check) : des centaines de fichiers générés, plus
// ou moins abîmés (montants en texte ou illisibles, lignes nulles, dates fausses, champs
// inconnus), et quelques règles qui doivent toujours tenir :
// - migrate(migrate(x)) = migrate(x) ;
// - aucun NaN ni infini dans le résultat (hors borne de la dernière tranche du barème) ;
// - chaque compte : total = part propre + part des parents au centime, parts des parents ≥ 0 ;
// - les champs inconnus (d'une version plus récente) sont gardés tels quels.
// En cas d'échec, fast-check réduit le fichier fautif au plus petit exemple et l'affiche.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AccountType } from '../types';
import { migrate } from './schema';
import { round2 } from './money';

const RUNS = { numRuns: 300 };

/** Nombre tel qu'il peut arriver d'un fichier : nombre, texte, illisible ou absent. */
const looseNumber = fc.oneof(
  fc.double({ min: -1e7, max: 1e7, noNaN: true, noDefaultInfinity: true }),
  fc.integer({ min: -100_000, max: 100_000 }),
  fc.integer({ min: 0, max: 100_000 }).map(n => String(n / 100)),
  fc.constantFrom('', 'abc', '12,5', null, undefined, true),
);
const day = fc.date({ min: new Date(2018, 0, 1), max: new Date(2028, 11, 31), noInvalidDate: true }).map(d => d.toISOString().slice(0, 10));
const looseDate = fc.oneof(day, fc.constantFrom('2026-07', 'hier', '', null));
/** Clés qu'aucune version de l'app n'utilise : une version plus récente pourrait les ajouter. */
const unknownFields = fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }).map(k => `futur_${k}`), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 2 });

const movement = fc.oneof(
  { weight: 8, arbitrary: fc.record({
    id: fc.uuid(), date: looseDate, amount: looseNumber, label: fc.string({ maxLength: 12 }),
    type: fc.constantFrom('IN', 'OUT', 'x'),
    kind: fc.constantFrom(undefined, 'valuation', 'parental', 'adjustment'),
  }, { requiredKeys: ['id', 'date', 'amount', 'type'] }) },
  { weight: 1, arbitrary: fc.constantFrom(null, 'abîmé', 42) },
);

const account = fc.tuple(fc.record({
  id: fc.uuid(),
  name: fc.oneof(fc.string({ maxLength: 12 }), fc.constant(null), fc.integer()),
  institution: fc.oneof(fc.string({ maxLength: 10 }), fc.constant(undefined)),
  type: fc.constantFrom(...Object.values(AccountType), 'Cryptomonnaies', 'Type inconnu'),
  totalAmount: looseNumber, ownedAmount: looseNumber, parentalCapital: looseNumber,
  interestRate: looseNumber, totalDeposits: looseNumber,
  movements: fc.oneof(fc.array(movement, { maxLength: 6 }), fc.constant(undefined), fc.constant('abîmé')),
}, { requiredKeys: ['id'] }), unknownFields).map(([a, extra]) => ({ ...extra, ...a }));

const snapshot = fc.record({ date: looseDate, totalAmount: looseNumber, ownedAmount: looseNumber });

const file = fc.tuple(fc.record({
  schemaVersion: fc.constantFrom(undefined, 1, 2),
  accounts: fc.oneof(fc.array(account, { maxLength: 5 }), fc.constant(undefined)),
  expenses: fc.array(fc.oneof(fc.record({ id: fc.uuid(), name: fc.string(), amount: looseNumber }), fc.constant(null)), { maxLength: 3 }),
  history: fc.array(snapshot, { maxLength: 6 }),
  expensesHistory: fc.array(fc.record({ date: looseDate, total: looseNumber }), { maxLength: 3 }),
  config: fc.oneof(fc.record({
    grossAnnual: looseNumber, leisureBudget: looseNumber, projectSavings: looseNumber, taxRateManual: looseNumber,
    extraMonthlyIncome: looseNumber, navigoBase: looseNumber, navigoRate: looseNumber, paydayDay: looseNumber,
  }, { requiredKeys: [] }), fc.constant(null)),
  fiscalConfig: fc.oneof(fc.record({
    salaryChargesRate: looseNumber, socialChargesCapital: fc.oneof(looseNumber, fc.constant(0.172)), standardAllowance: looseNumber,
    standardAllowanceCap: looseNumber, lepIncomeCeiling: looseNumber, donation75Ceiling: looseNumber,
    ceilings: fc.record({ livretA: looseNumber, ldds: looseNumber, lep: looseNumber }, { requiredKeys: [] }),
    taxBrackets: fc.array(fc.record({ limit: fc.oneof(looseNumber, fc.constant(null)), rate: looseNumber }), { maxLength: 5 }),
  }, { requiredKeys: [] }), fc.constant(undefined), fc.constant('abîmé')),
  workBenefits: fc.oneof(fc.constant(undefined), fc.record({
    navigo: fc.record({ active: fc.boolean(), basePrice: looseNumber, refundRate: looseNumber }, { requiredKeys: [] }),
  }, { requiredKeys: [] })),
  lastView: fc.constantFrom(undefined, 'dashboard'),
}, { requiredKeys: [] }), unknownFields).map(([f, extra]) => ({ ...extra, ...f }));

/** Chemins des nombres non finis (NaN, ±Infinity) d'un objet. */
const nonFinite = (v: unknown, path = ''): string[] => {
  if (typeof v === 'number') return Number.isFinite(v) ? [] : [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => nonFinite(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => nonFinite(x, `${path}.${k}`));
  return [];
};

describe('migrate() : propriétés', () => {
  it('idempotente, sur des fichiers plausibles comme sur n\'importe quel JSON', () => {
    fc.assert(fc.property(file, raw => { const m = migrate(raw); expect(migrate(m)).toEqual(m); }), RUNS);
    fc.assert(fc.property(fc.jsonValue({ maxDepth: 4 }), raw => { const m = migrate(raw); expect(migrate(m)).toEqual(m); }), RUNS);
  });

  it('aucun NaN ni infini, hors borne haute de la dernière tranche du barème', () => {
    fc.assert(fc.property(file, raw => {
      const bad = nonFinite(migrate(raw)).filter(p => !/^\.fiscalConfig\.taxBrackets\[\d+\]\.limit$/.test(p));
      expect(bad).toEqual([]);
    }), RUNS);
  });

  it('chaque compte : total = part propre + part des parents au centime, part des parents ≥ 0', () => {
    fc.assert(fc.property(file, raw => {
      for (const a of migrate(raw).accounts) {
        expect(a.parentalCapital).toBeGreaterThanOrEqual(0);
        expect(a.totalAmount).toBe(round2(a.ownedAmount + a.parentalCapital));
        expect(a.ownedAmount).toBe(round2(a.ownedAmount));
        for (const m of a.movements!) {
          expect(m.type === 'IN' || m.type === 'OUT').toBe(true);
          expect(m.amount).toBeGreaterThanOrEqual(0);
        }
      }
    }), RUNS);
  });

  it('les champs inconnus sont gardés tels quels (fichier et comptes)', () => {
    fc.assert(fc.property(file, raw => {
      const m = migrate(raw) as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(raw)) if (k.startsWith('futur_')) expect(m[k]).toEqual(v);
      const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
      for (const a of accounts) {
        const out = (m.accounts as Record<string, unknown>[]).find(x => x.id === a.id)!;
        for (const [k, v] of Object.entries(a)) if (k.startsWith('futur_')) expect(out[k]).toEqual(v);
      }
    }), RUNS);
  });

  it('ne modifie jamais ce qu\'on lui passe', () => {
    fc.assert(fc.property(file, raw => {
      const before = JSON.stringify(raw);
      migrate(raw);
      expect(JSON.stringify(raw)).toBe(before);
    }), RUNS);
  });
});
