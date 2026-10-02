// Propositions de la veille fiscale : chaque changement trouvé par Gemini, sa source, et
// deux boutons (appliquer / ignorer). Rien ne change sans un clic.
import React from 'react';
import { Radar, ExternalLink, Check, X, Loader2, RotateCw } from 'lucide-react';
import { FiscalProposal } from '../lib/fiscalWatch';

interface Props {
  proposals: FiscalProposal[];
  running: boolean;
  checkedAt?: string;
  lastError?: string;
  hasKey: boolean;
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
  if (/Failed to fetch|NetworkError|TypeError/i.test(e)) return 'connexion impossible (réseau ou bloqueur).';
  return e.slice(0, 200);
};

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export const FiscalWatchCard: React.FC<Props> = ({ proposals, running, checkedAt, lastError, hasKey, onApply, onDismiss, onRun, compact }) => {
  if (compact && proposals.length === 0) return null;
  return (
    <section aria-labelledby="fiscal-watch-title" className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-indigo-200 dark:border-indigo-900 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="fiscal-watch-title" className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Radar className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Veille fiscale</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
            {proposals.length > 0
              ? `${proposals.length} valeur${proposals.length > 1 ? 's' : ''} officielle${proposals.length > 1 ? 's ont' : ' a'} peut-être changé. Vérifiez la source avant d'appliquer.`
              : !hasKey ? 'Ajoutez une clé Gemini ci-dessous : Pécule vérifiera chaque semaine les taux, plafonds et barèmes officiels.'
              : 'Chaque semaine, Gemini vérifie sur les sites officiels les taux des livrets, plafonds, prélèvements sociaux, décote et barème.'}
          </p>
          {!compact && checkedAt && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Dernière vérification réussie : {new Date(checkedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>}
          {!compact && hasKey && !running && !checkedAt && !lastError && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Pas encore de vérification : cliquez sur « Vérifier maintenant ».</p>}
          {!compact && lastError && !running && (
            <p role="alert" className="text-xs font-bold text-rose-700 dark:text-rose-300 mt-2 break-words">
              Dernier essai en échec : {friendlyError(lastError)}
            </p>
          )}
          {!compact && running && <p role="status" className="text-xs text-slate-600 dark:text-slate-300 mt-2">Gemini cherche sur les sites officiels… (jusqu'à une minute)</p>}
        </div>
        {!compact && hasKey && (
          <button onClick={onRun} disabled={running} className="flex-shrink-0 flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-60">
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
    </section>
  );
};
