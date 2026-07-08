/**
 * Register the service worker.
 *
 * Lives in /public so it can be loaded as <script src="/register-sw.js">,
 * which keeps our CSP strict (no 'unsafe-inline' for script-src needed).
 *
 * The SW only activates after the page has loaded so it doesn't compete
 * with first-paint critical resources.
 */
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Don't register on localhost dev unless explicitly desired (avoids stale caches
  // surprising you mid-development). Set localStorage 'sw-dev' = '1' to opt in
  // for local SW testing against a production build.
  const isLocalhost =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]';
  var swDev = false;
  try {
    swDev = localStorage.getItem('sw-dev') === '1';
  } catch (e) {
    /* storage unavailable */
  }
  if (isLocalhost && !swDev) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker
      // updateViaCache 'none': always fetch sw.js from the network on update
      // checks, so a new deploy's SW is picked up immediately.
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(function (err) {
        console.warn('Service worker registration failed:', err);
      });
  });
})();
