/**
 * Version la plus récente de l'historique, lue dans le texte source de src/changelog.ts (la
 * première entrée, `version: 'AAAA.MM.JJ'`). Sert au build (vite.config.ts) : la version
 * s'affiche dès le démarrage sans charger tout l'historique. `null` si introuvable.
 */
export const latestVersionFromChangelog = (source: string): string | null =>
  /^\s*version:\s*'([^']+)'/m.exec(source)?.[1] ?? null;
