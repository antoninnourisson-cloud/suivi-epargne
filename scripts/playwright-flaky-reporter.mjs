// Reporter Playwright : signale chaque test « instable », c'est-à-dire réussi seulement au
// deuxième essai (en CI, playwright.config.ts relance une fois un test qui échoue).
// Le reporter 'github' de Playwright les range parmi les erreurs ; ici : une annotation
// ::warning par test (visible sur la page de l'exécution) et un résumé du job
// (GITHUB_STEP_SUMMARY). Chaque tranche (shard) a son propre job, donc son propre résumé.
// Le résultat des tests n'est pas modifié : ce reporter ne fait que lire.
import { appendFileSync } from 'node:fs';
import path from 'node:path';

/** Échappe un texte pour une commande de workflow GitHub (::warning ...::message). */
export const escapeData = text => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export const escapeProperty = text => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

export default class FlakyReporter {
  constructor(options = {}) {
    this.flaky = [];
    this.write = options.write ?? (line => process.stdout.write(`${line}\n`));
    this.summaryFile = options.summaryFile ?? process.env.GITHUB_STEP_SUMMARY;
  }

  printsToStdio() { return false; }

  onTestEnd(test, result) {
    // Réussi après au moins un échec : c'est le dernier résultat, passé, avec retry > 0.
    if (result.status !== 'passed' || result.retry < 1 || test.outcome() !== 'flaky') return;
    const title = test.titlePath().slice(1).filter(Boolean).join(' › ');
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const file = path.relative(workspace, test.location.file).split(path.sep).join('/');
    this.flaky.push({ title, file, line: test.location.line, attempts: result.retry + 1 });
  }

  onEnd() {
    if (!this.flaky.length) return;
    for (const t of this.flaky) {
      this.write(`::warning title=${escapeProperty('Test instable')},file=${escapeProperty(t.file)},line=${t.line}::${escapeData(`${t.title} : réussi seulement au ${t.attempts}e essai.`)}`);
    }
    if (!this.summaryFile) return;
    const lines = [
      '### Tests instables',
      '',
      `${this.flaky.length} test(s) réussi(s) seulement à un nouvel essai. Ils passent, mais ils sont fragiles : à regarder avant qu'ils ne cassent la mise en ligne.`,
      '',
      ...this.flaky.map(t => `- \`${t.file}:${t.line}\` — ${t.title}`),
      '',
    ];
    try { appendFileSync(this.summaryFile, lines.join('\n')); } catch { /* résumé facultatif */ }
  }
}
