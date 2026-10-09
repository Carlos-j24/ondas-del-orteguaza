// Service worker de Ondas del Orteguaza: permite abrir la app sin conexión.
// Páginas y content.json: primero la red (lo más nuevo); si la red no responde
// en 4 s o no hay internet, se usa la copia guardada.
// Imágenes y fuentes: se muestra la copia guardada y se actualiza en segundo plano,
// así un logo nuevo aparece en la siguiente apertura sin cambiar nada aquí.
// El audio en vivo nunca se toca.
const CACHE = 'ondas-v3';
const NETWORK_TIMEOUT_MS = 4000;
const PRECACHE = [
  '/',
  '/content.json',
  '/site.webmanifest',
  '/logo-ondas.png',
  '/logo-ondas-light.png',
  '/logo-mmm.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function saveCopy(req, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === 'navigate' ? caches.match('/') : undefined));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Stream de audio y cualquier otro dominio (excepto Google Fonts): directo a la red
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !isFont) return;

  const networkFirst = req.mode === 'navigate' || url.pathname.endsWith('.json') || url.pathname.endsWith('.html');
  if (networkFirst) {
    event.respondWith(new Promise((resolve) => {
      let settled = false;
      const useCache = () => fromCache(req).then((cached) => {
        if (!settled && cached) { settled = true; resolve(cached); }
        return cached;
      });
      // Conexión lenta: pasado el tiempo límite mostramos la copia guardada
      const timer = setTimeout(useCache, NETWORK_TIMEOUT_MS);
      fetch(req)
        .then((res) => {
          clearTimeout(timer);
          saveCopy(req, res);
          if (!settled) { settled = true; resolve(res); }
        })
        .catch(() => {
          clearTimeout(timer);
          useCache().then((cached) => {
            if (!settled) { settled = true; resolve(cached || Response.error()); }
          });
        });
    }));
    return;
  }

  // Imágenes y fuentes: copia guardada al instante + actualización en segundo plano
  event.respondWith(
    caches.match(req).then((cached) => {
      const update = fetch(req).then((res) => saveCopy(req, res)).catch(() => cached);
      if (cached) {
        event.waitUntil(update);
        return cached;
      }
      return update;
    })
  );
});
