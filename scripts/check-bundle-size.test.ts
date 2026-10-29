// Garde-fou de la taille du fichier principal (scripts/check-bundle-size.mjs).
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkBuild, LIMIT_KB, mainEntryPath, verdict } from './check-bundle-size.mjs';

describe('check-bundle-size', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  const build = (html: string, files: Record<string, number> = {}) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pecule-size-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), html);
    for (const [name, size] of Object.entries(files)) writeFileSync(path.join(dir, name), 'x'.repeat(size));
    return dir;
  };
  const html = '<script src="theme-boot.js"></script><script type="module" crossorigin src="./assets/index-abc.js"></script><script id="sw" src="./registerSW.js"></script>';

  it('trouve le script module de index.html (pas les scripts classiques)', () => {
    expect(mainEntryPath(html)).toBe('assets/index-abc.js');
    expect(mainEntryPath("<script type='module' src='/assets/a.js'>")).toBe('assets/a.js');
    expect(mainEntryPath('<script src="a.js">')).toBeNull();
  });

  it('plafond en kB de Vite (1 000 octets), limite comprise', () => {
    expect(LIMIT_KB).toBe(500);
    expect(verdict('a.js', 500_000).ok).toBe(true);
    const over = verdict('a.js', 500_001);
    expect(over.ok).toBe(false);
    expect(over.message).toContain('trop lourd');
    expect(verdict('a.js', 493_480).message).toContain('marge 6.52 kB');
  });

  it('contrôle un dossier de build', () => {
    expect(checkBuild(build(html, { 'assets/index-abc.js': 1000 }), 2).ok).toBe(true);
    expect(checkBuild(build(html, { 'assets/index-abc.js': 3000 }), 2).ok).toBe(false);
  });

  it('échoue clairement sans build, sans script principal ou sans le fichier cité', () => {
    expect(checkBuild(path.join(tmpdir(), 'pecule-absent-xyz')).message).toContain('Build introuvable');
    expect(checkBuild(build('<p></p>')).message).toContain('aucun <script');
    expect(checkBuild(build(html)).message).toContain('absent du build');
  });
});
