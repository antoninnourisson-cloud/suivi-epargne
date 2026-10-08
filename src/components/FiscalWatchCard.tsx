// Propositions de la veille fiscale : chaque changement trouvé (par la veille hebdomadaire du
// serveur ou par Gemini), sa source, et deux boutons (appliquer / ignorer). Rien ne change
// sans un clic. Pour la veille du serveur, le détail du relevé permet de contrôler chaque
// valeur (comparée aux paramètres de l'app, avec la phrase de la page d'où elle vient).
import React from 'react';
import { Radar, ExternalLink, Check, X, Loader2, RotateCw } from 'lucide-react';
import { FiscalProposal } from '../lib/fiscalWatch';
import type { ServerWatchReport, WatchSource } from '../hooks/useFiscalWatch';

interface Props {
  proposals: FiscalProposal[];
  running: boolean;
  checkedAt?: string;
  lastError?: string;
  hasKey: boolean;
  /** Une vérification peut être lancée (clé Gemini, ou serveur). Par défaut : `hasKey`. */
  canRun?: boolean;
  /** Origine du résultat affiché. */
  source?: WatchSource;
  runningVia?: WatchSource;
  /** Détail du relevé du serveur (contrôle de qualité). */
  serverReport?: ServerWatchReport;
  onApply: (p: FiscalProposal) => void;
  onDismiss: (p: FiscalProposal) => void;
  onRun: () => void;
  /** Version compacte (accueil) : n'affiche rien s'il n'y a rien à proposer. */
  compact?: boolean;
}

// Message compréhensible à partir de l'erreur technique (le détail reste affiché entre parenthèses).
const friendlyError = (e: string): string => {
  if (/API_KEY_INVALID|API key not valid|401|403/i.test(e)) return `clé Gemini refusée : vérifiez-la dans Paramètres (${e.slice(0, 120)})`;
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(e)) return `quota Gemini dépassé, réessayez plus tard (${e.slice(0, 120)})`;
  if (/google_search|tool|grounding|Search/i.test(e) && /400/.test(e)) return `la recherche Google n'est pas disponible avec ce modèle ou cette clé (${e.slice(0, 160)})`;
  if (/illisible/i.test(e)) return 'Gemini a répondu, mais pas dans le format attendu. Réessayez.';
  if (/BACKEND_503/.test(e)) return "l'IA du serveur est indisponible pour le moment.";
  if (/BACKEND_502/.test(e)) return "le serveur n'a relevé aucune valeur cette fois (pages ou IA indisponibles).";
  if (/SESSION_EXPIRED/.test(e)) return 'session du serveur expirée : reconnectez-vous.';
  if (/Failed to fetch|NetworkError|TypeError|BACKEND_TIMEOUT/i.test(e)) return 'connexion impossible (réseau ou bloqueur).';
  return e.slice(0, 200);
};

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

const SOURCE_LABEL: Record<WatchSource, string> = {
  server: 'IA Cloudflare (veille hebdomadaire du serveur)',
  gemini: 'Gemini (votre clé)',
};

