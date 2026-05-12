/// <reference lib="webworker" />

/**
 * Web Worker that hosts the qpdf-wasm module and runs the structural
 * compression pass.
 *
 * qpdf is a long-running CPU task (200ms to a few seconds for typical
 * PDFs). Running it in a worker keeps the UI thread responsive — drop
 * zone interaction, file selection, and download buttons stay snappy
 * while the actual byte-shuffling happens off-thread.
 *
 * Protocol: the main thread posts a request, the worker posts back a
 * single response with the same id.
 *
 *     ─► { id, type: 'qpdf', bytes: ArrayBuffer, flags: string[] }
 *     ◄─ { id, ok: true, bytes: ArrayBuffer } or { ok: false, error }
 */

declare const self: DedicatedWorkerGlobalScope;

// Import the qpdf.wasm binary as an asset URL so Vite copies the file
// into the build output AND gives us a stable, fingerprinted URL we can
// hand to Emscripten via `locateFile`. Without this the Emscripten JS
// shim resolves the wasm path at runtime relative to the worker script,
// hits a 404, and silently hangs.
import qpdfWasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';

interface QpdfRequest {
  id: string;
  type: 'qpdf';
  bytes: ArrayBuffer;
  flags: string[];
}

interface QpdfResponseOk {
  id: string;
  ok: true;
  bytes: ArrayBuffer;
}

interface QpdfResponseErr {
  id: string;
  ok: false;
  error: string;
}

// Module instance, lazily loaded on first request.
let qpdfPromise: Promise<QpdfModuleLike> | null = null;

interface QpdfModuleLike {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  callMain(args: string[]): number;
}

async function loadQpdf(): Promise<QpdfModuleLike> {
  if (qpdfPromise) return qpdfPromise;
  qpdfPromise = (async () => {
    // @neslinesli93/qpdf-wasm exports a default factory function that
    // returns a promise resolving to an Emscripten Module-like object.
    // The package ships TS types that don't expose every method on
    // Module.FS even though they exist at runtime (writeFile, unlink),
    // so we cast through unknown to access them.
    const importedModule = await import('@neslinesli93/qpdf-wasm');
    const factory = (
      importedModule as {
        default?: (opts?: Record<string, unknown>) => Promise<unknown>;
      }
    ).default;
    if (typeof factory !== 'function') {
      throw new Error('qpdf-wasm module does not export a default factory');
    }
    const instance = await factory({
      // Tell Emscripten where to fetch qpdf.wasm. Without this it tries
      // to resolve a relative path against the worker script, which
      // doesn't match the bundler's fingerprinted asset URL.
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) return qpdfWasmUrl;
        return path;
      },
      // Suppress Emscripten's default console noise unless something
      // breaks — then we want full visibility.
      print: () => {
        /* swallow stdout */
      },
      printErr: (message: string) => {
        console.error('[qpdf]', message);
      },
    });
    return instance as unknown as QpdfModuleLike;
  })();
  return qpdfPromise;
}

self.addEventListener('message', async (event: MessageEvent<QpdfRequest>) => {
  const { id, type, bytes, flags } = event.data;
  if (type !== 'qpdf') return;

  try {
    const qpdf = await loadQpdf();
    const inputPath = `in-${id}.pdf`;
    const outputPath = `out-${id}.pdf`;

    qpdf.FS.writeFile(inputPath, new Uint8Array(bytes));

    // callMain may throw on non-zero exit (Emscripten convention)
    qpdf.callMain([...flags, inputPath, outputPath]);

    const output = qpdf.FS.readFile(outputPath);
    // Copy into a fresh ArrayBuffer we can transfer ownership of.
    const transferable = new Uint8Array(output).buffer;

    // Clean up MEMFS so we don't leak across calls
    try {
      qpdf.FS.unlink(inputPath);
    } catch {
      /* ignore */
    }
    try {
      qpdf.FS.unlink(outputPath);
    } catch {
      /* ignore */
    }

    const response: QpdfResponseOk = { id, ok: true, bytes: transferable };
    self.postMessage(response, [transferable]);
  } catch (err) {
    const response: QpdfResponseErr = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
});

export {};
