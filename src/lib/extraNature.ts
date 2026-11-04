// ================================================
// FILE: src/lib/extraNature.ts
// Nature de l'argent reçu en plus de la paie (« Autre argent reçu ») : Remboursement, Vente,
// Cadeau, Autre. Un remboursement reste sur le compte courant (argent plaisir) ; le reste est
// placé (lib/payDistribution, allocatePay). Un ancien versement sans nature se lit « Autre ».
// ================================================
import type { ExtraNature, PayRecord } from '../types';

export const EXTRA_NATURES: readonly ExtraNature[] = ['refund', 'sale', 'gift', 'other'];

export const isExtraNature = (v: unknown): v is ExtraNature => typeof v === 'string' && (EXTRA_NATURES as readonly string[]).includes(v);

/** Nature d'un versement en plus (absente : « Autre »). */
export const extraNatureOf = (p: Pick<PayRecord, 'nature'>): ExtraNature => p.nature ?? 'other';

/** Le choix dans le rituel. */
export const EXTRA_NATURE_LABEL: Record<ExtraNature, string> = {
  refund: 'Remboursement', sale: 'Vente', gift: 'Cadeau', other: 'Autre',
};

/** Exemple en euros, sous chaque choix. */
export const EXTRA_NATURE_EXAMPLE: Record<ExtraNature, string> = {
  refund: 'Un ami vous rend 40 € avancés',
  sale: 'Un objet vendu 120 €',
  gift: '150 € pour votre anniversaire',
  other: 'Prime à part, deuxième employeur',
};

/** Titre du rituel, libellé du versement (Journal) et de l'historique (« Voir le détail »). */
export const EXTRA_NATURE_TITLE: Record<ExtraNature, string> = {
  refund: 'Remboursement reçu', sale: 'Vente', gift: 'Cadeau reçu', other: 'Autre argent reçu',
};
