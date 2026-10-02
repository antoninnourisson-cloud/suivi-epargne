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
    version: '2026.10.02-9',
    date: '2026-10-02',
    title: 'Connexion Google sans avertissement',
    items: [
      "La connexion ne redemande plus d'anciennes autorisations : Google n'affiche plus « application non validée ».",
      "L'écran de connexion mène à la présentation de Pécule et aux règles de confidentialité.",
    ],
  },
  {
    version: '2026.10.02-8',
    date: '2026-10-02',
    title: "Plus d'e-mails, plus de garde-fous",
    items: [
      "Pécule n'envoie plus aucun e-mail : la connexion Google ne demande plus que l'accès à Drive. Reconnectez-vous une fois sur chaque appareil.",
      "Un virement entre vos comptes ne peut plus jamais entamer la part de vos parents, quel que soit l'écran d'où il part.",
      "Un fichier de données abîmé est réparé à l'ouverture (montants illisibles, mouvements incomplets) au lieu de fausser les calculs, y compris pour les notifications.",
    ],
  },
  {
    version: '2026.10.02-7',
    date: '2026-10-02',
    title: 'Plus lisible, au clavier comme à l\'écran',
    items: [
      "Gains, pertes et alertes en couleurs plus contrastées, plus faciles à lire.",
      "Chiffres alignés en colonnes, et pourcentages à la française (« 22,3 % »).",
      "Au clavier : lien « Aller au contenu », onglets au flèches, focus sur le titre à chaque changement d'écran, import de fichier accessible.",
      "Le message « Annuler » reste affiché 10 secondes, et ne disparaît pas tant que la souris ou le focus est dessus.",
      "Les animations se coupent si votre appareil demande de réduire les mouvements.",
    ],
  },
  {
    version: '2026.10.02-6',
    date: '2026-10-02',
    title: 'Pécule a sa propre adresse',
    items: [
      "Pécule déménage sur pecule-app.com. Vos données restent sur votre Google Drive : il suffit de vous reconnecter.",
      "Sur chaque appareil, réactivez ensuite les notifications, le verrou et la clé Gemini, et réinstallez l'app sur téléphone.",
      "La police de l'app est maintenant incluse : affichage plus net, même hors ligne.",
      "Confidentialité : la page détaille aussi ce qui est envoyé à Gemini pour l'avis d'imposition et la veille fiscale.",
    ],
  },
  {
    version: '2026.10.02-5',
    date: '2026-10-02',
    title: 'Chiffres réels et réglages fins',
    items: [
      "Avantages salariaux : bouton « Utiliser mes fiches de paie » (Navigo et titres-restaurant à 50 %, mutuelle retenue sur la paie).",
      "Notifications : choisissez type par type celles que vous recevez (Paramètres → Notifications).",
      "Assurance vie : indiquez la part en fonds euros, les prélèvements sociaux déjà payés ne sont plus comptés au retrait. Crypto : cession de 305 € au plus exonérée.",
      "Sécurité : nouveau code PIN de 6 chiffres minimum, copie locale de secours chiffrée, règles du navigateur durcies.",
    ],
  },
  {
    version: '2026.10.02-4',
    date: '2026-10-02',
    title: 'LEP : alerte avant fermeture',
    items: [
      "Pécule vous prévient si vos revenus dépassent le plafond du LEP, et annonce la date de fermeture probable (deux années de suite au-dessus du plafond).",
      "Paramètres : importez votre avis d'imposition (PDF ou photo), Gemini en relève le revenu fiscal de référence et le nombre de parts.",
      "Une notification est envoyée une fois à chaque changement de situation, et la fermeture apparaît dans l'Agenda.",
    ],
  },
  {
    version: '2026.10.02-3',
    date: '2026-10-02',
    title: 'Veille fiscale plus fiable',
    items: [
      "Veille fiscale : la réponse de Gemini est mieux comprise, et en cas d'échec la raison s'affiche (clé refusée, quota, recherche indisponible…).",
      "Paramètres : la date de la dernière vérification réussie est affichée, avec un message pendant la recherche.",
      "La veille fonctionne avec une clé Gemini gratuite : le serveur lit les pages officielles de service-public.gouv.fr et Gemini en relève les chiffres.",
      "Dons : le plafond à 75 % passe à 2 000 € (règle en vigueur depuis le 14 octobre 2025).",
    ],
  },
  {
    version: '2026.10.02-2',
    date: '2026-10-02',
    title: 'Accueil repensé et nouveaux outils',
    items: [
      "Accueil : un « À faire » plus clair (les 3 plus importants, une action, « Plus tard »), l'épargne de précaution, les prochaines échéances et des chiffres plus lisibles.",
      "Plan solo 2027-2030 (Part parentale) : votre épargne année par année après la restitution, avec les étapes clés.",
      "Dons et impôts : aide à la déclaration case par case (1AJ, 8HV, 7UD, 7UF…).",
      "Abonnements : revue annuelle (coût, hausses de prix, date limite de résiliation, « toujours utile ? »).",
      "Menus regroupés par thème, mode sombre corrigé partout, saisie au clavier et lecteurs d'écran mieux pris en charge.",
    ],
  },
  {
    version: '2026.10.02',
    date: '2026-10-02',
    title: 'Sécurité, impôts 2026 et veille fiscale',
    items: [
      "Impôt plus juste : décote, CSG non déductible, abattement de 10 % 2026, prélèvements sociaux à 18,6 % (17,2 % sur l'assurance vie), PEE toujours exonéré d'impôt, plafond LEP 2026, dons plafonnés à votre impôt.",
      "Veille fiscale : chaque semaine, Gemini vérifie sur les sites officiels les taux, plafonds et barèmes, et vous propose les changements avec leur source. Rien ne change sans votre accord.",
      "Sécurité : « Code oublié » vous déconnecte au lieu d'ouvrir l'app ; sessions limitées à 60 jours ; « Déconnecter tous les appareils » et « Supprimer mes données serveur » dans Paramètres ; notifications discrètes possibles.",
      "Votre clé Gemini reste désormais sur cet appareil (à ressaisir une fois sur vos autres appareils).",
      "Données : une copie mensuelle sur Drive (12 mois restaurables), plus aucune réécriture inutile à l'ouverture, et un fichier importé ne peut plus changer l'adresse de vos parents.",
    ],
  },
  {
    version: '2026.10.01-4',
    date: '2026-10-01',
    title: 'Suivi Épargne devient Pécule',
    items: [
      "Nouveau nom, nouveau logo (une pousse qui sort d'une pièce) et nouvelles couleurs : vert sapin, or et crème.",
      "Le numéro de version est affiché sur l'écran de connexion, en bas du menu et dans Paramètres.",
      "Vos données ne changent pas : même fichier Drive, même adresse.",
      "Sur iPhone, pour voir la nouvelle icône, supprimez l'app de l'écran d'accueil puis ajoutez-la de nouveau depuis Safari.",
    ],
  },
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
