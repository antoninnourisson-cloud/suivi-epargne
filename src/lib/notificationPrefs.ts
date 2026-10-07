// Types de notifications, activables un par un (Paramètres). Partagé avec le serveur, qui
// n'envoie que les types laissés actifs. La catégorie d'un rappel se lit dans le début de sa
// clé de dédoublonnage (« payday:… », « sub:… »).

export interface NotificationCategory { id: string; label: string; prefixes: string[] }

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  { id: 'payday', label: 'Jour de paie : quoi placer, et où', prefixes: ['payday'] },
  { id: 'payday-followup', label: 'Relance des virements de paie non cochés', prefixes: ['payday-followup'] },
  { id: 'subscriptions', label: 'Prélèvements des abonnements', prefixes: ['sub'] },
  { id: 'recurring', label: 'Échéances récurrentes à enregistrer', prefixes: ['recurring'] },
  { id: 'stale', label: 'Soldes non actualisés depuis un mois', prefixes: ['stale'] },
  { id: 'rates', label: 'Révision des taux des livrets', prefixes: ['rates'] },
  { id: 'lep', label: 'Éligibilité au LEP', prefixes: ['lep'] },
  { id: 'tax', label: 'Impôts : déclaration, dons, paramètres fiscaux, relevés annuels', prefixes: ['donations', 'fiscal-review', 'annual-statement'] },
  { id: 'parents', label: 'Capital des parents : intérêts et restitution', prefixes: ['parental', 'restitution-prep', 'restitution-day'] },
  { id: 'recap', label: 'Point de paie (bilan de la paie précédente)', prefixes: ['recap'] },
  { id: 'year-review', label: "Bilan de l'année", prefixes: ['year-review'] },
];

export type NotificationPrefs = Record<string, boolean>;

export const categoryOfKey = (key: string): NotificationCategory | undefined => {
  const prefix = key.split(':')[0];
  return NOTIFICATION_CATEGORIES.find(c => c.prefixes.includes(prefix));
};

/** Un type absent des préférences reste actif (tout est activé par défaut). */
export const isReminderEnabled = (key: string, prefs?: NotificationPrefs): boolean => {
  const cat = categoryOfKey(key);
  return !cat || prefs?.[cat.id] !== false;
};
