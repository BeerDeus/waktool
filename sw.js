// Service worker Waktool : code/données en « réseau d'abord » (toujours à jour, cache si hors ligne),
// images et moteur OCR en « cache d'abord ». Les services Google/Firebase ne sont jamais mis en cache.
const VERSION = 'v3';
const CORE = `waktool-core-${VERSION}`;
const STATIC = `waktool-static-${VERSION}`;
const PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'img/app/icon-192.png', 'img/app/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CORE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('waktool-') && ![CORE, STATIC].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isStatic = url => /\.(png|jpe?g|gif|webp|svg|gz|wasm)$/.test(url.pathname) || url.pathname.includes('/vendor/');

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase, Google… : pas de cache

  if (isStatic(url)) {
    e.respondWith(caches.open(STATIC).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // réseau d'abord, repli sur le cache (hors ligne)
  e.respondWith(fetch(req).then(res => {
    if (res.ok) {
      const copy = res.clone(); // à cloner tout de suite : la page va consommer la réponse
      e.waitUntil(caches.open(CORE).then(c => c.put(req, copy)));
    }
    return res;
  }).catch(async () => (await caches.match(req, { ignoreSearch: req.mode === 'navigate' })) ||
    (req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