export const FiscalWatchCard: React.FC<Props> = ({ proposals, running, checkedAt, lastError, hasKey, canRun = hasKey, source, runningVia, serverReport, onApply, onDismiss, onRun, compact }) => {
  if (compact && proposals.length === 0) return null;
  const differing = serverReport ? serverReport.rows.filter(r => !r.sameAsApp).length : 0;
  return (
    <section aria-labelledby="fiscal-watch-title" className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-indigo-200 dark:border-indigo-900 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="fiscal-watch-title" className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Radar className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Veille fiscale</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
            {proposals.length > 0
              ? `${proposals.length} valeur${proposals.length > 1 ? 's' : ''} officielle${proposals.length > 1 ? 's ont' : ' a'} peut-être changé. Vérifiez la source avant d'appliquer.`
              : source === 'server' ? "Chaque lundi, le serveur relit les pages officielles (service-public.gouv.fr) et l'IA de Cloudflare en relève les taux des livrets, plafonds, prélèvements sociaux, décote et barème."
              : !canRun ? 'Ajoutez une clé Gemini ci-dessous : Pécule vérifiera chaque semaine les taux, plafonds et barèmes officiels.'
              : 'Chaque semaine, Gemini vérifie sur les sites officiels les taux des livrets, plafonds, prélèvements sociaux, décote et barème.'}
          </p>
          {!compact && checkedAt && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Dernière vérification réussie : {new Date(checkedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>}
          {!compact && source && <p className="text-[11px] text-slate-500 dark:text-slate-400">Source : {SOURCE_LABEL[source]}</p>}
          {!compact && canRun && !running && !checkedAt && !lastError && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Pas encore de vérification : cliquez sur « Vérifier maintenant ».</p>}
          {!compact && lastError && !running && (
            <p role="alert" className="text-xs font-bold text-rose-700 dark:text-rose-300 mt-2 wrap-break-word">
              Dernier essai en échec : {friendlyError(lastError)}
            </p>
          )}
          {!compact && running && <p role="status" className="text-xs text-slate-600 dark:text-slate-300 mt-2">{runningVia === 'server' ? 'Le serveur relit les pages officielles…' : 'Gemini cherche sur les sites officiels…'} (jusqu'à une minute)</p>}
        </div>
        {!compact && canRun && (
          <button onClick={onRun} disabled={running} className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-60">
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />} {running ? 'Vérification…' : 'Vérifier maintenant'}
          </button>
        )}
      </div>

      {proposals.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-700">
          {proposals.map(p => (
            <li key={p.key} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.label}</p>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="line-through decoration-rose-500/60">{p.current}</span> → <strong className="text-slate-800 dark:text-slate-100">{p.proposed}</strong>
                </p>
                {p.source && (
                  <a href={p.source} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1 hover:underline">
                    Source : {hostOf(p.source)} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => onApply(p)} className="flex items-center gap-1 text-xs font-black px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"><Check className="w-3.5 h-3.5" aria-hidden="true" /> Appliquer</button>
                <button onClick={() => onDismiss(p)} className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"><X className="w-3.5 h-3.5" aria-hidden="true" /> Ignorer</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!compact && serverReport && serverReport.rows.length > 0 && (
        <details className="mt-4 text-xs text-slate-600 dark:text-slate-300">
          <summary className="cursor-pointer font-bold text-slate-700 dark:text-slate-200">
            Détail du relevé : {serverReport.rows.length} valeur{serverReport.rows.length > 1 ? 's' : ''}, {differing === 0 ? "toutes identiques à l'app" : `${differing} différente${differing > 1 ? 's' : ''} de l'app`}
          </summary>
          <ul className="mt-2 space-y-2">
            {serverReport.rows.map(r => (
              <li key={r.key}>
                <span className="font-bold text-slate-800 dark:text-slate-100">{r.label}</span> : {r.value}{' '}
                <span className={r.sameAsApp ? 'text-emerald-700 dark:text-emerald-300' : 'font-bold text-amber-700 dark:text-amber-300'}>{r.sameAsApp ? "(= app)" : "(≠ app)"}</span>
                {r.quote && <span className="block text-[11px] italic text-slate-500 dark:text-slate-400 wrap-break-word">« {r.quote} »{r.source && <> — {hostOf(r.source)}</>}</span>}
              </li>
            ))}
          </ul>
          {serverReport.issues.length > 0 && (
            <ul className="mt-3 list-disc pl-4 text-[11px] text-amber-700 dark:text-amber-300">
              {serverReport.issues.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Modèle : {serverReport.model}{serverReport.neurons !== undefined && <> · environ {Math.round(serverReport.neurons).toLocaleString('fr-FR')} neurones (offre gratuite : 10 000 par jour)</>}
          </p>
        </details>
      )}
    </section>
  );
};
