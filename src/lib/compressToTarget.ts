/**
 * Target-size PDF compression: "get this PDF under N megabytes."
 *
 * This is the demand-shaped counterpart to compressPdf's preset model. Most
 * people don't want "Balanced" — they want their file under an upload limit
 * (a 2 MB job-application form, a 5 MB email attachment). Here the user names
 * the size and we search for the sharpest output that still fits.
 *
 * Strategy — quality first, size guaranteed:
 *   1. If the file is already under target, hand it back untouched.
 *   2. Try the NON-flattening path first (image recompression): text and
 *      vectors stay as sharp vector data — only embedded images are
 *      recompressed. This is what iLovePDF's default does and why its text
 *      looks crisp. If a non-flatten pass already fits the target, we're done
 *      and the result is sharp.
 *   3. Only if that can't reach the target do we flatten: rasterize each page
 *      to a JPEG (the big lever — 75-92% on mixed docs) and search DPI ×
 *      quality for the sharpest raster that fits. Flattening softens text, so
 *      it's the fallback, not the default.
 *
 * The rasterize search is DPI-outer / quality-inner: pdf.js rendering is the
 * expensive, quality-independent cost, so we render a page set ONCE per DPI
 * (renderPdfToPages) and re-encode the cached pixels at several qualities
 * (cheap). Size is modelled on pre-qpdf bytes; qpdf runs once on the winner.
 */
import { compressPdf } from './pdfTools';
import { encodeJpeg } from './jpegEncoder';
import type { OnCompressProgress } from './compressProgress';
import {
  renderPdfToPages,
  assembleRasterizedPdf,
  type RenderedPage,
  type EncodedPage,
} from './rasterizePipeline';

export type TargetStrategy = 'already-small' | 'image-recompress' | 'rasterize';

export interface TargetCompressResult {
  blob: Blob;
  /** Original input size in bytes. */
  originalSize: number;
  /** Size of the output we're handing back. */
  finalSize: number;
  /** The size the user asked to get under, in bytes. */
  targetBytes: number;
  /** True when finalSize <= targetBytes. */
  metTarget: boolean;
  strategy: TargetStrategy;
  /** Render DPI of the chosen result (rasterize strategy only). */
  dpiUsed?: number;
  /** JPEG quality of the chosen result (rasterize strategy only). */
  qualityUsed?: number;
  /** Pages rasterized (0 for already-small / image-recompress). */
  pagesRasterized: number;
  /** Images recompressed (image-recompress strategy only). */
  imagesRecompressed: number;
  /** How many encode/compress passes the search ran (cost visibility). */
  attempts: number;
  /** Whether qpdf's structural pass ran and helped on the chosen result. */
  qpdfHelped: boolean;
}

// Sharpness rungs, tried high → low. The first DPI at which any quality fits
// under the target wins (we prefer a sharp page at lower JPEG quality over a
// blurry page at high quality).
const DPI_LADDER = [200, 150, 120, 96, 72] as const;

// JPEG-quality rungs, tried high → low within a DPI. Deterministic and bounded
// so the search cost is predictable.
const QUALITY_LADDER = [85, 72, 60, 48, 38, 28] as const;

// Non-flattening presets to try first, least → most aggressive. These keep
// text/vectors sharp and only recompress embedded images.
const NON_FLATTEN_LEVELS = ['low', 'medium'] as const;

// Keep the retained RGBA pixel buffers for one DPI pass under ~300 MB.
const PIXEL_BUDGET_BYTES = 300 * 1024 * 1024;

function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** A compression outcome under consideration during the search. */
interface Candidate {
  blob: Blob;
  size: number;
  strategy: 'image-recompress' | 'rasterize';
  /** Raw bytes for rasterize candidates, so a qpdf pass can run on the winner. */
  bytes?: Uint8Array;
  dpi?: number;
  quality?: number;
  pagesRasterized: number;
  imagesRecompressed: number;
  qpdfHelped: boolean;
}

