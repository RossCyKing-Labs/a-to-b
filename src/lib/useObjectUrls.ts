import { useCallback, useEffect, useRef } from 'react';

/**
 * Owns the lifecycle of `URL.createObjectURL` blob URLs for a component.
 *
 * Every converter needs the same thing: create object URLs for downloadable
 * outputs, revoke them when they're replaced or cleared, and — critically —
 * revoke whatever is still live when the component unmounts so we don't leak
 * blobs. Hand-rolling that with a `useRef<Set>` + `useEffect` cleanup + manual
 * `URL.revokeObjectURL` calls was copy-pasted (and subtly diverged) across
 * every tool. This hook is the single seam for it.
 *
 *   const urls = useObjectUrls();
 *   const href = urls.track(blob);   // create + remember
 *   urls.revoke(href);               // revoke one (e.g. replacing a result)
 *   urls.revokeAll();                // revoke everything (e.g. "Clear all")
 *
 * All tracked URLs are revoked automatically on unmount.
 */
export function useObjectUrls() {
  const urls = useRef<Set<string>>(new Set());

  useEffect(() => {
    const set = urls.current;
    return () => {
      set.forEach((url) => URL.revokeObjectURL(url));
      set.clear();
    };
  }, []);

  const track = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    return url;
  }, []);

  const revoke = useCallback((url: string) => {
    if (urls.current.delete(url)) {
      URL.revokeObjectURL(url);
    }
  }, []);

  const revokeAll = useCallback(() => {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
  }, []);

  return { track, revoke, revokeAll };
}
