const CACHE_VERSION = 'family-os-v0.1.1';

const LOCAL_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/app.css',
  '/js/app.js',
  '/js/state.js',
  '/js/schema.js',
  '/js/store-idb.js',
  '/js/migrate.js',
  '/js/auth.js',
  '/js/sync.js',
  '/js/ai.js',
  '/js/ai-actions.js',
  '/js/models-scan.js',
  '/js/ui/dialogs.js',
  '/js/ui/list.js',
  '/js/ui/settings.js',
  '/js/ui/store-mode.js',
  '/js/ui/chat.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

const FIREBASE_SDK_ASSETS = [
  'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js',
];

const API_BYPASS_HOSTS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'api.anthropic.com',
  'openrouter.ai',
  'api.groq.com',
  'api.deepseek.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await cache.addAll(LOCAL_SHELL_ASSETS);
      await Promise.all(
        FIREBASE_SDK_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { mode: 'cors', cache: 'reload' });
            if (response.ok) {
              await cache.put(url, response);
            }
          } catch {
            // Allow offline test installs when CDN is unreachable; retried on future fetch
          }
        })
      );
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function shouldBypass(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  if (url.origin === self.location.origin) {
    return url.pathname.startsWith('/__/firebase/');
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return true;
  }
  return API_BYPASS_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith('.' + host)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (shouldBypass(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok && url.origin === self.location.origin) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put('/index.html', networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          return (await cache.match('/index.html')) || (await cache.match('/'));
        }
      })()
    );
    return;
  }

  const isStaticOrigin =
    url.origin === self.location.origin || FIREBASE_SDK_ASSETS.includes(url.href);

  if (!isStaticOrigin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request, {
        ignoreSearch: url.origin === self.location.origin,
      });
      if (cached) return cached;

      const response = await fetch(request);
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
