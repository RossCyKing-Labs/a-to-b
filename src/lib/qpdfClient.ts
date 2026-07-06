/**
 * Main-thread client for the qpdf compress worker.
 *
 * We keep one worker instance for the page lifetime — qpdf-wasm takes
 * 100-200ms to load and we don't want to repay that cost on every file.
 * The worker is lazily created the first time a compression is requested
 * and reused for every subsequent file.
 *
 * The actual heavy lifting (DEFLATE/object-stream rewriting, possibly
 * non-JPEG image recompression) happens inside the worker; the main
 * thread just shuttles bytes in and out.
 */

let workerPromise: Promise<Worker> | null = null;
let nextId = 0;

async function getWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    // Vite's `?worker` import returns a Worker constructor that wires up
    // the bundled worker script. The `& { default: ... }` shape is what
    // the plugin produces at runtime.
    const mod = (await import('./compressWorker?worker')) as {
      default: new () => Worker;
    };
    return new mod.default();
  })();
  return workerPromise;
}

/**
 * Run qpdf's structural compression pass on an already-prepared PDF.
 *
 * Flags applied:
 *  --object-streams=generate     pack indirect objects into compressed
 *                                streams (smaller xref + smaller bodies)
 *  --compress-streams=y          ensure all flate-compressible streams are
 *                                compressed
 *  --recompress-flate            redeflate every flate stream
 *  --compression-level=9         max zlib level
 *  --optimize-images             convert non-JPEG images to JPEG when
 *                                doing so makes them smaller
 *  --oi-min-width=300
 *  --oi-min-height=300           skip tiny icons (≤300px) — re-encoding
 *                                them rarely saves bytes and adds noise
 *  --normalize-content=n         leave content streams alone (we already
 *                                touched the images we cared about)
 *  --linearize                   web-optimised output (also enables
 *                                additional structural cleanup)
 *
 * Returns the compressed bytes, OR throws if qpdf fails to run.
 */
/**
 * Hard timeout for a single qpdf invocation. Real qpdf calls finish in
 * 100-2000ms on typical PDFs. If something has gone wrong (wasm fetch
 * stuck, loadModule infinite loop, etc.), we'd rather abandon the
 * structural pass than wedge the entire compression — the upstream
 * caller falls back to the pdf-lib-only output which is already
 * meaningfully smaller than the input.
 */
const QPDF_TIMEOUT_MS = 30_000;

export async function runQpdfPass(input: Uint8Array): Promise<Uint8Array> {
  const worker = await getWorker();
  const id = `qpdf-${++nextId}`;

  // Copy out of any view into a fresh buffer so we can transfer ownership
  const bytes = input.slice().buffer;

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      worker.removeEventListener('message', handler);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const handler = (
      event: MessageEvent<
        | { id: string; ok: true; bytes: ArrayBuffer }
        | { id: string; ok: false; error: string }
      >,
    ) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok) {
        resolve(new Uint8Array(event.data.bytes));
      } else {
        reject(new Error(event.data.error));
      }
    };

    worker.addEventListener('message', handler);

    timer = setTimeout(() => {
      cleanup();
      // Re-create the worker on timeout so subsequent compressions can
      // start fresh rather than inheriting whatever wedged state caused
      // the timeout in the first place.
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      workerPromise = null;
      reject(new Error(`qpdf timed out after ${QPDF_TIMEOUT_MS / 1000}s`));
    }, QPDF_TIMEOUT_MS);

    worker.postMessage(
      {
        id,
        type: 'qpdf',
        bytes,
        flags: [
          // Pack indirect objects into compressed object streams; also
          // packs the cross-reference table.
          '--object-streams=generate',
          // Re-deflate every flate-compressible stream at max level
          // (zopfli-class savings on text streams).
          '--compress-streams=y',
          '--recompress-flate',
          '--compression-level=9',
          // Recompress raster images to JPEG when that's smaller, skipping
          // tiny icons. Note: --optimize-images touches ALL raster images,
          // including existing DCTDecode JPEGs — not just FlateDecode ones.
          // We already recompressed the JPEGs we cared about (in the pdf-lib
          // / rasterize pass) at our chosen quality, so we pin
          // --oi-jpeg-quality high (90). qpdf keeps its version only when
          // smaller, and re-encoding our lower-quality JPEGs at q90 comes
          // out larger — so our JPEGs are preserved, while genuine wins
          // (FlateDecode PNG-style images → JPEG) still land.
          '--optimize-images',
          '--oi-jpeg-quality=90',
          '--oi-min-width=300',
          '--oi-min-height=300',
          // Prune fonts, colorspaces, patterns, etc. that aren't actually
          // referenced from any page. qpdf's default is `auto` (only
          // when safe); `yes` is more aggressive.
          '--remove-unreferenced-resources=yes',
          // Note: not passing --linearize. Linearization adds a hint
          // table at the front of the PDF that's worth it on >2 MB
          // documents (fast web view) but inflates small files by
          // 5-15 KB. For our typical compress targets that's a net loss.
        ],
      },
      [bytes],
    );
  });
}
