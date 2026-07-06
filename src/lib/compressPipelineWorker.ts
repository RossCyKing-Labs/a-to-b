/// <reference lib="webworker" />

/**
 * Web Worker that runs the whole PDF-compression pipeline off the UI thread.
 *
 * pdf.js rendering and mozjpeg encoding are synchronous, CPU-heavy work; run
 * on the main thread they freeze the tab (worst on the target-size search,
 * which encodes many times). Here the engine runs in a worker using
 * OffscreenCanvas for rendering, so the page stays responsive.
 *
 * The engine code (compressToTarget / pdfTools) is environment-agnostic: it
 * prefers OffscreenCanvas and never touches `window`/`document` when they're
 * absent, so the exact same functions run here and on the main thread (the
 * latter as a fallback — see compressClient.ts).
 *
 * Protocol: one request in, one response (matched by id) out. PDF bytes are
 * transferred in; the result carries a Blob (structured-cloneable).
 */
import { compressPdfToTarget } from './compressToTarget';
import { compressPdf, type CompressLevel } from './pdfTools';

declare const self: DedicatedWorkerGlobalScope;

type CompressRequest =
  | { id: string; kind: 'target'; bytes: ArrayBuffer; fileName: string; targetBytes: number }
  | { id: string; kind: 'level'; bytes: ArrayBuffer; fileName: string; level: CompressLevel };

self.addEventListener('message', async (event: MessageEvent<CompressRequest>) => {
  const data = event.data;
  // Forward engine progress to the main thread as it happens.
  const onProgress = (progress: { message: string; fraction?: number }) =>
    self.postMessage({ id: data.id, progress });
  try {
    const file = new File([data.bytes], data.fileName, { type: 'application/pdf' });
    if (data.kind === 'target') {
      const result = await compressPdfToTarget(file, data.targetBytes, onProgress);
      self.postMessage({ id: data.id, ok: true, result });
    } else {
      const result = await compressPdf(file, data.level, onProgress);
      self.postMessage({ id: data.id, ok: true, result });
    }
  } catch (err) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export {};
