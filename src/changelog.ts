// ================================================
// FILE: src/changelog.ts
// Historique des mises à jour, du plus récent au plus ancien. À CHAQUE mise à jour visible
// pour l'utilisateur, ajouter une entrée en tête : l'app affiche alors une fois « Quoi de
// neuf » (voir WhatsNew.tsx), et l'historique complet reste consultable dans Paramètres.
// `version` : AAAA.MM.JJ (suffixe -2, -3… pour plusieurs mises à jour le même jour).
// ================================================

export interface ChangelogEntry {
  version: string;
  date: string;   // 'YYYY-MM-DD'
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2026.10.01-3',
    date: '2026-10-01',
    title: 'Suivi de l\'épargne plus juste',
    items: [
      'Journal : un mouvement peut être marqué « Pas de l\'épargne » (correction, intérêts, argent en transit). Il reste dans vos soldes mais sort de « Placé » et des bilans.',
      'Journal : « Repartir de zéro » à partir d\'une date pour le suivi de l\'épargne, sans rien effacer.',
      'Journal : les mouvements de test qui s\'annulent sont repérés et supprimables en un clic.',
      'Correction : le graphique du taux d\'épargne de l\'accueil s\'affiche de nouveau.',
      'Nouveautés : cette fenêtre, et l\'historique des mises à jour dans Paramètres.',
    ],
  },
  {
    version: '2026.10.01-2',
    date: '2026-10-01',
    title: 'Fiabilité et rapidité',
    items: [
      'Tous les changements de solde passent par un seul calcul vérifié : annulations exactes, part des parents toujours juste.',
      'Tableau de bord plus rapide : les graphiques se chargent après les cartes.',
      'Meilleur contraste des petits textes en mode clair.',
      'Nombreuses corrections : répartition personnalisée, projection, Actualiser, e-mails aux parents, annulation d\'un taux.',
    ],
  },
  {
    version: '2026.10.01-1',
    date: '2026-10-01',
    title: 'Journal et paie',
    items: [
      'Journal des modifications : mouvements, part des parents, taux, restitution.',
      '« Placé depuis la paie » : la jauge suit votre paie, du 27 au 26.',
      'Taux des livrets mis à jour avec leur date d\'effet (ex. 1,7 % au 1er août).',
      'Répartition personnalisée de l\'épargne (ex. 50 % Livret A, 50 % Assurance Vie), à partir d\'une date.',
      'Pastille sur l\'icône, hausse de salaire repérée, rendement net et projection selon la répartition.',
    ],
  },
  {
    version: '2026.09.30',
    date: '2026-09-30',
    title: 'Agenda, bilan et restitution',
    items: [
      'Agenda des douze prochains mois et bilan annuel (notification chaque début janvier).',
      'Restitution du capital de vos parents : date conseillée, rappels, enregistrement en un clic, puis mode solo.',
      'Liste des virements de paie à cocher, relance trois jours après la paie.',
      'Barème de l\'impôt 2026, vérification des paramètres fiscaux en janvier.',
    ],
  },
  {
    version: '2026.09.15',
    date: '2026-09-15',
    title: 'Abonnements, dons et fiscalité',
    items: [
      'Abonnements avec rappels avant prélèvement, comptés dans les charges fixes.',
      'Dons aux associations pour la déclaration de revenus, reçus joints depuis Drive.',
      'Versements cumulés et plus-values latentes des placements.',
      'Notifications : jour de paie, bilan du mois, liens directs vers le bon écran.',
    ],
  },
];

export const LATEST_VERSION = CHANGELOG[0].version;
