// @vitest-environment node
// Rôles de sens du thème (src/theme/m3.css, généré par scripts/m3-theme.mjs) : gain, perte et
// part des parents sont déclarés UNE fois, en clair et en sombre, avec leur conteneur et leurs
// textes. Ce test garde leur lisibilité (contraste AA, WCAG 1.4.3) et le lien entre « parents »
// et l'or du rôle tertiaire : la part des parents garde la même couleur sur tous les écrans.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../theme/m3.css', import.meta.url)), 'utf8');

/** Variables `--md-*` d'un bloc (`:root` ou `html.dark`). */
const block = (selector: string): Record<string, string> => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries(Array.from(body.matchAll(/--md-([a-z0-9-]+):\s*(#[0-9a-f]{6});/g), m => [m[1], m[2]]));
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const ROLES = ['gain', 'loss', 'parents'] as const;
const THEMES: [string, string][] = [['clair', ':root'], ['sombre', 'html.dark']];

describe.each(THEMES)('rôles de sens, thème %s', (_label, selector) => {
  const v = block(selector);

  it.each(ROLES)('« %s » : couleur, conteneur et textes sont déclarés', role => {
    for (const key of [role, `on-${role}`, `${role}-container`, `on-${role}-container`]) expect(v[key], key).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(ROLES)('« %s » : lisible sur son conteneur et sur les surfaces des cartes', role => {
    expect(contrast(v[`on-${role}`], v[role]), 'texte sur la couleur').toBeGreaterThanOrEqual(4.5);
    expect(contrast(v[`on-${role}-container`], v[`${role}-container`]), 'texte sur le conteneur').toBeGreaterThanOrEqual(4.5);
    // Un montant en text-gain / text-loss / text-parents sur le fond de page et sur chaque niveau de carte.
    for (const surface of ['surface', 'surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high']) {
      expect(contrast(v[role], v[surface]), `${role} sur ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('« parents » est exactement l’or du rôle tertiaire', () => {
    expect(v.parents).toBe(v.tertiary);
    expect(v['parents-container']).toBe(v['tertiary-container']);
    expect(v['on-parents-container']).toBe(v['on-tertiary-container']);
  });

  it('« inverse-error » (icône d’une notification d’erreur) se lit sur la surface inversée', () => {
    expect(contrast(v['inverse-error'], v['inverse-surface'])).toBeGreaterThanOrEqual(4.5);
  });

  // Barre « Enregistrer » d'Actualiser les soldes (AccountUpdate) et notifications : texte
  // en inverse-on-surface, bouton texte « Abandonner » en inverse-primary sur la surface
  // inversée, bouton plein « Enregistrer » en inverse-surface sur inverse-primary.
  it('la surface inversée (barre d’enregistrement, notifications) reste lisible', () => {
    expect(contrast(v['inverse-on-surface'], v['inverse-surface']), 'texte').toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['inverse-primary'], v['inverse-surface']), 'boutons « Abandonner » et « Enregistrer »').toBeGreaterThanOrEqual(4.5);
  });
});

it('l’erreur sur surface inversée est l’erreur du thème opposé, en classe utilitaire', () => {
  expect(block(':root')['inverse-error']).toBe(block('html.dark').error);
  expect(block('html.dark')['inverse-error']).toBe(block(':root').error);
  expect(css).toContain('--color-inverse-error: var(--md-inverse-error);');
});

it('les rôles de sens sont aussi des classes utilitaires (text-gain, bg-loss-container…)', () => {
  for (const role of ROLES) {
    for (const key of [role, `on-${role}`, `${role}-container`, `on-${role}-container`]) {
      expect(css).toContain(`--color-${key}: var(--md-${key});`);
    }
  }
});
