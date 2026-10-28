// Anciens fichiers de données passés par migrate() : un fichier de chaque époque du format,
// reconstitué d'après l'historique de src/types.ts et anonymisé (noms et montants fictifs).
// - fichier-2026-01 : tout premier format (pas de mouvements, types de compte de l'époque,
//   avantage Navigo dans config, champs disparus depuis) ;
// - fichier-2026-09 : avant le format versionné (pas de schemaVersion, prélèvements sociaux
//   à 17,2 %, paramètres fiscaux de 2025, ancien écran « Objectifs », adresse des parents,
//   clé Gemini dans le fichier, lignes abîmées).
// Le résultat complet est comparé à un instantané (`*.migrated.json`) : tout changement de la
// migration d'un ancien fichier se voit dans la revue. Un changement voulu (nouvelle
// migration, nouvelles valeurs par défaut de src/constants.ts) se valide avec
// `npx vitest run src/lib/schema.fixtures.test.ts -u`, puis se relit dans le diff.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AccountType } from '../types';
import { APP_SCHEMA_VERSION, canonicalize, migrate, withoutDeviceOnlyFields } from './schema';
import { findFiscalReview } from './finance';
import { round2 } from './money';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}.json`, import.meta.url)), 'utf8'));

const ERAS = ['fichier-2026-01', 'fichier-2026-09'] as const;

describe.each(ERAS)('ancien fichier %s', name => {
  const raw = fixture(name);
  const m = migrate(raw);

  it('donne le même résultat qu\'à la dernière revue (instantané)', async () => {
    await expect(`${JSON.stringify(m, null, 2)}\n`).toMatchFileSnapshot(`./__fixtures__/${name}.migrated.json`);
  });

  it('migration stable, soldes cohérents, rien de perdu', () => {
    expect(m.schemaVersion).toBe(APP_SCHEMA_VERSION);
    expect(migrate(m)).toEqual(m);
    expect(canonicalize(m)).toBe(canonicalize(raw));
    for (const a of m.accounts) {
      expect(a.totalAmount, a.id).toBe(round2(a.ownedAmount + a.parentalCapital));
      expect(Array.isArray(a.movements), a.id).toBe(true);
    }
    // Le fichier d'origine n'est jamais modifié en place.
    expect(raw).toEqual(fixture(name));
  });
});

describe('premier format (janvier 2026)', () => {
  const m = migrate(fixture('fichier-2026-01'));

  it('types de compte de l\'époque, noms nettoyés, montants relus', () => {
    expect(m.accounts.map(a => [a.id, a.type])).toEqual([
      ['acc-la', AccountType.LIVRET_A], ['acc-crypto', AccountType.CRYPTO], ['acc-pee', AccountType.PEE], ['acc-scpi', AccountType.IMMOBILIER],
    ]);
    expect(m.accounts[0]).toMatchObject({ name: 'Livret A', institution: 'Banque Exemple', ownedAmount: 8000, parentalCapital: 7000, totalAmount: 15000, movements: [] });
    expect(m.accounts[1]).toMatchObject({ ownedAmount: 812.5, totalAmount: 812.5 });
  });

  it('avantage Navigo repris de config, un point par mois, paramètres fiscaux complets', () => {
    expect(m.workBenefits.navigo).toEqual({ active: true, basePrice: 86.4, refundRate: 50 });
    expect(m.history).toEqual([{ date: '2026-01-22', totalAmount: 23212.5, ownedAmount: 16212.5 }]);
    expect(m.fiscalConfig).toMatchObject({ socialChargesCapital: 0.186, socialChargesLifeInsurance: 0.172, donation75Ceiling: 2000 });
  });

  it('champs disparus gardés tels quels, préférence d\'affichage retirée', () => {
    const rest = m as unknown as Record<string, unknown>;
    expect(rest.goalPrompt).toBe('Un apport pour un appartement');
    expect(rest.financing).toEqual({ interestRate: 3.2, insuranceRate: 0.3 });
    expect((m.accounts[1] as unknown as Record<string, unknown>).recentHighRate).toBe(12);
    expect(m.config).toMatchObject({ navigoBase: 86.4, navigoRate: 50 });
    expect('lastView' in m).toBe(false);
  });
});

describe('format de septembre 2026 (avant le format versionné)', () => {
  const m = migrate(fixture('fichier-2026-09'));

  it('lignes abîmées écartées, montant en texte relu, part propre reconstituée', () => {
    const la = m.accounts.find(a => a.id === 'acc-la')!;
    expect(la.movements!.map(x => [x.id, x.amount])).toEqual([['m1', 8000], ['m2', 200], ['m3', 150], ['m4', 150]]);
    expect(m.accounts.find(a => a.id === 'acc-ldds')).toMatchObject({ ownedAmount: 3150, parentalCapital: 0, totalAmount: 3150 });
    expect(m.history.map(s => s.date)).toEqual(['2026-08-31', '2026-09-30']);
  });

  it('paramètres fiscaux : seuls les manques sont complétés, les valeurs présentes restent (la veille propose)', () => {
    expect(m.fiscalConfig).toMatchObject({
      socialChargesCapital: 0.186, socialChargesLifeInsurance: 0.172,
      standardAllowanceCap: 14171, lepIncomeCeiling: 22419,
      standardAllowanceMin: 509, lepCeilingPerHalfPart: 6149, donation75Ceiling: 2000,
    });
    expect(m.fiscalConfig.decote).toEqual({ single: 897, rate: 0.4525, threshold: 1982 });
    // Ancien barème gardé : c'est le rappel qui propose le nouveau, avec son plafond d'abattement.
    expect(m.fiscalConfig.taxBrackets[4]).toEqual({ limit: null, rate: 0.45 });
    expect(findFiscalReview(m.fiscalConfig, new Date(2026, 9, 26)).newScale?.year).toBe(2026);
  });

  it('anciens champs gardés ; la clé Gemini ne sort pas de l\'appareil', () => {
    const rest = m as unknown as Record<string, unknown>;
    expect(rest.goals).toEqual([{ id: 'g1', name: 'Voyage', targetAmount: 1500, savedAmount: 400, deadline: '2027-06-01' }]);
    expect(m.config).toMatchObject({ parentsEmail: 'parents@exemple.invalid', paydayDay: 27 });
    expect(withoutDeviceOnlyFields(m).config.geminiApiKey).toBeUndefined();
    expect(canonicalize(m)).not.toContain('cle-factice-de-test');
    expect(m.activePayslipId).toBe('p1');
  });
});
