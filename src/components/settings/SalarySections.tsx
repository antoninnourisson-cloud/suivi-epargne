// Contenu des cartes « Avantages salariaux » et « Fiscalité et barème ». L'état (brouillon
// enregistré automatiquement) reste dans Settings : ces composants ne font que l'afficher
// et le modifier.
import React, { useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { FiscalConfig, PayslipRecord, TaxBracket, WorkBenefits } from '../../types';
import { benefitsFromPayslips } from '../../lib/planning';
import { formatEUR } from '../../lib/format';
import { identifyTaxScale, sameTaxBrackets, applyTaxScale } from '../../lib/finance';
import { LATEST_TAX_SCALE } from '../../constants';
import { parseISODate } from '../../lib/dates';
import { Button } from '../ui';
import { CardSubheading, Hint, Notice } from './SettingsCard';
import { NumberField, SwitchRow } from './fields';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

// Champs numériques de la configuration fiscale (ceux de la grille de saisie générique).
type NumericFiscalField = { [K in keyof FiscalConfig]-?: FiscalConfig[K] extends number | undefined ? K : never }[keyof FiscalConfig];

/** Résumé de la carte « Avantages salariaux ». */
export const benefitsSummary = (b: WorkBenefits) => {
  const on = [b.navigo.active && 'Navigo', b.mutuelle.active && 'mutuelle', b.mealVouchers.active && 'titres-restaurant'].filter(Boolean) as string[];
  if (on.length === 0) return 'Aucun avantage renseigné';
  const s = on.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Résumé de la carte « Fiscalité et barème ». */
export const fiscalSummary = (f: FiscalConfig) => {
  const parts = f.lepHouseholdParts ?? 1;
  const scale = identifyTaxScale(f.taxBrackets)?.label ?? 'Barème personnalisé';
  return `${scale} · ${parts.toLocaleString('fr-FR')} part${parts > 1 ? 's' : ''}`;
};

const Gain: React.FC<{ children: React.ReactNode; tone: 'gain' | 'cost' }> = ({ children, tone }) => (
  <p className={`text-sm font-medium tabular-nums sm:col-span-full ${tone === 'gain' ? 'text-emerald-700 dark:text-emerald-300' : 'text-on-surface-variant'}`}>{children}</p>
);

export const BenefitsFields: React.FC<{ payslips: PayslipRecord[]; benefits: WorkBenefits; setBenefits: SetState<WorkBenefits> }> = ({ payslips, benefits, setBenefits }) => {
  const [msg, setMsg] = useState<string | null>(null);
  const update = <C extends keyof WorkBenefits, F extends keyof WorkBenefits[C]>(category: C, field: F, value: WorkBenefits[C][F]) => {
    setBenefits(prev => ({ ...prev, [category]: { ...prev[category], [field]: value } }));
  };
  const { navigo, mutuelle, mealVouchers } = benefits;

  return (
    <div className="space-y-5">
      {payslips.length > 0 && (
        <div className="p-4 rounded-xl bg-surface-container flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1 text-sm text-on-surface-variant">
            Reprenez les montants réels de vos fiches de paie (moyenne des 3 dernières) : remboursement Navigo à 50 %, titres-restaurant payés à 50 % par l'employeur, part de mutuelle retenue sur la paie.
            {msg && <span className="block mt-1 font-medium text-on-surface" role="status">{msg}</span>}
          </p>
          <Button variant="tonal" className="shrink-0 self-start sm:self-center" onClick={() => {
            const r = benefitsFromPayslips(payslips, benefits);
            if (!r) return;
            setBenefits(r.benefits);
            const parts = [
              r.navigoRefund ? `Navigo ${formatEUR(r.navigoRefund, 2)} remboursés` : 'pas de remboursement transport',
              r.mealVouchersEmployee ? `titres-restaurant ${formatEUR(r.mealVouchersEmployee, 2)} retenus` : 'pas de titres-restaurant',
              r.mutuelleEmployee ? `mutuelle ${formatEUR(r.mutuelleEmployee, 2)} retenue` : 'pas de mutuelle retenue',
            ];
            setMsg(`D'après ${r.months} fiche${r.months > 1 ? 's' : ''} : ${parts.join(', ')} par mois.`);
          }}>Utiliser mes fiches de paie</Button>
        </div>
      )}

      <SwitchRow label="Transport (Navigo)" hint="Abonnement remboursé en partie par l'employeur." checked={navigo.active} onChange={v => update('navigo', 'active', v)}>
        {navigo.active && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumberField label="Prix de base mensuel" suffix="€" value={navigo.basePrice} onChange={v => update('navigo', 'basePrice', v)} />
            <NumberField label="Remboursement" suffix="%" value={navigo.refundRate} onChange={v => update('navigo', 'refundRate', v)} />
            <Gain tone="gain">+{formatEUR(navigo.basePrice * navigo.refundRate / 100, 2)} par mois remboursés</Gain>
          </div>
        )}
      </SwitchRow>

      <div className="pt-5 border-t border-outline-variant">
        <SwitchRow label="Mutuelle santé" hint="Part du contrat retenue sur votre paie." checked={mutuelle.active} onChange={v => update('mutuelle', 'active', v)}>
          {mutuelle.active && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <NumberField label="Coût total du contrat" suffix="€" value={mutuelle.totalCost} onChange={v => update('mutuelle', 'totalCost', v)} />
              <NumberField label="Prise en charge employeur" suffix="%" value={mutuelle.employerRate} onChange={v => update('mutuelle', 'employerRate', v)} />
              <Gain tone="cost">−{formatEUR(mutuelle.totalCost * (1 - mutuelle.employerRate / 100), 2)} par mois à votre charge</Gain>
            </div>
          )}
        </SwitchRow>
      </div>

      <div className="pt-5 border-t border-outline-variant">
        <SwitchRow label="Titres-restaurant" hint="Part salariale retenue sur votre paie." checked={mealVouchers.active} onChange={v => update('mealVouchers', 'active', v)}>
          {mealVouchers.active && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <NumberField label="Valeur d'un titre" suffix="€" value={mealVouchers.faceValue} onChange={v => update('mealVouchers', 'faceValue', v)} />
              <NumberField label="Jours par mois" value={mealVouchers.daysPerMonth} onChange={v => update('mealVouchers', 'daysPerMonth', v)} />
              <NumberField label="Prise en charge employeur" suffix="%" value={mealVouchers.employerRate} onChange={v => update('mealVouchers', 'employerRate', v)} />
              <Gain tone="cost">−{formatEUR(mealVouchers.faceValue * mealVouchers.daysPerMonth * (1 - mealVouchers.employerRate / 100), 2)} par mois à votre charge</Gain>
            </div>
          )}
        </SwitchRow>
      </div>
    </div>
  );
};

