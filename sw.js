/* Service Worker — Relatório Diário
   Estratégia: CACHE PRIMEIRO (rápido para a promotora) + revalidação em segundo plano.
   Quando uma versão nova é detectada, ela ativa na hora e a página recarrega sozinha.
   Troque a versão a cada atualização. */
const CACHE = 'edna-relatorio-v77';
// URLs VERSIONADAS: uma versão nova muda a URL, então o navegador é obrigado a
// baixar de novo — não tem como o cache HTTP (max-age=600 do GitHub Pages) servir
// o arquivo velho. Use ./bump.sh <n> para trocar a versão em todos os lugares.
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=77',
  './build/main.js?v=77',
  './build/state.js',
  './build/env.js',
  './build/constants.js',
  './build/dateUtils.js',
  './build/format.js',
  './build/ui.js',
  './build/nav.js',
  './build/router.js',
  './build/theme.js',
  './build/aggregations.js',
  './build/contacts.js',
  './build/api.js',
  './build/photo.js',
  './build/auth.js',
  './build/render.js',
  './build/pdf.js',
  './build/push.js',
  './build/screens/login.js',
  './build/screens/list.js',
  './build/screens/panel.js',
  './build/screens/form.js',
  './build/screens/messages.js',
  './build/screens/import.js',
  './build/screens/menu.js',
  './build/components/contatoSheet.js',
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

// Lembrete de retorno de cliente: notificação push disparada pelo cron do back-end.
self.addEventListener('push', (e) => {
  let data = { title: 'Relatório Diário', body: 'Você tem um lembrete.' };
  try { if (e.data) data = e.data.json(); } catch (err) {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'lembrete-cliente',
    })
  );
});

// O navegador pode ROTACIONAR a inscrição sozinho (expira, troca de token do
// FCM…). Quando isso acontece a inscrição antiga morre e, sem este handler, os
// lembretes param de chegar em silêncio para sempre. Aqui a gente refaz a
// inscrição e conta pro servidor, trocando a linha antiga pela nova (sem sessão —
// o back-end aceita a troca porque reconhece o endpoint antigo).
const PUSH_API = 'https://relatorio-api.vercel.app';
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const oldEndpoint = (e.oldSubscription && e.oldSubscription.endpoint) || null;
      const root = await (await fetch(PUSH_API + '/', { cache: 'no-store' })).json();
      if (!root.pushPublicKey) return;
      const sub = e.newSubscription || await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(root.pushPublicKey),
      });
      await fetch(PUSH_API + '/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldEndpoint, subscription: sub.toJSON() }),
      });
    } catch (err) { /* nada a fazer offline; tenta de novo na próxima rotação */ }
  })());
});

// Toque na notificação → foca uma aba já aberta do app, ou abre uma nova.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const c of clientsList) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
