/**
 * Progress reporting for the compression pipeline.
 *
 * Kept in its own module (just types) so both the low-level engine
 * (pdfTools, rasterizePipeline) and the high-level orchestrators
 * (compressToTarget, the worker, the client) can share it without import
 * cycles.
 *
 * Everything here is REAL data from the engine — the UI renders it as a
 * live instrument readout, so emissions must never be simulated.
 */

/** Macro phase of the pipeline; drives the UI's stage pips. */
export type CompressStage = 'read' | 'recompress' | 'render' | 'encode' | 'finalize';

/** One completed size attempt during the target-size search. */
export interface CompressAttempt {
  /** Short human label for the attempt, e.g. "Balanced" or "144 dpi · q72". */
  label: string;
  /** Real output size of this attempt in bytes. */
  bytes: number;
  /** True when this attempt was still over the requested target. */
  over: boolean;
}

export interface CompressProgress {
  /** Human-readable status to show in the UI (e.g. "Rendering page 2 of 5…"). */
  message: string;
  /** Optional 0..1 completion hint for the CURRENT sub-task (e.g. pages done / total). */
  fraction?: number;
  /** Optional macro stage tag. */
  stage?: CompressStage;
  /** Optional completed attempt result (target-size search only). */
  attempt?: CompressAttempt;
}

export type OnCompressProgress = (progress: CompressProgress) => void;
