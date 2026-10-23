// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { resetThemeForTests, useTheme } from './useTheme';

type Listener = (e: { matches: boolean }) => void;

/** Système simulé : clair ou sombre, avec bascule en direct. */
const fakeSystem = (dark: boolean) => {
  const listeners: Listener[] = [];
  const mq = { matches: dark, addEventListener: (_: string, l: Listener) => { listeners.push(l); } };
  vi.stubGlobal('matchMedia', vi.fn(() => mq));
  return { flip: (next: boolean) => { mq.matches = next; listeners.forEach(l => l({ matches: next })); } };
};

const metaColors = () => Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map(m => [m.content, m.getAttribute('media')]);

beforeEach(() => {
  localStorage.clear();
  resetThemeForTests();
  document.documentElement.className = '';
  document.head.innerHTML = '<meta name="theme-color" content="#ecefe9" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1d201d" media="(prefers-color-scheme: dark)">';
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('useTheme', () => {
  it('suit le système sans rien enregistrer, et le suit en direct', () => {
    const system = fakeSystem(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.isDark).toBe(false);
    expect(localStorage.getItem('theme_choice')).toBeNull();
    expect(localStorage.getItem('theme')).toBeNull();
    // Une seule balise, accordée au thème affiché (plus de « media » qui suivrait le système).
    expect(metaColors()).toEqual([['#ecefe9', null]]);

    act(() => system.flip(true));
    expect(result.current.isDark).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(metaColors()).toEqual([['#1d201d', null]]);
  });

  it('enregistre un choix explicite, qui ne suit plus le système', () => {
    const system = fakeSystem(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggleTheme());
    expect(result.current.preference).toBe('dark');
    expect(result.current.isDark).toBe(true);
    expect(localStorage.getItem('theme_choice')).toBe('dark');

    act(() => system.flip(true));
    act(() => system.flip(false));
    expect(result.current.isDark).toBe(true);

    // Retour à « Automatique » : le choix est effacé, le système reprend la main.
    act(() => result.current.setPreference('system'));
    expect(localStorage.getItem('theme_choice')).toBeNull();
    expect(result.current.isDark).toBe(false);
  });

  it("reprend l'ancienne clé une fois : égale au système, ce n'était pas un choix", () => {
    fakeSystem(true);
    localStorage.setItem('theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(localStorage.getItem('theme')).toBeNull();
    expect(localStorage.getItem('theme_choice')).toBeNull();
  });

  it("reprend l'ancienne clé une fois : différente du système, c'est un choix gardé", () => {
    fakeSystem(false);
    localStorage.setItem('theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('dark');
    expect(result.current.isDark).toBe(true);
    expect(localStorage.getItem('theme')).toBeNull();
    expect(localStorage.getItem('theme_choice')).toBe('dark');
  });

  it('partage le même état entre deux composants', () => {
    fakeSystem(false);
    const a = renderHook(() => useTheme());
    const b = renderHook(() => useTheme());
    act(() => a.result.current.setPreference('dark'));
    expect(b.result.current.preference).toBe('dark');
    expect(b.result.current.isDark).toBe(true);
  });

  it('fonctionne sans matchMedia ni balise theme-color', () => {
    vi.stubGlobal('matchMedia', undefined);
    document.head.innerHTML = '';
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(false);
    expect(metaColors()).toEqual([['#ecefe9', null]]);
  });
});
