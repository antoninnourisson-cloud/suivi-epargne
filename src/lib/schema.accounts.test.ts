// Champs ajoutés pour les comptes (date du dernier solde constaté, argent bloqué), l'inflation
// INSEE et le plafond épargne retraite : additifs, illisibles écartés ; ancien `goals` gardé.
import { describe, it, expect } from 'vitest';
import { emptyData, migrate, canonicalize } from './schema';

const account = (over: Record<string, unknown>) => ({ id: 'a', name: 'A', type: 'Livret A', institution: 'B', totalAmount: 10, ownedAmount: 10, parentalCapital: 0, ...over });

describe('migrate : nouveaux champs facultatifs', () => {
  it('date du dernier solde constaté et « argent bloqué » : gardés si lisibles', () => {
    const m = migrate({ accounts: [account({ balanceCheckedAt: '2026-10-01', blocked: true, type: 'Autre' })] });
    expect(m.accounts[0]).toMatchObject({ balanceCheckedAt: '2026-10-01', blocked: true });
    const bad = migrate({ accounts: [account({ balanceCheckedAt: 'hier', blocked: 'oui' })] });
    expect('balanceCheckedAt' in bad.accounts[0]).toBe(false);
    expect('blocked' in bad.accounts[0]).toBe(false);
  });

  it('nouveaux types de compte gardés tels quels', () => {
    for (const type of ['Livret bancaire', 'Compte à terme', 'Compte-titres', 'PEL', 'CEL']) {
      expect(migrate({ accounts: [account({ type })] }).accounts[0].type).toBe(type);
    }
  });

  it('inflation des paramètres fiscaux : gardée si lisible, sinon écartée', () => {
    expect(migrate({ fiscalConfig: { inflation: { rate: 1.2, year: 2026, source: 'https://www.insee.fr/x' } } }).fiscalConfig.inflation)
      .toEqual({ rate: 1.2, year: 2026, source: 'https://www.insee.fr/x' });
    expect(migrate({ fiscalConfig: { inflation: { rate: 'x', year: 2026 } } }).fiscalConfig.inflation).toBeUndefined();
    expect(migrate({ fiscalConfig: { inflation: { rate: 1, year: 1990 } } }).fiscalConfig.inflation).toBeUndefined();
  });

  it('plafond épargne retraite : gardé si lisible, sinon écarté', () => {
    expect(migrate({ config: { retirementCeiling: { year: 2026, amount: 5200 } } }).config.retirementCeiling).toEqual({ year: 2026, amount: 5200 });
    expect(migrate({ config: { retirementCeiling: { year: 2026, amount: -1 } } }).config.retirementCeiling).toBeUndefined();
    expect(migrate({ config: { retirementCeiling: 'beaucoup' } }).config.retirementCeiling).toBeUndefined();
  });
});

describe('ancien modèle « Objectifs »', () => {
  it("n'est plus créé, mais un fichier qui en contient le garde tel quel", () => {
    expect('goals' in emptyData()).toBe(false);
    const goals = [{ id: 'g', name: 'Voyage', targetAmount: 1000, savedAmount: 200 }, 'abîmé'];
    const m = migrate({ accounts: [], goals });
    expect((m as unknown as { goals: unknown }).goals).toEqual(goals);
    expect(canonicalize(migrate(m))).toBe(canonicalize(m));
  });
});
