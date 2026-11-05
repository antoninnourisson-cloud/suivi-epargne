// Garde-fous de la taille du démarrage (scripts/check-bundle-size.mjs).
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkBuild, LIMIT_KB, STARTUP_LIMIT_KB, lazyInStartup, mainEntryPath, preloadedPaths, startupFiles, startupVerdict, staticImports, verdict,
} from './check-bundle-size.mjs';

describe('check-bundle-size', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  const build = (html: string, files: Record<string, number | string> = {}) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pecule-size-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), html);
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), typeof content === 'string' ? content : 'x'.repeat(content));
    return dir;
  };
  const html = '<script src="theme-boot.js"></script><script type="module" crossorigin src="./assets/index-abc.js"></script><script id="sw" src="./registerSW.js"></script>';

  it('trouve le script module de index.html (pas les scripts classiques)', () => {
    expect(mainEntryPath(html)).toBe('assets/index-abc.js');
    expect(mainEntryPath("<script type='module' src='/assets/a.js'>")).toBe('assets/a.js');
    expect(mainEntryPath('<script src="a.js">')).toBeNull();
    expect(mainEntryPath('<SCRIPT TYPE="module" SRC="/assets/b.js"></SCRIPT>')).toBe('assets/b.js');
  });

  it('plafond en kB de Vite (1 000 octets), limite comprise', () => {
    expect(LIMIT_KB).toBe(350);
    expect(verdict('a.js', 350_000).ok).toBe(true);
    const over = verdict('a.js', 350_001);
    expect(over.ok).toBe(false);
    expect(over.message).toContain('trop lourd');
    expect(verdict('a.js', 343_480).message).toContain('marge 6.52 kB');
  });

  it('contrôle un dossier de build', () => {
    expect(checkBuild(build(html, { 'assets/index-abc.js': 1000 }), 2).ok).toBe(true);
    expect(checkBuild(build(html, { 'assets/index-abc.js': 3000 }), 2).ok).toBe(false);
  });


  const startupHtml = '<script type="module" src="./assets/index-m.js"></script><link rel="modulepreload" crossorigin href="./assets/react-r.js"><link rel="stylesheet" href="./assets/index-c.css">';

  it('relève les préchargements de index.html (modulepreload seulement)', () => {
    expect(preloadedPaths(startupHtml)).toEqual(['assets/react-r.js']);
    expect(preloadedPaths('<link rel="stylesheet" href="a.css">')).toEqual([]);
  });

  it('ne compte que les imports statiques, pas les import() à la demande', () => {
    const code = 'import{r as e}from"./rolldown-runtime-a.js";import"./side-b.js";export*from"./all-c.js";export{x as y}from"./re-d.js";const lazy=()=>import("./lazy-e.js");';
    expect(staticImports(code)).toEqual(['rolldown-runtime-a.js', 'side-b.js', 'all-c.js', 're-d.js']);
  });

  it('suit les imports statiques depuis le fichier principal et les préchargés', () => {
    const dir = build(startupHtml, {
      'assets/index-m.js': 'import{a}from"./ui-u.js";const l=()=>import("./Screen-s.js");',
      'assets/react-r.js': 'export const r=1;',
      'assets/ui-u.js': 'import{r}from"./react-r.js";export const a=r;',
      'assets/Screen-s.js': 'import{r}from"./react-r.js";',
    });
    expect(startupFiles(dir, startupHtml).sort()).toEqual(['assets/index-m.js', 'assets/react-r.js', 'assets/ui-u.js']);
  });

  it('plafond du démarrage, limite comprise', () => {
    expect(STARTUP_LIMIT_KB).toBe(800);
    expect(startupVerdict(20, 800_000).ok).toBe(true);
    const over = startupVerdict(20, 800_001);
    expect(over.ok).toBe(false);
    expect(over.message).toContain('Démarrage trop lourd');
    expect(startupVerdict(20, 585_911).message).toContain('585.91 kB en 20 fichiers');
  });

  it('refuse un fichier à charger à la demande trouvé au démarrage', () => {
    expect(lazyInStartup(['assets/index-m.js', 'assets/charts-AbC1.js', 'assets/chartData-x.js'])).toEqual(['assets/charts-AbC1.js']);
    const dir = build(startupHtml, {
      'assets/index-m.js': 'import{c}from"./charts-z.js";',
      'assets/react-r.js': 'export const r=1;',
      'assets/charts-z.js': 'export const c=1;',
    });
    const res = checkBuild(dir, 5, 5);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('charts-z.js');
    expect(res.message).toContain('à la demande');
    const clean = build(startupHtml, {
      'assets/index-m.js': 'import{r}from"./react-r.js";const c=()=>import("./charts-z.js");',
      'assets/react-r.js': 'export const r=1;',
      'assets/charts-z.js': 'export const c=1;',
    });
    expect(checkBuild(clean, 5, 5).ok).toBe(true);
  });

  it('échoue si le total du démarrage dépasse son plafond, même quand le fichier principal est petit', () => {
    const dir = build(startupHtml, {
      'assets/index-m.js': 'import{r}from"./react-r.js";',
      'assets/react-r.js': 2500,
    });
    const res = checkBuild(dir, 2, 2);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Démarrage trop lourd');
    expect(res.message).toContain('Fichier principal : assets/index-m.js');
  });

  it('échoue clairement sans build, sans script principal ou sans le fichier cité', () => {
    expect(checkBuild(path.join(tmpdir(), 'pecule-absent-xyz')).message).toContain('Build introuvable');
    expect(checkBuild(build('<p></p>')).message).toContain('aucun <script');
    expect(checkBuild(build(html)).message).toContain('absent du build');
  });
});
