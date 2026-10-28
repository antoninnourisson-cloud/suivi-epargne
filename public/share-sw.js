// ================================================
// Extension du service worker généré par vite-plugin-pwa (importé via
// workbox.importScripts) : « Partager vers Pécule » (Web Share Target, déclaré dans le
// manifeste, vite.config.ts). L'app installée reçoit le fichier partagé (Gmail, Drive,
// Fichiers…) en POST multipart sur `partager`. Le fichier est rangé dans un cache à part,
// sur l'appareil seulement, puis l'app est ouverte avec `?partage=…` : c'est elle qui,
// après le verrou et le chargement des données, demande quoi en faire, et efface le fichier
// dès qu'elle l'a lu. Un fichier jamais lu est effacé au bout d'une heure, à la prochaine
// ouverture de l'app.
// ================================================
(function (root) {
  var CACHE = 'pecule-partage';
  var ENDPOINT = 'partager';
  var ENTRY = 'partage/fichier';
  var FIELD = 'fichiers';
  // Même limite que la lecture d'un relevé ou d'un avis d'imposition dans l'app.
  var MAX_BYTES = 15 * 1024 * 1024;
  var MAX_AGE_MS = 60 * 60 * 1000;
  var TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

  // Type annoncé, sinon d'après l'extension (certaines apps envoient un type vide ou générique).
  function fileType(file) {
    var type = (file.type || '').toLowerCase();
    if (type && type !== 'application/octet-stream') return type;
    var name = (file.name || '').toLowerCase();
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

  // Fichier reçu il y a plus d'une heure et jamais lu : effacé.
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

  root.addEventListener('fetch', function (event) {
    var request = event.request;
    var scope = root.registration.scope;
    if (request.method === 'POST' && request.url.split('?')[0] === scope + ENDPOINT) {
      event.respondWith(receive(request, scope));
      return;
    }
    // Ouverture de l'app : le ménage se fait en parallèle, la page est servie comme d'habitude
    // par les autres gestionnaires (Workbox).
    if (request.mode === 'navigate') event.waitUntil(purgeStale(Date.now()));
  });
})(self);
