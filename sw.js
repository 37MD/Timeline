// ── Timeline Scanner — Service Worker ──
// Cache-first app shell for a single-file PWA: everything (HTML, CSS, JS,
// Chart.js) is inlined into Timeline_18H.html, so the "app shell" is just that
// one file plus the manifest and icons. All actual DATA (NSE/NPS/BAF
// price history) lives in IndexedDB, which the browser manages
// independently of this cache — this service worker only makes the app's
// CODE available offline, not its downloaded market data.
//
// Cache name matches the app's own APP_VERSION constant (see
// ldBuildBackupPayload in index.html) so a version bump in one place is a
// clear signal to bump the other too, even though they serve different
// purposes (backup format vs. offline shell).
//
// 2026-08-21: bumped v6.04 -> v6.05. AUDIT FIX: the APP_SHELL list and the
// offline-navigation fallback both referenced './index.html' and './', but
// the actual app file is Timeline_18H.html. There is no index.html in the
// root of this deployment — the only index.html in the project lives inside
// the icons/ subfolder (unrelated). The v6.04 cache therefore silently 404'd
// on every install (individual cache.add().catch() swallowed the error) and
// the offline navigation fallback returned a useless 404 response instead of
// the real app shell. Fixed all three references to './Timeline_18H.html'
// and bumped the cache name so browsers with the old broken v6.04 cache are
// forced to re-fetch from scratch on the next service worker update cycle.
//
// 2026-08-19: bumped v6.03 -> v6.04. The v6.03 tag was set in index.html
// alongside sw.js during the Indigo Pulse dark-theme UI redesign, but
// because this is a cache-first service worker, a same-named CACHE_NAME
// does NOT guarantee a fresh index.html is served on next load — the old
// cached copy is served instantly and only refreshed in the background
// for the *next* visit (stale-while-revalidate). Bumping the cache name
// forces the activate handler below to delete the old cache outright and
// re-fetch everything fresh on this deploy, so the dark-theme rebuild
// actually reaches the phone on the next app open instead of silently
// serving the old light-mode index.html for one more session.
const CACHE_NAME = 'timeline-scanner-v6.07';

const APP_SHELL = [
  './Timeline_18H.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-maskable-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
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
          // cached Timeline_18H.html so the app shell still loads.
          if (event.request.mode === 'navigate') {
            return caches.match('./Timeline_18H.html');
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
