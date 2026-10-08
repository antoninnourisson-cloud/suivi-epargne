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
    version: '2026.10.08-3',
    date: '2026-10-08',
    title: 'Finitions',
    items: [
      "Simulateur « Et si… » : le résultat est annoncé une seule fois quand vous arrêtez de taper, et une date effacée est signalée au lieu de revenir en arrière.",
      "Petites améliorations d'accessibilité : boutons de fermeture plus grands, jauge des bons mois lue en euros, titres mieux ordonnés.",
      "Ménage interne et mises à jour de sécurité des outils de développement : rien ne change dans votre utilisation.",
    ],
  },
  {
    version: '2026.10.08-2',
    date: '2026-10-08',
    title: 'Paramètres plus simples',
    items: [
      "Les Paramètres sont rangés en cartes dépliables par thème (salaire et impôts, préférences, sécurité et données, à propos), chacune avec un résumé d'une ligne.",
      "Les liens vers un réglage (par exemple « Importer mon avis ») ouvrent directement la bonne carte. Pécule se souvient des cartes que vous laissez ouvertes.",
      "Nouvelle carte « À propos » : version, historique des mises à jour, confidentialité, wiki, licence et contact.",
    ],
  },
  {
    version: '2026.10.08',
    date: '2026-10-08',
    title: 'Veille fiscale : correctif',
    items: [
      "La veille du serveur se lance bien à l'ouverture de l'app, même avec une clé Gemini : le « Détail du relevé » apparaît dans Paramètres, « Veille fiscale ».",
    ],
  },
  {
    version: '2026.10.07-8',
    date: '2026-10-07',
    title: 'Veille fiscale sans clé Gemini',
    items: [
      "La veille fiscale tourne désormais chaque semaine sur le serveur, avec l'IA de Cloudflare : plus besoin de clé Gemini pour qu'elle fonctionne. Gemini reste utilisé en secours si vous avez une clé.",
      "Paramètres, « Veille fiscale » : « Détail du relevé » montre chaque valeur lue, la phrase exacte de la page officielle, et si elle correspond à celle de l'app. Comme avant, rien n'est modifié sans votre accord.",
    ],
  },
  {
    version: '2026.10.07-7',
    date: '2026-10-07',
    title: 'Sauvegarde de secours et site mieux protégé',
    items: [
      "Paramètres : nouvelle « Sauvegarde de secours chiffrée ». Une copie de vos données part chaque semaine sur le serveur, chiffrée avec un code de secours que vous seul détenez : le serveur ne peut pas la lire.",
      "En cas de problème avec votre fichier Drive, « Restaurer » remet une de ces copies (les 8 dernières sont gardées).",
      "Le site envoie désormais des protections de sécurité supplémentaires à votre navigateur, et sa disponibilité est vérifiée chaque jour.",
      "Une adresse de contact : contact@pecule-app.com.",
    ],
  },
  {
    version: '2026.10.07-6',
    date: '2026-10-07',
    title: 'Et si…, alertes en euros et votre année',
    items: [
      "Nouvel écran « Et si… » (Analyses) : simulez un achat, une pause ou un autre montant d'épargne, et voyez votre épargne dans 1 à 5 ans, avec une fourchette tirée de vos propres mois passés.",
      "« À faire » chiffre ce que vous gagneriez : argent qui dort sur le compte courant, compte mieux rémunéré qui a de la place, livret bientôt plein, place libérée après la restitution.",
      "Historique : « Votre année » raconte votre année d'épargne en quelques pages (mis de côté, intérêts, bons mois, meilleur mois, jalons, cap sur l'année suivante).",
    ],
  },
  {
    version: '2026.10.07-5',
    date: '2026-10-07',
    title: 'Plus sûr entre deux appareils',
    items: [
      "Si deux appareils enregistrent au même moment, Pécule s'en aperçoit et vous demande quelle version garder : plus aucune modification ne peut être écrasée en silence.",
      "Après une reconnexion, vos modifications faites hors connexion vous sont proposées au lieu d'être abandonnées.",
      "Restitution : une date de retrait vide est refusée (elle pouvait effacer la part de vos parents sans possibilité d'annuler), et la date prévue est proposée si elle est passée.",
      "Les opérations sur les soldes (ajout, suppression, restitution, annulation) sont vérifiées par des centaines de tests automatiques.",
    ],
  },
  {
    version: '2026.10.07-4',
    date: '2026-10-07',
    title: 'Bons mois, jalons et point de paie',
    items: [
      "Accueil : une carte « Bons mois » suit ce que vous mettez de côté depuis la paie (500 € par défaut), votre série de bons mois et votre joker de l'année, qui couvre un mois plus difficile.",
      "Vos jalons (premier bon mois, épargne de précaution, 10 000 € d'épargne…) sont réunis dans « Voir vos jalons » ; chaque nouveau jalon est signalé une seule fois.",
      "Après chaque paie, un « Point de paie » résume le mois écoulé : versements, retraits, compte par compte. Validez-le pour le ranger.",
      "Fiches de paie : une fiche nettement différente des précédentes est signalée, pour vérifier une prime, des heures supplémentaires ou une absence.",
      "Paramètres, « Motivation » : activez ou non les bons mois et jalons, et choisissez le seuil d'un bon mois.",
      "Notifications : le bilan du 1er du mois devient le « point de paie », envoyé le jour de la paie suivante et regroupé avec le rappel de paie pour ne pas en recevoir deux.",
    ],
  },
  {
    version: '2026.10.07-3',
    date: '2026-10-07',
    title: 'Actualiser : plus simple',
    items: [
      "La part des parents n'apparaît plus que sur les comptes qui en ont une.",
    ],
  },
  {
    version: '2026.10.07-2',
    date: '2026-10-07',
    title: 'Accueil, Pilotage et Actualiser redessinés',
    items: [
      "Accueil : votre épargne en grand, avec sa variation sur 30 jours et sa courbe sur un an, puis une barre « disponible / avec impôt / bloqué ». Les détails moins utiles sont repliés dans « Plus de détails ».",
      "Pilotage : « À placer ce mois » d'abord, puis où le placer et d'où vient ce chiffre ; vos réglages sont rangés plus bas, par thème.",
      "Actualiser les soldes : une ligne par compte, à déplier ; la variation s'affiche dès la saisie, et « Tout enregistrer » n'est actif qu'après une modification.",
      "Graphiques redessinés, chacun avec une phrase de synthèse et un bouton « Voir les données ». « Par établissement » précise qu'il montre votre part, et suit maintenant les mêmes chiffres que les cartes.",
    ],
  },
  {
    version: '2026.10.07',
    date: '2026-10-07',
    title: 'Nouveau look Material',
    items: [
      "Pécule adopte Material 3, le style des applications Google : couleurs douces tirées du vert sapin, formes arrondies, police Google Sans Flex.",
      "Nouvelle navigation : menu latéral et barre du bas avec repère de l'écran actif, bouton « Ajouter » plus visible.",
      "Fenêtres et messages redessinés ; en mode sombre, les boutons principaux passent en vert clair pour mieux ressortir.",
    ],
  },
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
