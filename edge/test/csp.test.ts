// Politique de contenu (CSP) d'index.html : scripts Google limités aux fichiers exacts que
// l'app charge (src/services/googleDriveService.ts), jamais un domaine entier.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
const directive = (name: string): string[] => {
  const d = csp.split(';').map(s => s.trim()).find(s => s.startsWith(`${name} `));
  return d ? d.split(/\s+/).slice(1) : [];
};

describe('CSP d’index.html', () => {
  it('scripts : la page elle-même et les seuls fichiers Google chargés à la demande', () => {
    expect(directive('script-src')).toEqual([
      "'self'", 'https://accounts.google.com/gsi/client', 'https://apis.google.com/js/api.js', 'https://apis.google.com/_/scs/abc-static/',
    ]);
    // Aucun domaine entier (accounts.google.com héberge un point JSONP connu), aucun script en ligne.
    expect(csp).not.toMatch(/script-src[^;]*https:\/\/(?:accounts|apis)\.google\.com[\s;]/);
  });

  it('les adresses de scripts du code correspondent à la CSP', () => {
    const service = readFileSync(fileURLToPath(new URL('../../src/services/googleDriveService.ts', import.meta.url)), 'utf8');
    for (const src of service.match(/'https:\/\/(?:accounts|apis)\.google\.com\/[^']+'/g)!.map(s => s.slice(1, -1))) {
      expect(directive('script-src').some(allowed => allowed.endsWith('/') ? src.startsWith(allowed) : src === allowed), src).toBe(true);
    }
  });

  it('pas d’objets ni de base étrangère ; styles Google limités à GIS', () => {
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'self'"]);
    expect(directive('style-src')).toEqual(["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style']);
  });
});
