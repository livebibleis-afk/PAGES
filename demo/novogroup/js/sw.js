const CACHE_NAME = 'novo-group-shell-v3';
const SHELL_ASSETS = [
  './',
  './index.html',
  './servicios.html',
  './cirugias.html',
  './uci.html',
  './hospitalizacion.html',
  './contacto.html',
  './css/estilos.css',
  './js/main.js',
  './img/icono.svg',
  './img/favicon-32.png',
  './img/icono-192.png',
  './img/icono-512.png',
  './manifest.webmanifest'
];

const isLocalhost = () =>
  self.location.hostname === 'localhost' ||
  self.location.hostname === '127.0.0.1' ||
  self.location.hostname === '[::1]';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // En localhost priorizamos siempre la red sin usar caché obsoleta para no interferir con el desarrollo
  if (isLocalhost()) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() =>
        caches.match(event.request)
      )
    );
    return;
  }

  // Estrategia Network-First con respaldo en caché para conexiones inestables en Android
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return undefined;
        })
      )
  );
});
