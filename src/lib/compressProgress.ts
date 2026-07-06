/**
 * Progress reporting for the compression pipeline.
 *
 * Kept in its own module (just types) so both the low-level engine
 * (pdfTools, rasterizePipeline) and the high-level orchestrators
 * (compressToTarget, the worker, the client) can share it without import
 * cycles.
 */

export interface CompressProgress {
  /** Human-readable status to show in the UI (e.g. "Rendering page 2 of 5…"). */
  message: string;
  /** Optional 0..1 completion hint, when a phase can estimate one. */
  fraction?: number;
}

export type OnCompressProgress = (progress: CompressProgress) => void;
