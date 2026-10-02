import { describe, it, expect } from 'vitest';
import { migrate, canonicalize, isFromNewerApp, validateImport, stripDeviceSecrets, APP_SCHEMA_VERSION, stableStringify } from './schema';

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
  it("refuse un import invalide et accepte un fichier correct", () => {
    expect(validateImport('x').length).toBeGreaterThan(0);
    expect(validateImport({ accounts: [{ id: 'a', name: 'A', totalAmount: '<script>' }] }).length).toBe(1);
    expect(validateImport({ accounts: [{ id: 'a', name: 'A', totalAmount: 10 }] })).toEqual([]);
  });
  it('retire la clé Gemini avant tout envoi', () => {
    const d = stripDeviceSecrets(migrate({ accounts: [], config: { geminiApiKey: 'k', pickerApiKey: 'p' } }));
    expect((d.config as any).geminiApiKey).toBeUndefined();
    expect(d.config.pickerApiKey).toBe('p');
  });
  it('stableStringify omet les undefined', () => {
    expect(stableStringify({ b: 1, a: undefined })).toBe('{"b":1}');
  });
});
