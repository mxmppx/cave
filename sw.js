const CACHE = 'app-shell-v1';
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

  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
