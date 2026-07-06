/**
 * Target-size PDF compression: "get this PDF under N megabytes."
 *
 * This is the demand-shaped counterpart to compressPdf's preset model. Most
 * people don't want "Balanced" — they want their file under an upload limit
 * (a 2 MB job-application form, a 5 MB email attachment). Here the user names
 * the size and we search for the sharpest output that still fits.
 *
 * Strategy (per the pipeline audit):
 *   1. If the file is already under target, hand it back untouched.
 *   2. Otherwise rasterize each page to a JPEG (the big lever — 75-92% on
 *      mixed docs) and search DPI × JPEG-quality for the best-looking result
 *      that lands under the target.
 *
 * The search is DPI-outer / quality-inner: pdf.js rendering is the expensive,
 * quality-independent cost, so we render a page set ONCE per DPI (via
 * renderPdfToPages) and then re-encode the cached pixels at several qualities
 * (cheap). We prefer sharpness first — the highest DPI at which *some* quality
 * fits — then the highest quality that fits at that DPI.
 *
 * Size is modelled on the pre-qpdf assembled bytes; qpdf runs once, on the
 * chosen result, and can only make it smaller (we keep whichever is smaller).
 */
import { encodeJpeg } from './jpegEncoder';
import {
  renderPdfToPages,
  assembleRasterizedPdf,
  type RenderedPage,
  type EncodedPage,
} from './rasterizePipeline';

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
  strategy: 'already-small' | 'rasterize';
  /** Render DPI of the chosen result (rasterize strategy only). */
  dpiUsed?: number;
  /** JPEG quality of the chosen result (rasterize strategy only). */
  qualityUsed?: number;
  /** Pages rasterized (0 for already-small). */
  pagesRasterized: number;
  /** How many encode/assemble passes the search ran (cost visibility). */
  attempts: number;
  /** Whether qpdf's structural pass ran and helped. */
  qpdfHelped: boolean;
}

// Sharpness rungs, tried high → low. The first DPI at which any quality fits
// under the target wins (we prefer a sharp page at lower JPEG quality over a
// blurry page at high quality).
const DPI_LADDER = [200, 150, 120, 96, 72] as const;

// JPEG-quality rungs, tried high → low within a DPI. Deterministic and bounded
// so the search cost is predictable.
const QUALITY_LADDER = [85, 72, 60, 48, 38, 28] as const;

// Keep the retained RGBA pixel buffers for one DPI pass under ~300 MB. A
// Letter page at 200 DPI is ~11 MB; this caps the starting DPI on long docs
// so a big multi-page file doesn't blow out memory before the search even
// gets a chance to step down.
const PIXEL_BUDGET_BYTES = 300 * 1024 * 1024;

function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** Encode a rendered page set at one quality and assemble the output PDF. */
async function assembleAtQuality(
  pages: RenderedPage[],
  quality: number,
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
  }
  return assembleRasterizedPdf(encoded);
}

/** Estimate the RGBA memory a rendered page set will hold at a given DPI. */
function estimatePixelBytes(pages: RenderedPage[]): number {
  return pages.reduce((sum, p) => sum + p.pxWidth * p.pxHeight * 4, 0);
}

/**
 * Compress `file` to under `targetBytes`, preferring the sharpest output that
 * fits. Never returns a file larger than the input. Throws only if pdf.js
 * cannot decode the input at all (encrypted/corrupt) — callers should surface
 * that as a clear message rather than retrying.
 */
export async function compressPdfToTarget(
  file: File,
  targetBytes: number,
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
      attempts: 0,
      qpdfHelped: false,
    };
  }

  // 2. Rasterize search. Track the best fit (largest quality-under-target) and,
  // separately, the smallest output seen — so a target we can't reach still
  // returns the smallest achievable rather than nothing.
  let attempts = 0;
  let best: { bytes: Uint8Array; dpi: number; quality: number } | null = null;
  let smallest: { bytes: Uint8Array; dpi: number; quality: number } | null = null;
  let pagesRasterized = 0;

  for (const dpi of DPI_LADDER) {
    // renderPdfToPages throws on undecodable input — let it propagate.
    const pages = await renderPdfToPages(file, dpi);
    pagesRasterized = pages.length;

    // Memory guard: if this DPI's pixel buffers are too large, skip to a
    // lower DPI (which produces smaller buffers) rather than risk OOM.
    if (estimatePixelBytes(pages) > PIXEL_BUDGET_BYTES) {
      continue;
    }

    for (const quality of QUALITY_LADDER) {
      const bytes = await assembleAtQuality(pages, quality);
      attempts++;

      if (!smallest || bytes.byteLength < smallest.bytes.byteLength) {
        smallest = { bytes, dpi, quality };
      }
      if (bytes.byteLength <= targetBytes) {
        // Highest quality that fits at this DPI. Because we walk DPI high→low
        // and quality high→low, the first fit is the sharpest overall.
        best = { bytes, dpi, quality };
        break;
      }
    }

    if (best) break;
  }

  // Choose the winner: the best fit if we found one, else the smallest we got.
  const winner = best ?? smallest;
  if (!winner) {
    // No DPI passed the memory guard (pathologically huge input). Fall back to
    // the original bytes so the user never gets nothing.
    return {
      blob: pdfBlob(new Uint8Array(buf)),
      originalSize,
      finalSize: originalSize,
      targetBytes,
      metTarget: false,
      strategy: 'rasterize',
      pagesRasterized,
      attempts,
      qpdfHelped: false,
    };
  }

  // 3. One qpdf structural pass on the winner — it can only make it smaller,
  // which may rescue a near-miss under the target. Modelled as optional; a
  // failure just keeps the pre-qpdf bytes.
  let finalBytes = winner.bytes;
  let qpdfHelped = false;
  try {
    const { runQpdfPass } = await import('./qpdfClient');
    const qpdfBytes = await runQpdfPass(winner.bytes);
    if (qpdfBytes.byteLength < finalBytes.byteLength) {
      finalBytes = qpdfBytes;
      qpdfHelped = true;
    }
  } catch (err) {
    console.warn('[compressPdfToTarget] qpdf pass failed:', err);
  }

  // Never hand back something larger than the original.
  if (finalBytes.byteLength >= originalSize) {
    return {
      blob: pdfBlob(new Uint8Array(buf)),
      originalSize,
      finalSize: originalSize,
      targetBytes,
      metTarget: originalSize <= targetBytes,
      strategy: 'rasterize',
      dpiUsed: winner.dpi,
      qualityUsed: winner.quality,
      pagesRasterized,
      attempts,
      qpdfHelped,
    };
  }

  return {
    blob: pdfBlob(finalBytes),
    originalSize,
    finalSize: finalBytes.byteLength,
    targetBytes,
    metTarget: finalBytes.byteLength <= targetBytes,
    strategy: 'rasterize',
    dpiUsed: winner.dpi,
    qualityUsed: winner.quality,
    pagesRasterized,
    attempts,
    qpdfHelped,
  };
}
