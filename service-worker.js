// ========== SERVICE WORKER — TallerMotos Inventario ==========
// Estrategia: network-first para documentos y cache-first con refresco para assets.
// IndexedDB NO se ve afectado por este Service Worker — los datos siempre
// están disponibles offline independientemente del estado del cache.

// Incrementa este número cada vez que publiques cambios en index.html
// (o en cualquier archivo cacheado) para forzar la actualización del cache
// en los dispositivos de los usuarios.
const SW_CACHE_VERSION = 'v6';
const CACHE_NAME = `tallermotos-cache-${SW_CACHE_VERSION}`;

// Archivos del shell de la app (rutas relativas al repositorio)
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-maskable.svg'
];

// CDNs externos usados por la app (Tailwind + ExcelJS + Google Fonts)
const CDN_FILES = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap'
];

// ── INSTALL: precachear shell + CDNs ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Shell: si falla un archivo, abortamos (son críticos)
      const shellPromise = cache.addAll(SHELL_FILES);
      // CDNs: si fallan (sin internet en el primer install), no abortamos —
      // simplemente no quedarán precacheados hasta la primera visita online.
      const cdnPromise = Promise.allSettled(
        CDN_FILES.map((url) =>
          fetch(url, { mode: 'no-cors' })
            .then((resp) => cache.put(url, resp))
            .catch((err) => console.warn('[SW] No se pudo precachear CDN:', url, err))
        )
      );
      return Promise.all([shellPromise, cdnPromise]);
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: limpiar caches de versiones anteriores ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('tallermotos-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: documentos network-first; assets cache-first con actualización en segundo plano ──
self.addEventListener('fetch', (event) => {
  // Solo interceptar peticiones GET
  if (event.request.method !== 'GET') return;

  const isNavigationRequest =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') || '').includes('text/html');

  if (isNavigationRequest) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('./index.html', responseClone.clone());
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cachedResponse) =>
          cachedResponse || caches.match('./index.html')
        ))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Petición en paralelo para refrescar el cache (no bloquea la respuesta)
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          // Solo cacheamos respuestas válidas (evita guardar errores 4xx/5xx)
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => null); // sin conexión — no hay red, dependemos del cache

      // Si hay algo en cache, lo devolvemos de inmediato (cache-first).
      // Si no hay nada en cache, esperamos la respuesta de red.
      return cachedResponse || networkFetch;
    })
  );
});
