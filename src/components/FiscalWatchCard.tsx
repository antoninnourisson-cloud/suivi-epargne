// Propositions de la veille fiscale : chaque changement trouvé (par la veille hebdomadaire du
// serveur ou par Gemini), sa source, et deux boutons (appliquer / ignorer). Rien ne change
// sans un clic. Pour la veille du serveur, le détail du relevé permet de contrôler chaque
// valeur (comparée aux paramètres de l'app, avec la phrase de la page d'où elle vient).
import React from 'react';
import { Radar, ExternalLink, Check, X, Loader2, RotateCw } from 'lucide-react';
import { FiscalProposal } from '../lib/fiscalWatch';
import type { ServerWatchReport, WatchSource } from '../hooks/useFiscalWatch';
import { Button } from './ui';
import { useCardSummary, useInSettingsCard } from './settings/SettingsCard';

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
  // Dans une carte de Paramètres : ni bordure ni titre (la carte les porte), et un résumé.
  const embedded = useInSettingsCard();
  useCardSummary('watch', proposals.length > 0
    ? `${proposals.length} proposition${proposals.length > 1 ? 's' : ''} à vérifier`
    : running ? 'Vérification en cours…'
    : checkedAt ? `Vérifiée le ${new Date(checkedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}${source === 'server' ? ' par le serveur' : ''}`
    : !canRun ? 'Clé Gemini nécessaire'
    : 'Pas encore vérifiée');
  if (compact && proposals.length === 0) return null;
  const differing = serverReport ? serverReport.rows.filter(r => !r.sameAsApp).length : 0;
  const Shell = embedded ? 'div' : 'section';
  return (
    <Shell aria-labelledby={embedded ? undefined : 'fiscal-watch-title'}
      className={embedded ? '' : 'rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-surface-container-low text-on-surface p-5 sm:p-6'}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          {!embedded && <h3 id="fiscal-watch-title" className="text-base font-medium text-on-surface flex items-center gap-2"><Radar className="w-5 h-5 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /> Veille fiscale</h3>}
          <p className={`text-sm text-on-surface-variant ${embedded ? '' : 'mt-1'}`}>
            {proposals.length > 0
              ? `${proposals.length} valeur${proposals.length > 1 ? 's' : ''} officielle${proposals.length > 1 ? 's ont' : ' a'} peut-être changé. Vérifiez la source avant d'appliquer.`
              : source === 'server' ? "Chaque lundi, le serveur relit les pages officielles (service-public.gouv.fr) et l'IA de Cloudflare en relève les taux des livrets, plafonds, prélèvements sociaux, décote et barème."
              : !canRun ? 'Ajoutez une clé Gemini (carte « Clés et services ») : Pécule vérifiera chaque semaine les taux, plafonds et barèmes officiels.'
              : 'Chaque semaine, Gemini vérifie sur les sites officiels les taux des livrets, plafonds, prélèvements sociaux, décote et barème.'}
          </p>
          {!compact && checkedAt && <p className="text-xs text-on-surface-variant mt-2">Dernière vérification réussie : {new Date(checkedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>}
          {!compact && source && <p className="text-xs text-on-surface-variant">Source : {SOURCE_LABEL[source]}</p>}
          {!compact && canRun && !running && !checkedAt && !lastError && <p className="text-xs text-on-surface-variant mt-2">Pas encore de vérification : cliquez sur « Vérifier maintenant ».</p>}
          {!compact && lastError && !running && (
            <p role="alert" className="text-xs font-medium text-error mt-2 wrap-break-word">
              Dernier essai en échec : {friendlyError(lastError)}
            </p>
          )}
          {!compact && running && <p role="status" className="text-xs text-on-surface-variant mt-2">{runningVia === 'server' ? 'Le serveur relit les pages officielles…' : 'Gemini cherche sur les sites officiels…'} (jusqu'à une minute)</p>}
        </div>
        {!compact && canRun && (
          <Button variant="tonal" onClick={onRun} disabled={running} className="shrink-0 self-start">
            {running ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RotateCw className="w-4 h-4" aria-hidden="true" />} {running ? 'Vérification…' : 'Vérifier maintenant'}
          </Button>
        )}
      </div>

      {proposals.length > 0 && (
        <ul className="mt-4 divide-y divide-outline-variant">
          {proposals.map(p => (
            <li key={p.key} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-on-surface">{p.label}</p>
                <p className="text-sm text-on-surface-variant">
                  <span className="line-through decoration-error/60">{p.current}</span> → <span className="font-medium text-on-surface">{p.proposed}</span>
                </p>
                {p.source && (
                  <a href={p.source} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1 hover:underline">
                    Source : {hostOf(p.source)} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => onApply(p)} className="px-4!"><Check className="w-4 h-4" aria-hidden="true" /> Appliquer</Button>
                <Button variant="text" onClick={() => onDismiss(p)} className="px-4!"><X className="w-4 h-4" aria-hidden="true" /> Ignorer</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!compact && serverReport && serverReport.rows.length > 0 && (
        <details className="mt-4 text-xs text-on-surface-variant">
          <summary className="cursor-pointer text-sm font-medium text-on-surface">
            Détail du relevé : {serverReport.rows.length} valeur{serverReport.rows.length > 1 ? 's' : ''}, {differing === 0 ? "toutes identiques à l'app" : `${differing} différente${differing > 1 ? 's' : ''} de l'app`}
          </summary>
          <ul className="mt-2 space-y-2">
            {serverReport.rows.map(r => (
              <li key={r.key}>
                <span className="font-medium text-on-surface">{r.label}</span> : {r.value}{' '}
                <span className={r.sameAsApp ? 'text-emerald-700 dark:text-emerald-300' : 'font-medium text-amber-700 dark:text-amber-300'}>{r.sameAsApp ? "(= app)" : "(≠ app)"}</span>
                {r.quote && <span className="block italic wrap-break-word">« {r.quote} »{r.source && <> — {hostOf(r.source)}</>}</span>}
              </li>
            ))}
          </ul>
          {serverReport.issues.length > 0 && (
            <ul className="mt-3 list-disc pl-4 text-amber-700 dark:text-amber-300">
              {serverReport.issues.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}
          <p className="mt-2">
            Modèle : {serverReport.model}{serverReport.neurons !== undefined && <> · environ {Math.round(serverReport.neurons).toLocaleString('fr-FR')} neurones (offre gratuite : 10 000 par jour)</>}
          </p>
        </details>
      )}
    </Shell>
  );
};
