// Échec qui vient VRAIMENT du réseau (requête partie nulle part, délai dépassé, serveur ou
// script Google injoignable). Seul ce type est classé « hors ligne » par la synchronisation
// (hooks/portfolio/syncShared, lib/syncErrors) : une autre TypeError est un bug de code, et ne
// doit ni s'afficher « hors ligne » ni relancer des essais en boucle.
//
// Sous-classe de TypeError : le code qui testait déjà `instanceof TypeError` pour reconnaître
// un échec de fetch (démarrage de session, copie de secours) continue de fonctionner.
export class NetworkError extends TypeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

/** Enveloppe l'erreur levée par un `fetch` (ou un chargement de script) en NetworkError. */
export const asNetworkError = (e: unknown, message = 'NETWORK_FAILURE'): NetworkError =>
  e instanceof NetworkError ? e : new NetworkError(message, { cause: e });
