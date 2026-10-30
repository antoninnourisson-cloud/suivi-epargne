// Ouvrir le rituel « J'ai reçu ma paie » depuis ailleurs (lien `?view=pilot&action=pay` d'une
// notification ou du raccourci de l'icône, routine de l'Accueil) : la demande attend que le
// Pilotage (chargé à la demande) soit monté, ou lui parvient tout de suite s'il est affiché.
export const OPEN_PAY_SHEET_EVENT = 'pecule:open-pay-sheet';

let pending = false;

/** Demande l'ouverture du rituel (puis afficher le Pilotage). */
export const requestPaySheet = () => {
  pending = true;
  window.dispatchEvent(new CustomEvent(OPEN_PAY_SHEET_EVENT));
};

/** Une demande attend-elle ? Elle est consommée (une seule ouverture par demande). */
export const takePaySheetRequest = (): boolean => {
  const was = pending;
  pending = false;
  return was;
};