/**
 * Encode a rendered page set at one quality and assemble the output PDF.
 * `onPageEncoded` fires after each page's JPEG encode (1-based `done`), so
 * callers can surface progress through this otherwise-silent stretch.
 */
async function assembleAtQuality(
  pages: RenderedPage[],
  quality: number,
  onPageEncoded?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const encoded: EncodedPage[] = [];
  for (const p of pages) {
    const jpegBytes = await encodeJpeg(p.pixels, p.pxWidth, p.pxHeight, quality);
    encoded.push({
      jpegBytes,
      pointWidth: p.pointWidth,
      pointHeight: p.pointHeight,
      textRuns: p.textRuns,
    });
    onPageEncoded?.(encoded.length, pages.length);
  }
  return assembleRasterizedPdf(encoded);
}

/** Estimate the RGBA memory a rendered page set will hold at a given DPI. */
function estimatePixelBytes(pages: RenderedPage[]): number {
  return pages.reduce((sum, p) => sum + p.pxWidth * p.pxHeight * 4, 0);
}

/** Run one qpdf structural pass; returns the smaller of input/output. */
async function applyQpdf(bytes: Uint8Array): Promise<{ bytes: Uint8Array; helped: boolean }> {
  try {
    const { runQpdfPass } = await import('./qpdfClient');
    const out = await runQpdfPass(bytes);
    if (out.byteLength < bytes.byteLength) return { bytes: out, helped: true };
  } catch (err) {
    console.warn('[compressPdfToTarget] qpdf pass failed:', err);
  }
  return { bytes, helped: false };
}

function toResult(
  c: Candidate,
  originalSize: number,
  targetBytes: number,
  attempts: number,
): TargetCompressResult {
  return {
    blob: c.blob,
    originalSize,
    finalSize: c.size,
    targetBytes,
    metTarget: c.size <= targetBytes,
    strategy: c.strategy,
    dpiUsed: c.dpi,
    qualityUsed: c.quality,
    pagesRasterized: c.pagesRasterized,
    imagesRecompressed: c.imagesRecompressed,
    attempts,
    qpdfHelped: c.qpdfHelped,
  };
}

/**
 * Compress `file` to under `targetBytes`, preferring the sharpest output that
 * fits (non-flattening first, flattening only as a fallback). Never returns a
 * file larger than the input. Throws only if pdf.js cannot decode the input at
 * all (encrypted/corrupt) — callers should surface that as a clear message.
 */
