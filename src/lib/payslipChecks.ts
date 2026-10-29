// ================================================
// FILE: src/lib/payslipChecks.ts
// Fiches de paie : contrôles de vraisemblance des montants lus par Gemini (avertissements,
// jamais bloquants : la relecture reste à l'utilisateur), et choix des fiches à additionner
// quand un même mois en a plusieurs (fiche rectificative, deuxième employeur).
// ================================================
import type { PayslipExtractedData, PayslipRecord } from '../types';
import { formatEUR } from './format';

type Amount = Exclude<keyof PayslipExtractedData, 'employer' | 'period'>;

export interface PayslipWarning {
  id: 'net-after-tax' | 'net-taxable-above-gross' | 'net-above-gross' | 'gross-minus-charges';
  /** Champs à relire en priorité. */
  fields: Amount[];
  message: string;
}

/**
 * Écart toléré entre « net avant impôt − impôt prélevé » et « net payé ». Sur une fiche
 * française, c'est une égalité au centime : le prélèvement est calculé et retiré tel quel.
 * 1 € absorbe un arrondi de lecture (montant lu à l'euro près) sans laisser passer les
 * confusions courantes de la lecture automatique (net imposable pris pour le net à payer,
 * impôt oublié), qui font des dizaines ou des centaines d'euros.
 */
export const NET_AFTER_TAX_TOLERANCE = 1;
/**
 * « Brut − charges salariales » ne retombe qu'à peu près sur le net à payer : tickets
 * restaurant (part salariale), Navigo, avantages en nature et retenues diverses s'y
 * ajoutent ou s'en retirent. Au-delà de 10 % du brut, ce n'est plus un écart ordinaire :
 * le plus souvent, les charges patronales ont été lues à la place des charges salariales.
 */
export const GROSS_MINUS_CHARGES_SHARE = 0.1;

// Espaces insécables du format monétaire : « 100,00 € » ne se coupe pas en fin de ligne.
const eur = (n: number) => formatEUR(n, 2);
const has = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/** Incohérences entre les montants d'une fiche (vide : rien à signaler, ou trop peu de montants). */
export const payslipConsistency = (f: PayslipExtractedData): PayslipWarning[] => {
  const out: PayslipWarning[] = [];
  const { grossAmount: gross, socialCharges: charges, netAmount: net, netTaxable, incomeTaxWithheld: tax, netPaid } = f;

  if (has(net) && has(tax) && has(netPaid)) {
    const gap = net - tax - netPaid;
    if (Math.abs(gap) > NET_AFTER_TAX_TOLERANCE) {
      out.push({ id: 'net-after-tax', fields: ['netAmount', 'incomeTaxWithheld', 'netPaid'],
        message: `Net avant impôt (${eur(net)}) moins impôt prélevé (${eur(tax)}) donne ${eur(net - tax)}, pas le net payé (${eur(netPaid)}) : écart de ${eur(Math.abs(gap))}. Vérifiez ces trois montants (un acompte ou une retenue sur salaire peut aussi l'expliquer).` });
    }
  }
  if (has(gross) && gross > 0) {
    if (has(netTaxable) && netTaxable > gross) {
      out.push({ id: 'net-taxable-above-gross', fields: ['netTaxable', 'grossAmount'],
        message: `Le net imposable (${eur(netTaxable)}) dépasse le brut (${eur(gross)}) : l'un des deux a sans doute été mal lu.` });
    }
    // Navigo remboursé : non soumis à cotisations, il s'ajoute après le brut.
    const ceiling = gross + (f.navigoRefund ?? 0) + NET_AFTER_TAX_TOLERANCE;
    const above = ([['netAmount', net], ['netPaid', netPaid]] as const).filter(([, v]) => has(v) && v > ceiling);
    if (above.length > 0) {
      out.push({ id: 'net-above-gross', fields: [...above.map(([k]) => k), 'grossAmount'],
        message: `Le net ${above.length > 1 ? 'avant impôt et le net payé dépassent' : above[0][0] === 'netAmount' ? 'avant impôt dépasse' : 'payé dépasse'} le brut (${eur(gross)}) : vérifiez ces montants.` });
    }
    if (has(charges) && has(net)) {
      const expected = gross - charges + (f.navigoRefund ?? 0);
      if (Math.abs(expected - net) > gross * GROSS_MINUS_CHARGES_SHARE) {
        out.push({ id: 'gross-minus-charges', fields: ['grossAmount', 'socialCharges', 'netAmount'],
          message: `Brut moins charges salariales donne ${eur(expected)}, loin du net avant impôt (${eur(net)}) : les charges lues sont peut-être les charges patronales.` });
      }
    }
  }
  return out;
};

/**
 * Fiches à additionner (déclaration de revenus, revenu fiscal estimé pour le LEP) : pour
 * chaque mois, la fiche la plus récemment enregistrée remplace les autres (fiche
 * rectificative, même fiche importée deux fois), sauf celles enregistrées comme
 * « s'ajoute » (deuxième employeur, rappel de salaire), toujours comptées.
 */
export const countedPayslips = <T extends Pick<PayslipRecord, 'addedAt' | 'addsToPeriod' | 'extracted'>>(slips: T[]): T[] => {
  const latest = new Map<string, T>();
  const kept: T[] = [];
  for (const p of slips) {
    const period = p.extracted?.period;
    if (!period || p.addsToPeriod) { kept.push(p); continue; }
    const prev = latest.get(period);
    if (!prev || (p.addedAt || '') > (prev.addedAt || '')) latest.set(period, p);
  }
  return [...kept, ...latest.values()];
};
