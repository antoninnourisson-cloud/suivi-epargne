// @vitest-environment node
// Garde-fou Material 3 (Dons et impôts, Part parentale, Restitution, Fiches de paie, Où le
// placer, boîte de confirmation, bouton) : rôles de couleur du thème uniquement, jamais une
// palette brute (slate, indigo, emerald…) que le thème sombre ne saurait pas adapter, ni
// de texte sous 12 px, ni de chiffres en police à chasse fixe (les chiffres tabulaires de la
// police de la marque suffisent). Les anciens noms de variantes de bouton ont disparu.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILES = [
  'Donations.tsx', 'ParentalShare.tsx', 'RestitutionPanel.tsx', 'Payslips.tsx', 'PayChecklist.tsx',
  'TaxReturnHelper.tsx', 'Dialog.tsx', 'Button.tsx', 'Modal.tsx', 'focusAfterRemoval.ts',
];

const RAW_PALETTE = /\b(?:bg|text|border|divide|ring|outline|fill|stroke|from|to|via|decoration|accent|shadow)-(?:slate|gray|grey|zinc|neutral|stone|indigo|emerald|rose|amber|violet|pink|teal|sky|purple|green|red|blue|yellow|orange|lime|cyan|fuchsia)-\d{2,3}/;
const TINY_TEXT = /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/;
const LEGACY_VARIANT = /variant=(?:["']|\{["'])(?:primary|secondary|ghost)\b/;

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

describe.each(FILES)('%s (Material 3)', name => {
  const source = read(name);

  it('aucune classe de palette brute (slate, indigo, emerald, rose, amber…)', () => {
    expect(source.match(RAW_PALETTE)).toBeNull();
  });

  it('aucun texte de moins de 12 px, aucune police à chasse fixe', () => {
    expect(source.match(TINY_TEXT)).toBeNull();
    expect(source.match(/\bfont-mono\b/)).toBeNull();
  });

  it('aucun bouton aux anciens noms primary / secondary / ghost', () => {
    expect(source.match(LEGACY_VARIANT)).toBeNull();
  });
});

describe('Button', () => {
  it("n'accepte plus les anciens noms de variantes", () => {
    const source = read('Button.tsx');
    expect(source).not.toMatch(/'(?:primary|secondary|ghost)'/);
  });
});
