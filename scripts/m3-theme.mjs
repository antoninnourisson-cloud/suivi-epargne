// Génère src/theme/m3.css : la palette Material 3 (outil officiel de Google,
// material-color-utilities, spécification 2025) à partir de la couleur de Pécule.
//   npm run theme
// Variante « fidélité » : le vert sapin #14532d reste exactement la couleur des conteneurs
// principaux. Les échelles Tailwind déjà utilisées partout (indigo = couleur principale,
// slate/gray = neutres) sont rebranchées sur les tons Material : tout l'écran change de
// peau sans réécrire chaque composant. Les tons sont choisis pour garder le contraste AA
// des combinaisons courantes (voir les commentaires de NEUTRAL et PRIMARY).
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  argbFromHex, hexFromArgb, Hct, SchemeFidelity, MaterialDynamicColors, TonalPalette,
} from '@material/material-color-utilities';

const SEED = '#14532d';   // vert sapin Pécule
const GOLD = '#fbbf24';   // or Pécule (part des parents, accents)

const mdc = new MaterialDynamicColors();
const seed = Hct.fromInt(argbFromHex(SEED));
const light = new SchemeFidelity(seed, false, 0, '2025');
const dark = new SchemeFidelity(seed, true, 0, '2025');
const gold = TonalPalette.fromHct(Hct.fromInt(argbFromHex(GOLD)));
const hex = (palette, tone) => hexFromArgb(palette.tone(tone));

// Échelle Tailwind → ton Material (0 = noir, 100 = blanc).
// Neutres : 500 (ton 45) garde ≥ 4,5:1 sur blanc et sur le fond ; 400 (ton 62) garde
// ≥ 4,5:1 sur les cartes du mode sombre (ton 17) ; 800 = cartes sombres, 900 = fond sombre.
const NEUTRAL = { 50: 98, 100: 94, 200: 90, 300: 80, 400: 62, 500: 45, 600: 38, 700: 30, 800: 17, 900: 8, 950: 4 };
// Principale : 600 (ton 42) porte du texte blanc à ≥ 6:1 ; 700 (ton 33) se lit sur blanc.
const PRIMARY = { 50: 97, 100: 93, 200: 86, 300: 77, 400: 65, 500: 52, 600: 42, 700: 33, 800: 25, 900: 18, 950: 10 };

const scale = (name, palette, map) =>
  Object.entries(map).map(([k, t]) => `  --color-${name}-${k}: ${hex(palette, t)};`).join('\n');

const ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'inversePrimary',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'surface', 'surfaceDim', 'surfaceBright', 'onSurface', 'onSurfaceVariant',
  'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest',
  'outline', 'outlineVariant', 'inverseSurface', 'inverseOnSurface', 'scrim', 'shadow',
];
const kebab = s => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
// Tons très clairs de la couleur principale (fonds teintés, sélection) : palette
// secondaire, moins saturée, sinon ils virent au vert menthe.
const primaryScale = name => Object.entries(PRIMARY)
  .map(([k, t]) => `  --color-${name}-${k}: ${hex(Number(k) <= 200 ? light.secondaryPalette : light.primaryPalette, t)};`).join('\n');
const roleVars = scheme => ROLES.map(r => `  --md-${kebab(r)}: ${hexFromArgb(mdc[r]().getArgb(scheme))};`).join('\n');
// Or : rôle « tertiaire » de Pécule (conteneur clair, texte foncé lisible).
const goldVars = isDark => isDark
  ? `  --md-tertiary: ${hex(gold, 80)};\n  --md-on-tertiary: ${hex(gold, 20)};\n  --md-tertiary-container: ${hex(gold, 30)};\n  --md-on-tertiary-container: ${hex(gold, 90)};`
  : `  --md-tertiary: ${hex(gold, 40)};\n  --md-on-tertiary: ${hex(gold, 100)};\n  --md-tertiary-container: ${hex(gold, 90)};\n  --md-on-tertiary-container: ${hex(gold, 10)};`;

const css = `/* Généré par scripts/m3-theme.mjs (npm run theme) : ne pas modifier à la main. */

@theme {
  /* Couleur principale (vert sapin), en tons Material. */
${primaryScale('indigo')}
${primaryScale('sapin')}
  --color-sapin: ${SEED};
  /* Neutres Material, légèrement teintés de vert. */
${scale('slate', light.neutralPalette, NEUTRAL)}
${scale('gray', light.neutralPalette, NEUTRAL)}
${scale('stone', light.neutralPalette, NEUTRAL)}

  /* Rôles Material 3 (clair/sombre), utilisables en classes : bg-surface-container, text-on-surface… */
${ROLES.map(r => `  --color-${kebab(r)}: var(--md-${kebab(r)});`).join('\n')}
  --color-tertiary: var(--md-tertiary);
  --color-on-tertiary: var(--md-on-tertiary);
  --color-tertiary-container: var(--md-tertiary-container);
  --color-on-tertiary-container: var(--md-on-tertiary-container);
}

:root {
${roleVars(light)}
${goldVars(false)}
}

html.dark {
${roleVars(dark)}
${goldVars(true)}
}
`;

mkdirSync('src/theme', { recursive: true });
writeFileSync('src/theme/m3.css', css);
console.log('src/theme/m3.css écrit');
