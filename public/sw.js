/**
 * Service worker for a → b.
 *
 * Strategy:
 *  - Precache the shell on install (homepage, converter routes, key assets).
 *  - Runtime: cache-first for static assets (immutable hashed bundles),
 *    NETWORK-FIRST for HTML navigations (3.5s timeout → cached shell).
 *    HTML must be network-first: each deploy replaces every fingerprinted
 *    /_astro/* file, so serving a stale cached page points it at chunks
 *    that no longer exist on the server ("Failed to fetch dynamically
 *    imported module"). Offline still works via the cache fallback.
 *  - Skip waiting + claim clients on activate so updates roll out without
 *    requiring a tab close.
 *
 * The privacy posture stands: the SW only ever fetches our own origin.
 * It never sends user files anywhere — file conversion still happens in
 * the page, in memory, with no upload endpoint.
 *
 * Note on redirects: routes like /image are served from /image/index.html
 * via a 30x redirect. The SW never follows redirects itself (SW-internal
 * redirect-following is unreliable — it hangs under wrangler dev): redirect
 * responses are returned untouched for the browser to follow, and all
 * caching happens at the final trailing-slash URLs. sanitize() remains as a
 * belt-and-braces guard for any response that still arrives redirected.
 *
 * Bump CACHE_VERSION when shipping changes that require old caches gone.
 */

const CACHE_VERSION = 'a-to-b-v18';

// Routes are precached at their FINAL trailing-slash URLs: '/about' 30x-redirects
// to '/about/', and fetches that follow redirects inside a service worker are
// unreliable (they hang under wrangler dev's 307s). Navigations to the bare
// route hit the redirect, which we hand back to the browser; it re-enters the
// SW at the slashed URL, which is what we cache and serve.
const PRECACHE = [
  '/',
  '/about/',
  '/privacy/',
  '/image/',
  '/merge-pdf/',
  '/split-pdf/',
  '/jpg-to-pdf/',
  '/pdf-to-jpg/',
  '/rotate-pdf/',
  '/compress-pdf/',
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
    event.respondWith(networkFirst(event));
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

/**
 * Network-first for HTML navigations.
 *
 * Fresh HTML is required for correctness (its /_astro/* chunk hashes only
 * exist on the CURRENT deploy), so we go to the network and fall back to the
 * cached shell only when the network is down or slower than NAV_TIMEOUT_MS.
 *
 * Details that matter:
 *  - We fetch a fresh Request with redirect:'follow' instead of
 *    fetch(event.request): navigation requests carry redirect:'manual', and
 *    re-fetching those returns an opaqueredirect in Safari (status 0) that
 *    the browser then rejects. cache:'no-cache' also forces HTTP-cache
 *    revalidation so stale browser-cached HTML can't reintroduce the skew.
 *  - The network promise keeps running under event.waitUntil even when the
 *    timer wins, so the offline copy still gets refreshed.
 *  - Non-ok responses (real 404s) are returned as-is, never cached.
 */
const NAV_TIMEOUT_MS = 3500;
const NAV_TIMEOUT = Symbol('timeout');
const NAV_FAILED = Symbol('failed');

async function networkFirst(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_VERSION);

  const network = (async () => {
    // redirect:'manual' — we never follow redirects inside the SW (following
    // is unreliable here; see PRECACHE note). A redirect is handed straight
    // back to the browser, which follows it and re-enters this SW at the
    // final trailing-slash URL.
    const response = await fetch(
      new Request(request.url, {
        redirect: 'manual',
        credentials: 'same-origin',
        cache: 'no-cache',
      }),
    );
    if (
      response.type === 'opaqueredirect' ||
      (response.status >= 300 && response.status < 400)
    ) {
      return response; // untouched — the browser handles it
    }
    if (response.ok) {
      const forCache = await sanitize(response.clone());
      await cache.put(request, forCache);
    }
    return sanitize(response);
  })();
  // Let the fetch + cache.put finish even if we answer from cache below.
  event.waitUntil(network.catch(() => {}));

  const timer = new Promise((resolve) => setTimeout(() => resolve(NAV_TIMEOUT), NAV_TIMEOUT_MS));
  const winner = await Promise.race([network.catch(() => NAV_FAILED), timer]);
  if (winner !== NAV_TIMEOUT && winner !== NAV_FAILED) return winner;

  const cached = await matchShell(cache, request);
  if (cached) return cached;

  // No cached copy: a slow network is still better than nothing.
  if (winner === NAV_TIMEOUT) {
    try {
      return await network;
    } catch {
      /* fall through */
    }
  }
  return (
    (await cache.match('/')) ?? new Response('Offline', { status: 503, statusText: 'Offline' })
  );
}

/**
 * Cache lookup for a navigation, tolerant of the bare-vs-trailing-slash URL
 * split: offline, a navigation to '/about' can't reach the network for its
 * redirect, but the shell is cached at '/about/'.
 */
async function matchShell(cache, request) {
  const direct = await cache.match(request);
  if (direct) return direct;
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/')) {
    return cache.match(url.pathname + '/');
  }
  return undefined;
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
