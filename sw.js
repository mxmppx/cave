const CACHE = 'app-shell-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/supabase.js',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Backend externe (Supabase) : toujours réseau, jamais de cache
  if (url.hostname.endsWith('supabase.co')) return;

  // Document HTML (navigation) : réseau en priorité pour toujours servir la
  // dernière version publiée ; le cache ne sert que de secours hors-ligne.
  if (e.request.mode === 'navigate' || url.pathname === '/index.html' || url.pathname === '/') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Autres ressources statiques (icônes, manifest, supabase.js) : cache
  // d'abord, réseau en secours — elles changent rarement.
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
