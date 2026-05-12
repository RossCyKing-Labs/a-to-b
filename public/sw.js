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
 * Note on redirects: routes like /image are served from /image/index.html
 * via a 301. Browsers refuse to accept a "redirected" response for a
 * navigation request whose redirect mode is "manual" (the default). We
 * sanitize redirected responses by re-creating them as fresh Responses
 * without the redirected flag — see sanitize() below.
 *
 * Bump CACHE_VERSION when shipping changes that require old caches gone.
 */

const CACHE_VERSION = 'a-to-b-v12';

const PRECACHE = [
  '/',
  '/about',
  '/privacy',
  '/image',
  '/merge-pdf',
  '/split-pdf',
  '/jpg-to-pdf',
  '/pdf-to-jpg',
  '/rotate-pdf',
  '/compress-pdf',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/og-image.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.allSettled(PRECACHE.map((url) => precacheUrl(cache, url)));
      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      );
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

  // Don't intercept blob: URLs (PDF.js worker uses these).
  if (url.protocol === 'blob:') return;

  const isHtml =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHtml) {
    event.respondWith(staleWhileRevalidate(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

/**
 * Manual precache helper that handles redirects safely.
 * cache.add() and cache.addAll() refuse to cache redirected responses,
 * so we fetch + sanitize + put ourselves.
 */
async function precacheUrl(cache, url) {
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'reload',
    });
    if (!response.ok) return;
    const sane = await sanitize(response);
    await cache.put(url, sane);
  } catch (err) {
    console.warn('[sw] precache miss:', url, err);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const forCache = await sanitize(response.clone());
      cache.put(request, forCache);
    }
    return await sanitize(response);
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const forCache = await sanitize(response.clone());
        cache.put(request, forCache);
      }
      return await sanitize(response);
    })
    .catch(() => cached);

  return cached || networkPromise;
}

/**
 * If the response was the result of a redirect, the browser won't accept it
 * for navigation requests (whose redirect mode is "manual"). Re-create the
 * response without the redirected flag by reading the body and instantiating
 * a fresh Response.
 */
async function sanitize(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText || '',
    headers: response.headers,
  });
}
