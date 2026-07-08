/**
 * Recovery for deploy-skew chunk failures.
 *
 * Every deploy replaces all fingerprinted /_astro/* files, so a page loaded
 * before the deploy can fail to dynamically import chunks that no longer
 * exist ("Failed to fetch dynamically imported module"). The fix for an
 * affected page is simply reloading — the fresh HTML references the current
 * chunk set — so we reload once, guarded so a genuinely broken server can't
 * cause a reload loop.
 *
 * The same guard key is shared with BaseLayout's inline `vite:preloadError`
 * handler so the two recovery paths can't double-reload.
 */

const GUARD_KEY = 'ab:chunk-reload';
/** Reloads within this window are considered "already tried" — show an error instead. */
const GUARD_WINDOW_MS = 60_000;

/** True when the error looks like a failed dynamic chunk import (any browser's phrasing). */
export function isChunkLoadError(e: unknown): boolean {
  const message =
    e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /dynamically imported module|Importing a module script|error loading dynamically|Failed to fetch/i.test(
    message,
  );
}

/**
 * Reload the page once to pick up the current deploy's chunks. Returns true
 * when a reload was initiated (callers should stop and let it happen); false
 * when a recent reload already happened — surface a "refresh to update"
 * message instead.
 *
 * A timestamp (not a boolean) so the guard re-arms after GUARD_WINDOW_MS —
 * a later deploy in the same browser session can still recover.
 */
export function reloadOnceForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(GUARD_KEY) ?? 0);
    if (Date.now() - last < GUARD_WINDOW_MS) return false;
    sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    // Storage unavailable: reload anyway (worst case the user sees the
    // error panel after a second failure without the guard).
  }
  window.location.reload();
  return true;
}
