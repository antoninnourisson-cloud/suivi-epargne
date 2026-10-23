import { describe, expect, it } from 'vitest';
import { initialPreference, isThemePreference, resolveDark, toggledPreference } from './theme';

describe('thème', () => {
  it('suit le système en « Automatique », sinon le choix', () => {
    expect(resolveDark('system', true)).toBe(true);
    expect(resolveDark('system', false)).toBe(false);
    expect(resolveDark('dark', false)).toBe(true);
    expect(resolveDark('light', true)).toBe(false);
  });

  it('lit le choix enregistré en priorité', () => {
    expect(initialPreference('dark', 'light', false)).toBe('dark');
    expect(initialPreference('light', null, true)).toBe('light');
    expect(initialPreference(null, null, true)).toBe('system');
    expect(initialPreference('n’importe quoi', null, false)).toBe('system');
  });

  it("ne prend pas pour un choix l'ancienne valeur écrite d'office (égale au système)", () => {
    // Premier lancement en clair, système toujours clair : pas un choix.
    expect(initialPreference(null, 'light', false)).toBe('system');
    expect(initialPreference(null, 'dark', true)).toBe('system');
    // Différente du système : très probablement un choix, gardé.
    expect(initialPreference(null, 'dark', false)).toBe('dark');
    expect(initialPreference(null, 'light', true)).toBe('light');
    expect(initialPreference(null, 'abîmé', true)).toBe('system');
  });

  it('le bouton rapide passe au thème inverse de celui affiché', () => {
    expect(toggledPreference(true)).toBe('light');
    expect(toggledPreference(false)).toBe('dark');
  });

  it('reconnaît les préférences valides', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('auto')).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});
