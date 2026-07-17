// ── Timeline Scanner — Service Worker ──
// Cache-first app shell for a single-file PWA: everything (HTML, CSS, JS,
// Chart.js) is inlined into index.html, so the "app shell" is just that
// one file plus the manifest and icons. All actual DATA (NSE/NPS/BAF
// price history) lives in IndexedDB, which the browser manages
// independently of this cache — this service worker only makes the app's
// CODE available offline, not its downloaded market data.
//
// Cache name matches the app's own APP_VERSION constant (see
// ldBuildBackupPayload in index.html) so a version bump in one place is a
// clear signal to bump the other too, even though they serve different
// purposes (backup format vs. offline shell).
const CACHE_NAME = 'timeline-scanner-v5.5';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/icon-180.png',
  './icons/favicon.png',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll fails atomically if ANY resource 404s — use individual
      // add() calls with catch so one missing/renamed icon doesn't block
      // the whole app shell from being cached.
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Failed to cache during install:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle same-origin GET requests. Cross-origin requests (NSE CSV
  // endpoints, mfapi.in, npsnav.in, CORS proxies) must always hit the
  // network directly — this app's own data-freshness logic (see
  // fetchWithFallback, _deepLoadAsync in index.html) depends on that,
  // and caching those responses here would silently serve stale market
  // data indefinitely.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          // Only cache successful, basic (same-origin) responses.
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline and not in cache: for navigations, fall back to the
          // cached index.html so the app shell still loads.
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return undefined;
        });

      // Cache-first: serve cached copy instantly if present, but still
      // refresh the cache in the background (stale-while-revalidate) so
      // the next load picks up any app update.
      return cachedResponse || networkFetch;
    })
  );
});
