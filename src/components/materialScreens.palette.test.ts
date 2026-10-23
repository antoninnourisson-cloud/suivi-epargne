// @vitest-environment node
// Garde-fou Material 3 : les écrans convertis n'utilisent plus que les rôles de couleur du
// thème (bg-surface-container, text-on-surface-variant…), jamais une palette brute (slate,
// indigo, emerald…) que le thème sombre ne saurait pas adapter, ni un texte sous 12 px.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCREENS = [
  'Journal', 'TransferManager', 'Agenda', 'Subscriptions', 'History', 'MovementSearch', 'QuickAddModal', 'SplitProjectionCard',
  'AccountForm', 'AccountsView', 'Yield',
];

const RAW_PALETTE = /\b(?:bg|text|border|divide|ring|outline|fill|stroke|from|to|via|decoration|accent|shadow)-(?:slate|gray|grey|zinc|neutral|stone|indigo|emerald|rose|amber|violet|pink|teal|sky|purple|green|red|blue|yellow|orange|lime|cyan|fuchsia)-\d{2,3}/;
const TINY_TEXT = /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/;

describe.each(SCREENS)('%s (Material 3)', name => {
  const source = readFileSync(fileURLToPath(new URL(`./${name}.tsx`, import.meta.url)), 'utf8');

  it('aucune classe de palette brute (slate, indigo, emerald, rose, amber…)', () => {
    expect(source.match(RAW_PALETTE)).toBeNull();
  });

  it('aucun texte de moins de 12 px', () => {
    expect(source.match(TINY_TEXT)).toBeNull();
  });
});
