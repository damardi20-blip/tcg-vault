// Service worker: permite abrir la app sin conexión y guarda las imágenes de cartas ya vistas.
const VERSION = 'v5';
const SHELL = `tcgvault-shell-${VERSION}`;
const DATA = 'tcgvault-data';
const IMAGES = 'tcgvault-images';
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'scanner.js', 'firebase-config.js', 'manifest.json',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('tcgvault-shell-') && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Imágenes de cartas: primero la copia guardada (no cambian nunca).
  if (['assets.tcgdex.net', 'images.pokemontcg.io', 'images.scrydex.com', 'limitlesstcg.nyc3.cdn.digitaloceanspaces.com'].includes(url.hostname)) {
    e.respondWith(caches.open(IMAGES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // Datos de cartas y precios: primero internet (para tener el precio del día), si no la copia.
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }

  // Resto de la app: internet si hay (para recibir mejoras), si no la copia guardada.
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
