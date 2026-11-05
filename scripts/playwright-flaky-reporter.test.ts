// Reporter des tests instables (scripts/playwright-flaky-reporter.mjs).
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import FlakyReporter, { escapeData } from './playwright-flaky-reporter.mjs';

const fakeTest = (outcome: string) => ({
  outcome: () => outcome,
  titlePath: () => ['', 'mobile', 'e2e/accueil.spec.ts', 'Accueil', 'affiche le solde: 100 %'],
  location: { file: path.join(process.cwd(), 'e2e', 'accueil.spec.ts'), line: 12 },
});

describe('playwright-flaky-reporter', () => {
  it('avertit pour un test réussi au deuxième essai, et écrit le résumé', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'flaky-'));
    const summaryFile = path.join(dir, 'summary.md');
    const lines: string[] = [];
    const r = new FlakyReporter({ write: l => lines.push(l), summaryFile });
    r.onTestEnd(fakeTest('flaky'), { status: 'failed', retry: 0 });
    r.onTestEnd(fakeTest('flaky'), { status: 'passed', retry: 1 });
    r.onEnd();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^::warning title=Test instable,file=e2e\/accueil\.spec\.ts,line=12::mobile › e2e\/accueil\.spec\.ts › Accueil › affiche le solde: 100 %25 : réussi seulement au 2e essai\.$/);
    const summary = readFileSync(summaryFile, 'utf8');
    expect(summary).toContain('### Tests instables');
    expect(summary).toContain('`e2e/accueil.spec.ts:12`');
  });

  it('ignore les tests réussis du premier coup et les échecs définitifs', () => {
    const lines: string[] = [];
    const r = new FlakyReporter({ write: l => lines.push(l), summaryFile: path.join(tmpdir(), 'inexistant', 'x.md') });
    r.onTestEnd(fakeTest('expected'), { status: 'passed', retry: 0 });
    r.onTestEnd(fakeTest('unexpected'), { status: 'failed', retry: 1 });
    r.onEnd();
    expect(lines).toEqual([]);
    expect(existsSync(path.join(tmpdir(), 'inexistant'))).toBe(false);
  });

  it('échappe les retours à la ligne des commandes de workflow', () => {
    expect(escapeData('a\nb%')).toBe('a%0Ab%25');
  });
});
