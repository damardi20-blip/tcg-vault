// Service worker: la app abre al instante con lo guardado y se actualiza por detrás; también permite
// usarla sin conexión y guarda las imágenes de cartas ya vistas.
const VERSION = 'v28';
const SHELL = `tcgvault-shell-${VERSION}`;
const DATA = 'tcgvault-data';
const IMAGES = 'tcgvault-images';
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'scanner.js', 'centering.js', 'firebase-config.js', 'manifest.json',
  'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/logo-header.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
  if (['assets.tcgdex.net', 'images.pokemontcg.io', 'images.scrydex.com', 'limitlesstcg.nyc3.cdn.digitaloceanspaces.com', 'www.pokemon-card.com', 'www.cardtrader.com'].includes(url.hostname)) {
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

  // Datos de cartas y precios: internet si contesta en 2,5 s (precio del día); si tarda más, la copia
  // guardada al momento, y la respuesta de internet se guarda para la próxima vez.
  if (url.pathname.includes('/data/')) {
    e.respondWith((async () => {
      const net = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put(req, copy)); }
        return res;
      });
      const cached = await caches.match(req, { ignoreSearch: true });
      if (!cached) return net;
      const timeout = new Promise(r => setTimeout(() => r(null), 2500));
      const res = await Promise.race([net.catch(() => null), timeout]);
      e.waitUntil(net.catch(() => {}));
      return res || cached;
    })());
    return;
  }

  // Resto de la app: la copia guardada al instante y, por detrás, la versión nueva para la próxima vez.
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    });
    if (cached) { e.waitUntil(net.catch(() => {})); return cached; }
    return net.catch(() => caches.match('index.html'));
  })());
});
