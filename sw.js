/* Service Worker — cache do app (funciona offline).
   Troque a versão (v1 -> v2...) sempre que atualizar os arquivos. */
const CACHE = 'edna-relatorio-v9';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Nunca cacheia chamadas ao Apps Script (sempre rede).
  if (req.url.includes('script.google.com') || req.url.includes('script.googleusercontent.com')) {
    return; // deixa passar direto para a rede
  }
  if (req.method !== 'GET') return;

  // App shell: cache-first com atualização em segundo plano.
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
