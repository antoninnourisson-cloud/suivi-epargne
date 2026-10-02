// Dons aux associations : réduction d'impôt.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { Donation } from '../../types';

// ---------------------------------------------------------------------------
// Dons aux associations (réduction d'impôt)
// ---------------------------------------------------------------------------

// Plafond des dons ouvrant droit au taux de 75 % (aide aux personnes en difficulté) ; au-delà,
// ils basculent à 66 %. Montant fixé par la loi de finances : à revoir chaque année.
export const DONATION_75_CEILING = 2000;

export interface DonationSummary {
  year: number;
  count: number;
  total: number;
  total66: number;        // à déclarer au taux de 66 % (y compris l'excédent des dons à 75 %)
  total75: number;        // à déclarer au taux de 75 % (plafonné)
  reduction: number;      // réduction d'impôt réellement utilisable (plafonnée à l'impôt dû si connu)
  reductionUncapped: number; // réduction théorique, avant plafonnement
  cappedByTax: boolean;   // la réduction dépasse l'impôt dû : l'excédent est perdu (non remboursable)
  missingReceipts: Donation[];
}

/**
 * Récapitulatif d'une année de dons. Si l'impôt dû (après décote) et le revenu imposable
 * sont connus, la réduction est plafonnée : 20 % du revenu imposable pour l'assiette (le
 * reste se reporte sur 5 ans), et jamais plus que l'impôt dû (réduction non remboursable).
 */
export const computeDonationSummary = (
  donations: Donation[], year: number,
  opts: { taxDue?: number; taxableIncome?: number; ceiling75?: number } = {}
): DonationSummary => {
  const ofYear = donations.filter(d => d.date.startsWith(`${year}-`) && d.amount > 0);
  const raw75 = ofYear.filter(d => d.rate === 75).reduce((sum, d) => sum + d.amount, 0);
  const raw66 = ofYear.filter(d => d.rate !== 75).reduce((sum, d) => sum + d.amount, 0);
  const total75 = Math.min(raw75, opts.ceiling75 ?? DONATION_75_CEILING);
  let total66 = raw66 + (raw75 - total75);
  if (opts.taxableIncome !== undefined && opts.taxableIncome > 0) total66 = Math.min(total66, opts.taxableIncome * 0.20);
  const reductionUncapped = total75 * 0.75 + total66 * 0.66;
  const cappedByTax = opts.taxDue !== undefined && reductionUncapped > opts.taxDue;
  return {
    year,
    count: ofYear.length,
    total: raw66 + raw75,
    total66,
    total75,
    reduction: cappedByTax ? Math.max(0, opts.taxDue!) : reductionUncapped,
    reductionUncapped,
    cappedByTax,
    missingReceipts: ofYear.filter(d => !d.receiptReceived),
  };
};
