/**
 * Main-thread client for the compression pipeline worker.
 *
 * Routes compression through a Web Worker (compressPipelineWorker) so the UI
 * thread stays responsive, and transparently falls back to running the same
 * engine on the main thread if the worker path is unavailable or fails. The
 * fallback means no regression: worst case is exactly the old behaviour.
 *
 * A single worker is reused for the page lifetime. Requests are matched by id,
 * so overlapping compressions (a batch of files) are safe.
 */
import { compressPdfToTarget, type TargetCompressResult } from './compressToTarget';
import { compressPdf, type CompressLevel, type CompressResult } from './pdfTools';
import type { CompressProgress, OnCompressProgress } from './compressProgress';

let workerPromise: Promise<Worker> | null = null;
let nextId = 0;
// Once the worker path has failed, stop trying it for the rest of the session.
let workerDisabled = false;

/**
 * The worker renders with OffscreenCanvas, so it's only usable where both
 * Worker and OffscreenCanvas exist. Elsewhere we run on the main thread.
 */
function workerSupported(): boolean {
  return (
    !workerDisabled &&
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = (await import('./compressPipelineWorker?worker')) as {
        default: new () => Worker;
      };
      return new mod.default();
    })();
  }
  return workerPromise;
}

interface WorkerRequest {
  kind: 'target' | 'level';
  bytes: ArrayBuffer;
  fileName: string;
  targetBytes?: number;
  level?: CompressLevel;
}

function runInWorker<T>(request: WorkerRequest, onProgress?: OnCompressProgress): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    getWorker().then(
      (worker) => {
        const id = `compress-${++nextId}`;
        const cleanup = () => {
          worker.removeEventListener('message', handler);
          worker.removeEventListener('error', onError);
        };
        const handler = (
          event: MessageEvent<
            | { id: string; progress: CompressProgress }
            | { id: string; ok: true; result: T }
            | { id: string; ok: false; error: string }
          >,
        ) => {
          const msg = event.data;
          if (msg.id !== id) return;
          if ('progress' in msg) {
            onProgress?.(msg.progress);
            return; // more messages to come
          }
          cleanup();
          if (msg.ok) resolve(msg.result);
          else reject(new Error(msg.error));
        };
        // A worker whose script fails to load (e.g. its chunk was replaced by
        // a new deploy) fires 'error' and never posts a message — without
        // this listener the request would hang in "processing" forever.
        const onError = (event: ErrorEvent) => {
          cleanup();
          workerPromise = null; // dead worker — let a later call recreate it
          reject(new Error(event.message || 'Compression worker failed to start.'));
        };
        worker.addEventListener('message', handler);
        worker.addEventListener('error', onError);
        worker.postMessage({ id, ...request }, [request.bytes]);
      },
      (err) => {
        workerPromise = null; // the module import itself failed — don't cache it
        reject(err);
      },
    );
  });
}

/** Compress to a target size — in the worker when possible, else main thread. */
export async function compressToTargetSmart(
  file: File,
  targetBytes: number,
  onProgress?: OnCompressProgress,
): Promise<TargetCompressResult> {
  if (workerSupported()) {
    try {
      const bytes = await file.arrayBuffer();
      return await runInWorker<TargetCompressResult>(
        { kind: 'target', bytes, fileName: file.name, targetBytes },
        onProgress,
      );
    } catch (err) {
      console.warn('[compressClient] worker failed; running on main thread:', err);
      workerDisabled = true;
    }
  }
  return compressPdfToTarget(file, targetBytes, onProgress);
}

/** Compress by preset level — in the worker when possible, else main thread. */
export async function compressByLevelSmart(
  file: File,
  level: CompressLevel,
  onProgress?: OnCompressProgress,
): Promise<CompressResult> {
  if (workerSupported()) {
    try {
      const bytes = await file.arrayBuffer();
      return await runInWorker<CompressResult>(
        { kind: 'level', bytes, fileName: file.name, level },
        onProgress,
      );
    } catch (err) {
      console.warn('[compressClient] worker failed; running on main thread:', err);
      workerDisabled = true;
    }
  }
  return compressPdf(file, level, onProgress);
}