export const FiscalFields: React.FC<{ fiscal: FiscalConfig; setFiscal: SetState<FiscalConfig> }> = ({ fiscal, setFiscal }) => {
  const change = <K extends keyof FiscalConfig>(field: K, value: FiscalConfig[K]) => setFiscal(prev => ({ ...prev, [field]: value }));
  const changeCeiling = (key: keyof FiscalConfig['ceilings'], value: number) => setFiscal(prev => ({ ...prev, ceilings: { ...prev.ceilings, [key]: value } }));
  const updateBracket = (index: number, field: keyof TaxBracket, value: number) => {
    const next = [...fiscal.taxBrackets];
    next[index] = { ...next[index], [field]: value };
    change('taxBrackets', next);
  };
  const addBracket = () => change('taxBrackets', [...fiscal.taxBrackets, { limit: 0, rate: 0 }]);
  const removeBracket = (index: number) => change('taxBrackets', fiscal.taxBrackets.filter((_, i) => i !== index));

  const numeric: [NumericFiscalField, string, number, string?][] = [
    ['salaryChargesRate', 'Charges salariales', fiscal.salaryChargesRate, 'Taux, ex. 0,2232'],
    ['standardAllowance', 'Abattement forfaitaire', fiscal.standardAllowance, 'Taux, ex. 0,10'],
    ['standardAllowanceCap', 'Abattement : plafond', fiscal.standardAllowanceCap ?? 0, 'En euros'],
    ['standardAllowanceMin', 'Abattement : minimum', fiscal.standardAllowanceMin ?? 0, 'En euros'],
  ];
  const social: [NumericFiscalField, string, number, string?][] = [
    ['socialChargesCapital', 'Prélèvements sociaux', fiscal.socialChargesCapital, 'Revenus du capital, ex. 0,186'],
    ['socialChargesLifeInsurance', 'Prélèvements sociaux (assurance vie)', fiscal.socialChargesLifeInsurance ?? 0.172, 'Ex. 0,172'],
  ];
  const scaleLabel = identifyTaxScale(fiscal.taxBrackets)?.label ?? 'Barème personnalisé';
  const history = fiscal.taxBracketsHistory ?? [];

  return (
    <div className="space-y-6">
      <div>
        <CardSubheading>Salaire et impôt</CardSubheading>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {numeric.map(([field, label, value, help]) => (
            <NumberField key={field} label={label} supporting={help} value={value} onChange={v => change(field, v)} />
          ))}
          <NumberField label="Décote : montant" suffix="€" value={fiscal.decote?.single ?? 897}
            onChange={v => change('decote', { rate: 0.4525, threshold: 1982, ...fiscal.decote, single: v })} />
          <NumberField label="Décote : seuil d'impôt" suffix="€" value={fiscal.decote?.threshold ?? 1982}
            onChange={v => change('decote', { single: 897, rate: 0.4525, ...fiscal.decote, threshold: v })} />
          {social.map(([field, label, value, help]) => (
            <NumberField key={field} label={label} supporting={help} value={value} onChange={v => change(field, v)} />
          ))}
        </div>
      </div>

      <div className="pt-5 border-t border-outline-variant">
        <CardSubheading>Livrets réglementés</CardSubheading>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField label="Plafond du Livret A" suffix="€" value={fiscal.ceilings.livretA} onChange={v => changeCeiling('livretA', v)} />
          <NumberField label="Plafond du LEP" suffix="€" value={fiscal.ceilings.lep} onChange={v => changeCeiling('lep', v)} />
          <NumberField label="Plafond RFR LEP (1 part)" suffix="€" value={fiscal.lepIncomeCeiling ?? 0} onChange={v => change('lepIncomeCeiling', v)} />
          <NumberField label="Plafond LEP : ajout par demi-part" suffix="€" value={fiscal.lepCeilingPerHalfPart ?? 0} onChange={v => change('lepCeilingPerHalfPart', v)} />
          <NumberField label="Parts fiscales" value={fiscal.lepHouseholdParts ?? 1} onChange={v => change('lepHouseholdParts', v)} />
        </div>
        <Hint className="mt-2">
          Sert à vous alerter si votre revenu approche du plafond d'éligibilité au LEP. Le montant est révisé chaque année ; le vrai critère reste le RFR de votre avis d'imposition.
        </Hint>
      </div>

      <div className="pt-5 border-t border-outline-variant">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardSubheading>Barème de l'impôt sur le revenu</CardSubheading>
          <Button variant="text" onClick={addBracket} className="-mr-3"><Plus className="w-4 h-4" aria-hidden="true" /> Ajouter une tranche</Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-on-surface">{scaleLabel}</span>
          {!sameTaxBrackets(fiscal.taxBrackets, LATEST_TAX_SCALE.brackets) && (
            <Button variant="tonal" onClick={() => setFiscal(prev => applyTaxScale(prev, LATEST_TAX_SCALE))}>
              Appliquer le {LATEST_TAX_SCALE.label}
            </Button>
          )}
        </div>
        <Hint className="mt-1">Source : service-public.fr. Chaque modification est enregistrée automatiquement.</Hint>
        {history.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium text-on-surface">Barèmes précédents ({history.length})</summary>
            <ul className="mt-2 space-y-1">
              {[...history].reverse().map((h, i) => (
                <li key={i} className="text-xs text-on-surface-variant">
                  <span className="font-medium text-on-surface">{h.year ? `Barème ${h.year}` : 'Barème personnalisé'}</span>, remplacé le {parseISODate(h.replacedOn).toLocaleDateString('fr-FR')} :{' '}
                  {h.brackets.map(b => `${Math.round(b.rate * 100)} % jusqu'à ${b.limit === null || b.limit === Infinity || b.limit >= 999999999 ? '∞' : formatEUR(b.limit)}`).join(' · ')}
                </li>
              ))}
            </ul>
          </details>
        )}
        <ol className="mt-4 space-y-3">
          {fiscal.taxBrackets.map((bracket, index) => (
            <li key={index} className="flex items-start gap-3">
              <NumberField className="flex-1 min-w-0" label={`Tranche ${index + 1} : jusqu'à`} suffix="€"
                value={bracket.limit === Infinity ? 999999999 : bracket.limit} onChange={v => updateBracket(index, 'limit', v)} />
              <NumberField className="w-28 sm:w-36 shrink-0" label="Taux" value={bracket.rate} onChange={v => updateBracket(index, 'rate', v)} />
              <button type="button" onClick={() => removeBracket(index)} aria-label={`Supprimer la tranche ${index + 1}`}
                className="mt-7 w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error/8">
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
        <Notice tone="warning" icon={AlertTriangle} className="mt-4">
          Les tranches doivent être ordonnées ; le taux s'écrit 0,11 pour 11 %. Mettez 999999999 pour l'infini.
        </Notice>
      </div>
    </div>
  );
};