export async function compressPdfToTarget(
  file: File,
  targetBytes: number,
  onProgress?: OnCompressProgress,
): Promise<TargetCompressResult> {
  const buf = await file.arrayBuffer();
  const originalSize = buf.byteLength;

  // 1. Already small enough — nothing to do, best possible quality.
  if (originalSize <= targetBytes) {
    return {
      blob: pdfBlob(new Uint8Array(buf)),
      originalSize,
      finalSize: originalSize,
      targetBytes,
      metTarget: true,
      strategy: 'already-small',
      pagesRasterized: 0,
      imagesRecompressed: 0,
      attempts: 0,
      qpdfHelped: false,
    };
  }

  onProgress?.({ message: 'Reading document…', stage: 'read' });

  let attempts = 0;
  let smallest: Candidate | null = null;
  const consider = (c: Candidate) => {
    if (!smallest || c.size < smallest.size) smallest = c;
  };

  // 2. Non-flatten first — keep text/vectors sharp, only recompress images.
  for (const level of NON_FLATTEN_LEVELS) {
    onProgress?.({
      message: 'Recompressing images (keeping text sharp)…',
      stage: 'recompress',
    });
    const r = await compressPdf(file, level);
    attempts++;
    const cand: Candidate = {
      blob: r.blob,
      size: r.blob.size,
      strategy: 'image-recompress',
      pagesRasterized: 0,
      imagesRecompressed: r.imagesRecompressed,
      qpdfHelped: r.qpdfPassRan && r.qpdfHelped,
    };
    consider(cand);
    onProgress?.({
      message: 'Checking size…',
      stage: 'recompress',
      attempt: {
        label: level === 'low' ? 'Light' : 'Balanced',
        bytes: cand.size,
        over: cand.size > targetBytes,
      },
    });
    // A non-flatten pass that fits is the best outcome: sharp text AND under
    // target. Take it immediately (least aggressive that fits wins).
    if (r.smallerThanOriginal && cand.size <= targetBytes) {
      return toResult(cand, originalSize, targetBytes, attempts);
    }
  }

  // 3. Flatten fallback — rasterize + DPI/quality search.
  let pagesRasterized = 0;
  for (const dpi of DPI_LADDER) {
    // renderPdfToPages throws on undecodable input — let it propagate.
    const pages = await renderPdfToPages(file, dpi, onProgress);
    pagesRasterized = pages.length;
    if (estimatePixelBytes(pages) > PIXEL_BUDGET_BYTES) continue;

    onProgress?.({ message: 'Choosing the sharpest quality that fits…', stage: 'encode' });
    let fit: Candidate | null = null;
    for (const quality of QUALITY_LADDER) {
      const bytes = await assembleAtQuality(pages, quality, (done, total) => {
        onProgress?.({
          message: `Encoding page ${done} of ${total} · quality ${quality}`,
          stage: 'encode',
          fraction: done / total,
        });
      });
      attempts++;
      const cand: Candidate = {
        blob: pdfBlob(bytes),
        size: bytes.byteLength,
        strategy: 'rasterize',
        bytes,
        dpi,
        quality,
        pagesRasterized: pages.length,
        imagesRecompressed: 0,
        qpdfHelped: false,
      };
      consider(cand);
      onProgress?.({
        message: 'Checking size…',
        stage: 'encode',
        attempt: {
          label: `${dpi} dpi · q${quality}`,
          bytes: bytes.byteLength,
          over: bytes.byteLength > targetBytes,
        },
      });
      if (bytes.byteLength <= targetBytes) {
        fit = cand;
        break;
      }
    }

    if (fit) {
      onProgress?.({ message: 'Finishing (structural pass)…', stage: 'finalize' });
      // qpdf once on the winner — can only shrink it further.
      const { bytes, helped } = await applyQpdf(fit.bytes!);
      const finalBytes = bytes.byteLength >= originalSize ? new Uint8Array(buf) : bytes;
      return toResult(
        {
          ...fit,
          blob: pdfBlob(finalBytes),
          size: finalBytes.byteLength,
          qpdfHelped: helped,
        },
        originalSize,
        targetBytes,
        attempts,
      );
    }
  }

  // 4. Couldn't reach the target. Return the smallest we found — but give a
  // rasterize candidate a final qpdf pass first, in case it just squeaks under.
  const best = smallest as Candidate | null;
  if (!best) {
    return {
      blob: pdfBlob(new Uint8Array(buf)),
      originalSize,
      finalSize: originalSize,
      targetBytes,
      metTarget: false,
      strategy: 'rasterize',
      pagesRasterized,
      imagesRecompressed: 0,
      attempts,
      qpdfHelped: false,
    };
  }

  if (best.strategy === 'rasterize' && best.bytes) {
    onProgress?.({ message: 'Finishing (structural pass)…', stage: 'finalize' });
    const { bytes, helped } = await applyQpdf(best.bytes);
    const finalBytes = bytes.byteLength >= originalSize ? new Uint8Array(buf) : bytes;
    return toResult(
      { ...best, blob: pdfBlob(finalBytes), size: finalBytes.byteLength, qpdfHelped: helped },
      originalSize,
      targetBytes,
      attempts,
    );
  }

  return toResult(best, originalSize, targetBytes, attempts);
}

