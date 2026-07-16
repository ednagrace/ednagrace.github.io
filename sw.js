/* Service Worker — Relatório Diário
   Estratégia: CACHE PRIMEIRO (rápido para a promotora) + revalidação em segundo plano.
   Quando uma versão nova é detectada, ela ativa na hora e a página recarrega sozinha.
   Troque a versão a cada atualização. */
const CACHE = 'edna-relatorio-v45';
// URLs VERSIONADAS: uma versão nova muda a URL, então o navegador é obrigado a
// baixar de novo — não tem como o cache HTTP (max-age=600 do GitHub Pages) servir
// o arquivo velho. Use ./bump.sh <n> para trocar a versão em todos os lugares.
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=45',
  './app.js?v=45',
  './manifest.webmanifest',
  './icons/icon.svg',
];

/* Ao instalar, busca os arquivos IGNORANDO o cache HTTP do navegador.
   Sem o { cache: 'reload' }, o addAll pode gravar a versão VELHA que ainda estava no
   cache HTTP do GitHub Pages (Cache-Control: max-age=600). Era o bug que travava o app
   numa versão antiga: o SW dizia "v33", mas servia o app.js "v31". */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A página pode pedir para ativar a versão nova imediatamente.
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Só cuidamos do próprio site. API (Vercel) e Google passam direto.
  if (new URL(req.url).origin !== self.location.origin) return;

  // Cache primeiro (resposta instantânea) + revalidação em segundo plano.
  // O 'no-store' garante que a revalidação pegue de verdade a versão nova,
  // sem ser servida pelo cache HTTP do navegador.
  e.respondWith(
    caches.match(req).then((cached) => {
      const rede = fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return res;
        })
        .catch(() => cached);
      return cached || rede;
    })
  );
});
