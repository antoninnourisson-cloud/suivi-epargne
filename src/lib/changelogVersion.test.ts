// La version affichée au démarrage est lue dans le texte de src/changelog.ts au build
// (vite.config.ts) : elle doit être exactement LATEST_VERSION.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { latestVersionFromChangelog } from './changelogVersion';
import { LATEST_VERSION } from '../changelog';
import { APP_VERSION } from '../appVersion';

describe('latestVersionFromChangelog', () => {
  it('donne la première version de src/changelog.ts, celle de LATEST_VERSION', () => {
    const source = readFileSync(path.resolve(__dirname, '../changelog.ts'), 'utf8');
    expect(latestVersionFromChangelog(source)).toBe(LATEST_VERSION);
    expect(APP_VERSION).toBe(LATEST_VERSION);
  });

  it('ignore la déclaration du type et renvoie null sans entrée', () => {
    expect(latestVersionFromChangelog("interface E {\n  version: string;\n}\nconst C = [\n  {\n    version: '2026.10.20-2',\n  },\n  {\n    version: '2026.10.01',\n  },\n];")).toBe('2026.10.20-2');
    expect(latestVersionFromChangelog('export const CHANGELOG = [];')).toBeNull();
  });
});
