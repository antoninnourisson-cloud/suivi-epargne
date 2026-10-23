// @vitest-environment node
// public/theme-boot.js pose le thème sombre avant le premier affichage (pas d'éclair clair) :
// il doit décider EXACTEMENT comme src/lib/theme.ts, que useTheme applique ensuite, sinon
// l'écran changerait de thème au démarrage.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialPreference, resolveDark } from './theme';

const script = readFileSync(fileURLToPath(new URL('../../public/theme-boot.js', import.meta.url)), 'utf8');

/** Lance le script avec un faux stockage et un faux réglage de l'appareil ; rend la classe posée. */
const boot = (stored: Record<string, string | null>, systemDark: boolean | null, storageThrows = false): boolean => {
  const classes = new Set<string>();
  const window = {
    get localStorage() {
      if (storageThrows) throw new Error('SecurityError');
      return { getItem: (k: string) => stored[k] ?? null };
    },
    matchMedia: systemDark === null ? undefined : (q: string) => ({ matches: q === '(prefers-color-scheme: dark)' && systemDark }),
  };
  const document = { documentElement: { classList: { add: (c: string) => classes.add(c) } } };
  new Function('window', 'document', script)(window, document);
  return classes.has('dark');
};

describe('theme-boot.js', () => {
  const CHOICES = [null, 'light', 'dark', 'abîmé'];
  const LEGACY = [null, 'light', 'dark'];
  for (const choice of CHOICES) for (const legacy of LEGACY) for (const systemDark of [false, true]) {
    it(`choix ${choice}, ancienne clé ${legacy}, appareil ${systemDark ? 'sombre' : 'clair'} : comme lib/theme`, () => {
      const expected = resolveDark(initialPreference(choice, legacy, systemDark), systemDark);
      expect(boot({ theme_choice: choice, theme: legacy }, systemDark)).toBe(expected);
    });
  }

  it('sans matchMedia ni choix : clair, et sans erreur', () => {
    expect(boot({}, null)).toBe(false);
  });

  it('stockage bloqué : rien posé, pas d’erreur (useTheme décidera au démarrage)', () => {
    expect(() => boot({}, true, true)).not.toThrow();
    expect(boot({}, true, true)).toBe(false);
  });
});
