// Aide à la déclaration de revenus : case par case, ce qu'il faut vérifier ou reporter
// (calculs dans lib/taxReturn, aucun ici).
import React, { useMemo, useState } from 'react';
import { ClipboardCheck, ExternalLink, Info } from 'lucide-react';
import { GlobalAppData } from '../types';
import { buildTaxReturnChecklist, TAX_LINKS, TAX_RETURN_CALENDAR_TEXT, TAX_RETURN_SECTIONS, TaxReturnLine } from '../lib/taxReturn';
import { formatEUR } from '../lib/format';
import { Card } from './ui';

interface Props {
  data: Pick<GlobalAppData, 'payslips' | 'donations' | 'accounts'>;
  estimatedNetTaxableBeforeAllowance?: number;
  allowanceRate?: number;
  allowanceCap?: number;
  ceiling75?: number;
}

const BADGE: Record<TaxReturnLine['confidence'], { label: string; className: string }> = {
  exact: { label: 'à reporter', className: 'bg-primary-container text-on-primary-container' },
  estimate: { label: 'estimation', className: 'bg-secondary-container text-on-secondary-container' },
  todo: { label: 'à faire', className: 'bg-error-container text-on-error-container' },
  check: { label: 'à vérifier', className: 'bg-tertiary-container text-on-tertiary-container' },
  info: { label: 'à savoir', className: 'bg-surface-container-highest text-on-surface-variant' },
};

const OfficialLink: React.FC<{ link: { label: string; url: string } }> = ({ link }) => (
  <a href={link.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-2 hover:no-underline">
    {link.label}<ExternalLink className="w-3 h-3" aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span>
  </a>
);

export const TaxReturnHelper: React.FC<Props> = ({ data, estimatedNetTaxableBeforeAllowance, allowanceRate, allowanceCap, ceiling75 }) => {
  const thisYear = new Date().getFullYear();
  // Au printemps, on déclare l'année précédente.
  const [year, setYear] = useState(thisYear - 1);
  const lines = useMemo(
    () => buildTaxReturnChecklist(data, year, { estimatedNetTaxableBeforeAllowance: year === thisYear - 1 || year === thisYear ? estimatedNetTaxableBeforeAllowance : undefined, allowanceRate, allowanceCap, ceiling75 }),
    [data, year, estimatedNetTaxableBeforeAllowance, allowanceRate, allowanceCap, ceiling75, thisYear]
  );
  const sections = TAX_RETURN_SECTIONS.map(s => ({ ...s, lines: lines.filter(l => l.section === s.id) })).filter(s => s.lines.length > 0);

  return (
    <Card id="tax-return" title="Déclaration de revenus" icon={ClipboardCheck} action={
      <label className="text-xs font-medium text-on-surface-variant flex items-center gap-2">
        Revenus de
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="h-9 px-2 rounded-xs bg-transparent border border-outline text-sm font-medium text-on-surface hover:border-on-surface focus:border-primary outline-none">
          {[thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
    }>
      <p className="text-sm text-on-surface-variant -mt-2">
        Les cases à vérifier sur impots.gouv pour les revenus de {year} (déclaration au printemps {year + 1}). {TAX_RETURN_CALENDAR_TEXT}{' '}
        <a href={TAX_LINKS.deadlines.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2 hover:no-underline">Dates de votre département<span className="sr-only"> (nouvel onglet)</span></a>
      </p>
      {sections.length === 0 ? (
        <p className="text-sm text-on-surface-variant mt-4">Rien de particulier pour cette année : importez vos fiches de paie pour vérifier vos salaires.</p>
      ) : sections.map(s => (
        <section key={s.id} aria-labelledby={`tax-section-${s.id}`} className="mt-5">
          <h4 id={`tax-section-${s.id}`} className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">{s.title}</h4>
          <ul className="mt-1 divide-y divide-outline-variant">
            {s.lines.map(l => (
              <li key={l.id} className="py-3 flex gap-3" data-testid={`tax-line-${l.id}`}>
                <span className="w-24 shrink-0 font-mono text-xs font-bold text-primary pt-0.5">{l.box}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-on-surface">{l.label}</p>
                    <span className="flex items-center gap-2">
                      {l.amount !== undefined && <span className="font-medium text-on-surface tabular-nums">{formatEUR(l.amount, 0)}</span>}
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${BADGE[l.confidence].className}`}>{BADGE[l.confidence].label}</span>
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-0.5">{l.note}</p>
                  {l.link && <OfficialLink link={l.link} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="mt-3 text-[11px] text-on-surface-variant flex items-start gap-1"><Info className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" /> Les montants pré-remplis par l'administration font foi : cette liste aide à les contrôler, elle ne remplace pas votre déclaration.</p>
    </Card>
  );
};
