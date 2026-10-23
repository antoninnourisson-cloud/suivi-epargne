// Génère src/theme/m3.css : la palette Material 3 (outil officiel de Google,
// material-color-utilities, spécification 2025) à partir de la couleur de Pécule.
//   npm run theme
// Variante « fidélité » : le vert sapin #14532d reste exactement la couleur des conteneurs
// principaux. Seuls les RÔLES sont exposés (bg-surface-container, text-on-surface-variant,
// text-gain…), en clair et en sombre : aucune échelle Tailwind numérotée (slate-800,
// indigo-600…) n'est rebranchée, elles ne s'adapteraient pas au thème sombre. Le lint
// (eslint.config.js) et src/components/paletteGuard.test.ts les refusent dans le code.
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  argbFromHex, hexFromArgb, Blend, Hct, SchemeFidelity, MaterialDynamicColors, TonalPalette,
} from '@material/material-color-utilities';

const SEED = '#14532d';   // vert sapin Pécule
const GOLD = '#fbbf24';   // or Pécule (part des parents, accents)
// Couleurs de sens (« couleurs personnalisées » de Material 3), rapprochées du vert sapin
// (Blend.harmonize) pour rester dans la même famille : gain (vert), perte (rouge).
const GAIN = '#059669';
const LOSS = '#e11d48';

const mdc = new MaterialDynamicColors();
const seed = Hct.fromInt(argbFromHex(SEED));
const light = new SchemeFidelity(seed, false, 0, '2025');
const dark = new SchemeFidelity(seed, true, 0, '2025');
const gold = TonalPalette.fromHct(Hct.fromInt(argbFromHex(GOLD)));
const harmonized = color => TonalPalette.fromHct(Hct.fromInt(Blend.harmonize(argbFromHex(color), argbFromHex(SEED))));
const gain = harmonized(GAIN);
const loss = harmonized(LOSS);
// Version adoucie d'une palette (conteneurs) : à pleine saturation, le vert vire au menthe fluo.
const soft = palette => TonalPalette.fromHueAndChroma(palette.hue, Math.min(palette.chroma, 28));
const hex = (palette, tone) => hexFromArgb(palette.tone(tone));

const ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'inversePrimary',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'surface', 'surfaceDim', 'surfaceBright', 'onSurface', 'onSurfaceVariant',
  'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest',
  'outline', 'outlineVariant', 'inverseSurface', 'inverseOnSurface', 'scrim', 'shadow',
];
const kebab = s => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const roleVars = scheme => ROLES.map(r => `  --md-${kebab(r)}: ${hexFromArgb(mdc[r]().getArgb(scheme))};`).join('\n');
// Or : rôle « tertiaire » de Pécule (conteneur clair, texte foncé lisible).
const goldVars = isDark => isDark
  ? `  --md-tertiary: ${hex(gold, 80)};\n  --md-on-tertiary: ${hex(gold, 20)};\n  --md-tertiary-container: ${hex(gold, 30)};\n  --md-on-tertiary-container: ${hex(gold, 90)};`
  : `  --md-tertiary: ${hex(gold, 40)};\n  --md-on-tertiary: ${hex(gold, 100)};\n  --md-tertiary-container: ${hex(gold, 90)};\n  --md-on-tertiary-container: ${hex(gold, 10)};`;
// Erreur sur la surface inversée (icône d'une notification d'erreur) : Material n'a pas de
// rôle « inverse-error » ; comme inverse-primary, on prend l'erreur du thème opposé.
const inverseErrorVar = isDark => `  --md-inverse-error: ${hexFromArgb(mdc.error().getArgb(isDark ? light : dark))};`;

// Rôles de sens, déclarés une fois ici et employés partout (MoneyText, DeltaBadge, barres) :
// - gain / loss : montant en hausse ou en baisse ;
// - parents : la part des parents (même or que le rôle « tertiaire »).
// Chaque rôle a sa couleur, son conteneur et leurs textes, en clair et en sombre (tons
// Material : 40/100/90/10 en clair, 80/20/30/90 en sombre, contraste AA garanti).
const SEMANTIC = { gain, loss, parents: gold };
const semanticVars = isDark => Object.entries(SEMANTIC).map(([name, p]) => {
  const [c, on, container, onContainer] = isDark ? [80, 20, 30, 90] : [40, 100, 90, 10];
  // Parents : exactement l'or du rôle tertiaire (conteneur compris).
  const box = name === 'parents' ? p : soft(p);
  return [
    `  --md-${name}: ${hex(p, c)};`,
    `  --md-on-${name}: ${hex(p, on)};`,
    `  --md-${name}-container: ${hex(box, container)};`,
    `  --md-on-${name}-container: ${hex(box, onContainer)};`,
  ].join('\n');
}).join('\n');
const semanticTheme = Object.keys(SEMANTIC).map(name => [
  `  --color-${name}: var(--md-${name});`,
  `  --color-on-${name}: var(--md-on-${name});`,
  `  --color-${name}-container: var(--md-${name}-container);`,
  `  --color-on-${name}-container: var(--md-on-${name}-container);`,
].join('\n')).join('\n');

const css = `/* Généré par scripts/m3-theme.mjs (npm run theme) : ne pas modifier à la main. */

@theme {
  /* Vert sapin de la marque, identique en clair et en sombre (écrans de connexion et de verrou). */
  --color-sapin: ${SEED};

  /* Rôles Material 3 (clair/sombre), utilisables en classes : bg-surface-container, text-on-surface… */
${ROLES.map(r => `  --color-${kebab(r)}: var(--md-${kebab(r)});`).join('\n')}
  --color-inverse-error: var(--md-inverse-error);
  --color-tertiary: var(--md-tertiary);
  --color-on-tertiary: var(--md-on-tertiary);
  --color-tertiary-container: var(--md-tertiary-container);
  --color-on-tertiary-container: var(--md-on-tertiary-container);
  /* Rôles de sens : text-gain, bg-loss-container, text-on-parents-container… */
${semanticTheme}
}

:root {
${roleVars(light)}
${inverseErrorVar(false)}
${goldVars(false)}
${semanticVars(false)}
}

html.dark {
${roleVars(dark)}
${inverseErrorVar(true)}
${goldVars(true)}
${semanticVars(true)}
}
`;

mkdirSync('src/theme', { recursive: true });
writeFileSync('src/theme/m3.css', css);
console.log('src/theme/m3.css écrit');
