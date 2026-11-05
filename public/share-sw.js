// ================================================
// Extension du service worker généré par vite-plugin-pwa (importé via
// workbox.importScripts) : « Partager vers Pécule » (Web Share Target, déclaré dans le
// manifeste, vite.config.ts). L'app installée reçoit le fichier partagé (Gmail, Drive,
// Fichiers…) en POST multipart sur `partager`. Le fichier est rangé dans un cache à part,
// sur l'appareil seulement, puis l'app est ouverte avec `?partage=…` : c'est elle qui,
// après le verrou et le chargement des données, demande quoi en faire, et efface le fichier
// dès qu'elle l'a lu. Un fichier jamais lu est effacé au bout de 10 minutes, à l'activation du
// service worker, à chaque nouveau partage et à chaque ouverture de l'app (l'app le vide aussi
// à la déconnexion).
// ================================================
(function (root) {
  var CACHE = 'pecule-partage';
  var ENDPOINT = 'partager';
  var ENTRY = 'partage/fichier';
  var FIELD = 'fichiers';
  // Même limite que la lecture d'un relevé ou d'un avis d'imposition dans l'app.
  var MAX_BYTES = 15 * 1024 * 1024;
  var MAX_AGE_MS = 10 * 60 * 1000;
  // Relevés OFX et CSV : lus sur l'appareil par l'app (lib/statementFiles), sans clé.
  var TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/csv', 'application/x-ofx'];

  // Type annoncé, sinon d'après l'extension (certaines apps envoient un type vide ou générique).
  // Un relevé OFX ou CSV arrive souvent sans type précis (octet-stream, text/plain, variantes) :
  // son extension fait foi.
  function fileType(file) {
    var type = (file.type || '').toLowerCase();
    var name = (file.name || '').toLowerCase();
    if (/\.(ofx|qfx)$/.test(name)) return 'application/x-ofx';
    if (/\.csv$/.test(name)) return 'text/csv';
    if (type === 'text/comma-separated-values') return 'text/csv';
    if (type && type !== 'application/octet-stream') return type;
    if (/\.pdf$/.test(name)) return 'application/pdf';
    if (/\.png$/.test(name)) return 'image/png';
    if (/\.jpe?g$/.test(name)) return 'image/jpeg';
    if (/\.webp$/.test(name)) return 'image/webp';
    return '';
  }

  // Réponse du partage : toujours une redirection vers l'app (303 : la page suivante est
  // chargée en GET), avec le résultat dans l'adresse. Jamais de POST laissé sans réponse.
  function receive(request, scope) {
    return request.formData()
      .then(function (form) {
        var files = form.getAll(FIELD).filter(function (f) { return f && typeof f === 'object' && typeof f.size === 'number'; });
        var file = files.find(function (f) { return TYPES.indexOf(fileType(f)) !== -1; });
        if (!file) return files.length ? 'type' : 'erreur';
        if (file.size > MAX_BYTES) return 'taille';
        var headers = {
          'Content-Type': fileType(file),
          'X-Pecule-Nom': encodeURIComponent(file.name || 'document'),
          'X-Pecule-Recu': String(Date.now()),
        };
        return root.caches.open(CACHE)
          .then(function (cache) { return cache.put(scope + ENTRY, new Response(file, { headers: headers })); })
          .then(function () { return '1'; });
      })
      .catch(function () { return 'erreur'; })
      .then(function (marker) { return Response.redirect(scope + '?partage=' + marker, 303); });
  }

  // Fichier reçu il y a plus de 10 minutes et jamais lu : effacé.
  function purgeStale(now) {
    return root.caches.open(CACHE)
      .then(function (cache) {
        return cache.match(root.registration.scope + ENTRY).then(function (res) {
          if (!res) return undefined;
          var at = Number(res.headers.get('X-Pecule-Recu'));
          if (!(at > 0) || now - at > MAX_AGE_MS) return cache.delete(root.registration.scope + ENTRY);
          return undefined;
        });
      })
      .catch(function () { return undefined; });
  }

  // Activation du service worker : un fichier resté d'une version précédente est effacé aussitôt.
  root.addEventListener('activate', function (event) {
    event.waitUntil(purgeStale(Date.now()));
  });

  root.addEventListener('fetch', function (event) {
    var request = event.request;
    var scope = root.registration.scope;
    if (request.method === 'POST' && request.url.split('?')[0] === scope + ENDPOINT) {
      // Nouveau partage : le ménage passe d'abord, puis le nouveau fichier est rangé.
      event.respondWith(purgeStale(Date.now()).then(function () { return receive(request, scope); }));
      return;
    }
    // Ouverture de l'app : le ménage se fait en parallèle, la page est servie comme d'habitude
    // par les autres gestionnaires (Workbox).
    if (request.mode === 'navigate') event.waitUntil(purgeStale(Date.now()));
  });
})(self);
