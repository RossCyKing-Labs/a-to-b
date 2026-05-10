/**
 * Service worker for a → b.
 *
 * Strategy:
 *  - Precache the shell on install (homepage, converter routes, key assets).
 *  - Runtime: cache-first for static assets (immutable hashed bundles),
 *    stale-while-revalidate for HTML so updates propagate naturally.
 *  - Skip waiting + claim clients on activate so updates roll out without
 *    requiring a tab close.
 *
 * The privacy posture stands: the SW only ever fetches our own origin.
 * It never sends user files anywhere — file conversion still happens in
 * the page, in memory, with no upload endpoint.
 *
 * Bump CACHE_VERSION when shipping changes that require old caches gone.
 */

const CACHE_VERSION = 'a-to-b-v1';

const PRECACHE = [
  '/',
  '/about',
  '/privacy',
  '/image',
  '/word-to-pdf',
  '/pdf-to-word',
  '/favicon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll fails atomically if any precache target 404s — use individual
      // adds with catch so a single missing path doesn't break the install.
      await Promise.allSettled(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { credentials: 'same-origin' })).catch((err) => {
            console.warn('[sw] precache miss:', url, err);
          }),
        ),
      );
      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GETs
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin only. We never proxy or fetch off-origin.
  if (url.origin !== self.location.origin) return;

  // Don't intercept the PDF.js worker (it's same-origin and works fine
  // through the cache, but we skip on extra safety) or any blob: URLs.
  if (url.protocol === 'blob:') return;

  const isHtml =
    req.mode === 'navigate' ||
    req.headers.get('accept')?.includes('text/html');

  if (isHtml) {
    // Stale-while-revalidate for HTML: serve cached if we have it, refresh in background.
    event.respondWith(staleWhileRevalidate(req));
  } else {
    // Cache-first for static assets (Astro hashes them, so they're immutable).
    event.respondWith(cacheFirst(req));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || networkPromise;
}
