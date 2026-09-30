// ================================================
// Extension du service worker généré par vite-plugin-pwa (importé via
// workbox.importScripts) : réception des notifications push et gestion du clic.
// Le contenu arrive chiffré de bout en bout (RFC 8291) ; le navigateur le déchiffre
// avant de le remettre ici.
// ================================================
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Suivi Épargne';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: 'pwa-192x192.png',
      badge: 'pwa-192x192.png',
      // Même tag = la nouvelle notification remplace l'ancienne au lieu de s'empiler.
      tag: data.tag,
      data: { url: data.url || './' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope);
  // Écran visé (`?view=update`…) : transmis à une fenêtre déjà ouverte, ou lu au démarrage.
  const view = target.searchParams.get('view') || 'dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Une fenêtre de l'app est déjà ouverte : on la ramène au premier plan sur le bon
      // écran, sans la recharger.
      for (const w of windows) {
        if (w.url.startsWith(self.registration.scope) && 'focus' in w) {
          w.postMessage({ type: 'open-view', view });
          return w.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
