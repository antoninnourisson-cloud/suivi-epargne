// Hypothèses de rendement d'une projection : un placement sans taux saisi pousse à sa
// performance observée (ramenée dans une fourchette prudente), ou compte 0 % tant que le
// rendement reste à renseigner. Même note au Rendement, dans « Et si… » et dans le plan solo :
// les trois projections utilisent les mêmes hypothèses (withAssumedRates de lib/performance).
import React from 'react';
import { OBSERVED_RATE_CAP, OBSERVED_RATE_FLOOR, OBSERVED_RATE_MIN_YEARS, type ProjectionAssumption } from '../lib/performance';
import { formatRate } from '../lib/format';
import { round2 } from '../lib/money';
import { parseISODate } from '../lib/dates';

const signedPct = (pctValue: number) => `${pctValue > 0 ? '+' : ''}${formatRate(round2(pctValue))}`;
const monthYear = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export const ProjectionAssumptionsNote: React.FC<{ assumptions: readonly ProjectionAssumption[]; className?: string }> = ({ assumptions, className = '' }) => {
  const missing = assumptions.filter(x => x.source === 'missing');
  const observed = assumptions.filter(x => x.source === 'observed');
  if (missing.length === 0 && observed.length === 0) return null;
  return (
    <div role="note" className={`rounded-2xl border border-outline-variant p-4 text-sm text-on-surface space-y-1 ${className}`}>
      <p className="font-medium">Hypothèses de rendement de la projection</p>
      {observed.map(x => (
        <p key={x.id} className="text-on-surface-variant">
          {x.observedRate !== undefined
            ? <>{x.name} : {signedPct(x.rate)} par an. Sa performance observée depuis {x.since ? monthYear(x.since) : 'son ajout'} ({signedPct(x.observedRate)} par an) est ramenée, par prudence, entre {signedPct(OBSERVED_RATE_FLOOR)} et {signedPct(OBSERVED_RATE_CAP)} par an : un bon ou un mauvais passage ne se répète pas forcément chaque année.</>
            : <>{x.name} : {signedPct(x.rate)} par an, la performance observée depuis {x.since ? monthYear(x.since) : 'son ajout'} (aucun rendement supposé saisi).</>}
        </p>
      ))}
      {missing.length > 0 && (
        <p className="text-on-surface-variant">
          {missing.map(x => x.name).join(', ')} : rendement à renseigner (fiche du compte, « Rendement annuel supposé ») ; compté 0 % en attendant.
          {missing.some(x => x.reason === 'volatile') && " La performance passée d'une crypto varie trop pour servir d'hypothèse."}
          {missing.some(x => x.reason === 'short') && ` Une performance observée ne sert d'hypothèse qu'après ${OBSERVED_RATE_MIN_YEARS} ans de suivi.`}
        </p>
      )}
    </div>
  );
};
