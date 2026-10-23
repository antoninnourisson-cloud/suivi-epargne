// Dons aux associations : réduction d'impôt.
// Partie de src/lib/finance.ts (qui réexporte tout) : importez depuis '../finance'.
import { Donation } from '../../types';

// ---------------------------------------------------------------------------
// Dons aux associations (réduction d'impôt)
// ---------------------------------------------------------------------------

// Plafond des dons ouvrant droit au taux de 75 % (aide aux personnes en difficulté) ; au-delà,
// ils basculent à 66 %. Montant fixé par la loi de finances : à revoir chaque année.
// Vérifié le 2026-10-21 : 2 000 € pour les dons faits depuis le 14 octobre 2025 (loi
// n° 2026-103 du 19 février 2026 de finances pour 2026, art. 28), la limite s'appliquant au
// total des dons de l'année : https://www.service-public.gouv.fr/particuliers/vosdroits/F426
// et BOFiP BOI-IR-RICI-250-30-20260706,
// https://bofip.impots.gouv.fr/bofip/5873-PGP.html/identifiant=BOI-IR-RICI-250-30-20260706
export const DONATION_75_CEILING = 2000;

/** Premier jour du plafond relevé : les dons d'avant restent plafonnés à 1 000 €. */
export const DONATION_75_RAISE_DATE = '2025-10-14';
/**
 * Plafond des dons à 75 % faits avant le 14 octobre 2025. Pour 2025, les deux plafonds
 * s'appliquent ensemble : 1 000 € au plus pour les dons du 1er janvier au 13 octobre (case 7UD), 2 000 €
 * au total sur l'année, ceux d'avant le 14 octobre compris (case 7UQ pour les dons du
 * 14 octobre au 31 décembre). Vérifié le 2026-10-21 : simulateur officiel de l'impôt 2026,
 * https://simulateur-ir-ifi.impots.gouv.fr/calcul_impot/2026/aides/reductions.htm, et
 * service-public (F426, lien plus haut). Revérifié le 2026-10-23 sur le BOFiP
 * BOI-IR-RICI-250-30-20260706 (lien plus haut), § 30 : pour 2025, « double plafond », 2 000 €
 * apprécié sur l'année et sous-plafond de 1 000 € pour les dons jusqu'au 13 octobre 2025 ;
 * les deux ne s'additionnent pas (au plus 2 000 € à 75 % en 2025).
 */
export const DONATION_75_CEILING_BEFORE_RAISE = 1000;

/** Une case de la déclaration pour les dons à 75 % (2025 : deux cases selon la date du don). */
export interface Donation75Box {
  box: string;
  amount: number;
  /** Période couverte, en mots (« du 1er janvier au 13 octobre 2025 »), si la case en dépend. */
  period?: string;
}

export interface DonationSummary {
  year: number;
  count: number;
  total: number;
  total66: number;        // à déclarer au taux de 66 % (y compris l'excédent des dons à 75 %)
  total75: number;        // à déclarer au taux de 75 % (plafonné)
  /** Détail des dons à 75 % par case : une seule (7UD) sauf en 2025 (7UD puis 7UQ). */
  boxes75: Donation75Box[];
  /** Plafond des dons à 75 % retenu pour l'année (2025 : 1 000 € avant le 14 octobre, 2 000 € au total). */
  ceiling75: number;
  reduction: number;      // réduction d'impôt réellement utilisable (plafonnée à l'impôt dû si connu)
  reductionUncapped: number; // réduction théorique, avant plafonnement
  cappedByTax: boolean;   // la réduction dépasse l'impôt dû : l'excédent est perdu (non remboursable)
  missingReceipts: Donation[];
}

/**
 * Dons à 75 % plafonnés selon leur date. Avant le 14 octobre 2025 : 1 000 € (plafond en
 * vigueur depuis 2020 ; les années plus anciennes, plus basses, ne sont pas reprises). Année 2025 :
 * 1 000 € pour les dons jusqu'au 13 octobre, 2 000 € au total. Depuis : `ceiling` (2 000 €
 * par défaut, réglage de la veille fiscale) sur le total de l'année.
 */
const cap75 = (ofYear75: Donation[], year: number, ceiling: number): { total75: number; boxes75: Donation75Box[]; ceiling75: number } => {
  const raiseYear = Number(DONATION_75_RAISE_DATE.slice(0, 4));
  const sum = (ds: Donation[]) => ds.reduce((s, d) => s + d.amount, 0);
  if (year < raiseYear) {
    const total75 = Math.min(sum(ofYear75), DONATION_75_CEILING_BEFORE_RAISE);
    return { total75, boxes75: total75 > 0 ? [{ box: '7UD', amount: total75 }] : [], ceiling75: DONATION_75_CEILING_BEFORE_RAISE };
  }
  if (year === raiseYear) {
    const early = Math.min(sum(ofYear75.filter(d => d.date < DONATION_75_RAISE_DATE)), DONATION_75_CEILING_BEFORE_RAISE);
    const late = sum(ofYear75.filter(d => d.date >= DONATION_75_RAISE_DATE));
    const yearCeiling = DONATION_75_CEILING;
    const total75 = Math.min(early + late, yearCeiling);
    const boxes75: Donation75Box[] = [];
    if (early > 0) boxes75.push({ box: '7UD', amount: early, period: `du 1er janvier au 13 octobre ${year}` });
    if (total75 - early > 0) boxes75.push({ box: '7UQ', amount: total75 - early, period: `du 14 octobre au 31 décembre ${year}` });
    return { total75, boxes75, ceiling75: yearCeiling };
  }
  const total75 = Math.min(sum(ofYear75), ceiling);
  return { total75, boxes75: total75 > 0 ? [{ box: '7UD', amount: total75 }] : [], ceiling75: ceiling };
};

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
  const ofYear75 = ofYear.filter(d => d.rate === 75);
  const raw75 = ofYear75.reduce((sum, d) => sum + d.amount, 0);
  const raw66 = ofYear.filter(d => d.rate !== 75).reduce((sum, d) => sum + d.amount, 0);
  const { total75, boxes75, ceiling75 } = cap75(ofYear75, year, opts.ceiling75 ?? DONATION_75_CEILING);
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
    boxes75,
    ceiling75,
    reduction: cappedByTax ? Math.max(0, opts.taxDue!) : reductionUncapped,
    reductionUncapped,
    cappedByTax,
    missingReceipts: ofYear.filter(d => !d.receiptReceived),
  };
};
