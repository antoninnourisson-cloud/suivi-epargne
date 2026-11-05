// Relevé annuel d'un placement (assurance vie, PEA, etc.), lu par Gemini dans la Clôture de
// l'année : valeur au 31 décembre, versements de l'année, taux servi, intérêts. Ce fichier ne
// garde que les contrôles croisés et les textes ; la lecture est dans services/geminiService.
// Rien n'est enregistré ici : la feuille préremplit des champs, l'utilisateur relit et valide.
import { formatEUR, formatRate } from './format';

export interface AnnualStatementData {
  year?: number;       // année du relevé (31 décembre de cette année)
  valueAtYearEnd?: number;
  deposits?: number;   // versements de l'année
  rate?: number;       // taux servi, en pourcentage (2,6 pour 2,6 %)
  interest?: number;   // intérêts ou gains crédités sur l'année
}

/** Taux servi plausible : de 0 à 10 % (choix de prudence : au-delà, c'est une erreur de lecture). */
export const ANNUAL_RATE_MAX = 10;

export const rateIsPlausible = (rate: number): boolean => rate >= 0 && rate <= ANNUAL_RATE_MAX;

/** Ce que la feuille peut préremplir : une valeur non plausible n'est jamais proposée. */
export interface AnnualStatementFill {
  valueAtYearEnd?: number;
  deposits?: number;
  rate?: number;
  interest?: number;
}

/**
 * Contrôles croisés simples. Renvoie ce qui peut être prérempli et les avertissements (en
 * français) à montrer à l'utilisateur : un relevé incohérent est signalé, jamais corrigé.
 */
export const checkAnnualStatement = (d: AnnualStatementData, closingYear: number): { fill: AnnualStatementFill; warnings: string[] } => {
  const warnings: string[] = [];
  const fill: AnnualStatementFill = {};
  if (d.year !== undefined && d.year !== closingYear) {
    warnings.push(`Ce relevé semble être celui de ${d.year}, pas de ${closingYear}.`);
  }
  if (d.valueAtYearEnd !== undefined) {
    if (d.valueAtYearEnd > 0) fill.valueAtYearEnd = d.valueAtYearEnd;
    else warnings.push('La valeur lue n\'est pas positive : saisissez-la à la main.');
  }
  if (d.deposits !== undefined) {
    fill.deposits = d.deposits;
    if (d.valueAtYearEnd !== undefined && d.deposits > d.valueAtYearEnd) {
      warnings.push(`Les versements lus (${formatEUR(d.deposits, 2)}) dépassent la valeur au 31 décembre (${formatEUR(d.valueAtYearEnd, 2)}) : vérifiez sur le relevé.`);
    }
  }
  if (d.rate !== undefined) {
    if (rateIsPlausible(d.rate)) fill.rate = d.rate;
    else warnings.push(`Le taux lu (${formatRate(d.rate)}) n'est pas plausible (entre 0 et ${ANNUAL_RATE_MAX} %) : saisissez-le à la main.`);
  }
  if (d.interest !== undefined) {
    fill.interest = d.interest;
    if (d.valueAtYearEnd !== undefined && d.interest > d.valueAtYearEnd) {
      warnings.push(`Les intérêts lus (${formatEUR(d.interest, 2)}) dépassent la valeur au 31 décembre : vérifiez sur le relevé.`);
    }
  }
  if (Object.keys(fill).length === 0 && warnings.length === 0) warnings.push('Gemini n\'a rien trouvé d\'exploitable sur ce relevé : saisissez les valeurs à la main.');
  return { fill, warnings };
};
