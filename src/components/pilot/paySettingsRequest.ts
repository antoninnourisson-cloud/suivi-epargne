// Ouvrir « Réglages de la paie › Paie habituelle » depuis ailleurs (Paramètres › Notifications,
// « Modifier : Pilotage › Paie habituelle ») : la demande attend que le Pilotage (chargé à la demande) soit
// monté, ou lui parvient tout de suite s'il est affiché. L'ancre est stable (liens).
export const PAY_SETTINGS_INCOME_ID = 'pay-settings-income';
export const OPEN_PAY_SETTINGS_EVENT = 'pecule:open-pay-settings';

let pending = false;

/** Demande l'ouverture du groupe « Paie habituelle » (puis afficher le Pilotage). */
export const requestPaySettings = () => {
  pending = true;
  window.dispatchEvent(new CustomEvent(OPEN_PAY_SETTINGS_EVENT));
};

/** Une demande attend-elle ? Elle est consommée (une seule ouverture par demande). */
export const takePaySettingsRequest = (): boolean => {
  const was = pending;
  pending = false;
  return was;
};
