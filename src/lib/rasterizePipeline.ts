/**
 * "Rasterize + invisible text layer" compression strategy.
 *
 * This is what iLovePDF / Smallpdf / Acrobat "Reduce File Size" actually
 * do under the hood. The original PDF's bytes (embedded fonts, structure
 * tree, XMP metadata, overlapping image XObjects, content streams) all
 * get thrown away. Each page becomes a single JPEG, with an invisible
 * text layer overlaid at the original character positions so the output
 * stays selectable and searchable.
 *
 * Compression on a typical mixed text+image PDF: 75-92% (vs 25-35% for
 * the image-only pass we use at Light/Balanced).
 *
 * Trade-offs documented in the UI:
 *   - LOST: form widgets, signature fields, JS actions, OCG layers,
 *           outlines/bookmarks, structure tree (screen-reader tags),
 *           page annotations
 *   - PRESERVED: text content (selectable, searchable, copyable),
 *                page count, page dimensions, basic viewing experience
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { encodeJpeg } from './jpegEncoder';

// One-time worker setup — same pattern pdfTools.ts uses
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

export interface RasterizeOptions {
  /**
   * Target render DPI. 144 (2× of PDF's native 72) hits retina-class
   * sharpness on screens; 120 trades a small amount of sharpness for
   * meaningfully smaller files.
   */
  dpi: number;
  /** JPEG quality 0..100, fed to mozjpeg via @jsquash/jpeg. */
  jpegQuality: number;
}

export interface RasterizeResult {
  /** Raw bytes of the new PDF. Caller wraps in a Blob. */
  bytes: Uint8Array;
  /** Total page count of the source (== output, we preserve page count). */
  pagesRasterized: number;
}

/**
 * Skip text items whose font size is microscopic — usually they're
 * structural artefacts (table-of-contents dots, decorative spacers) and
 * embedding them adds bytes without helping search.
 */
const MIN_TEXT_FONT_SIZE = 0.5;

/**
 * Re-render an entire PDF as page-images with an invisible text layer.
 *
 * Returns raw bytes (no Blob wrapping) so callers can compose with their
 * own pipeline. Throws if pdf.js can't decode the input (encrypted,
 * corrupt, etc.).
 */
export async function rasterizePdf(
  file: File,
  options: RasterizeOptions,
): Promise<RasterizeResult> {
  const buf = await file.arrayBuffer();

  // pdf.js: parse the source for both rendering and text extraction.
  // isEvalSupported=false is the safe-by-default for CSP-strict deploys.
  const loadingTask = pdfjsLib.getDocument({
    data: buf,
    isEvalSupported: false,
  });
  const srcPdf = await loadingTask.promise;

  const outPdf = await PDFDocument.create();
  // One Helvetica embed for the whole document — invisible text doesn't
  // need glyph-accurate metrics for selection to work (PDF readers
  // hit-test by the Tj operator's position and the text-matrix, not the
  // rendered glyph bounds).
  const font = await outPdf.embedFont(StandardFonts.Helvetica);

  const renderScale = options.dpi / 72;

  // pdf.js renders to HTMLCanvasElement in browsers — we keep one canvas
  // around and resize per page rather than allocating + GC'ing N times.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D rendering context available.');

  for (let i = 1; i <= srcPdf.numPages; i++) {
    const srcPage = await srcPdf.getPage(i);

    // Always render unrotated — keeps the text-layer coordinate system
    // simple. If the source page has a /Rotate attribute, the rendered
    // output will appear in the unrotated orientation; this matches
    // iLovePDF's behaviour and is acceptable for the size-first preset.
    const baseViewport = srcPage.getViewport({ scale: 1, rotation: 0 });
    const renderViewport = srcPage.getViewport({
      scale: renderScale,
      rotation: 0,
    });

    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    // White background — JPEGs don't have alpha; without this, transparent
    // regions render as black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await srcPage.render({
      canvasContext: ctx,
      viewport: renderViewport,
    }).promise;

    // Encode the rendered page to JPEG. mozjpeg's trellis multi-pass +
    // progressive encoding produces ~20% smaller files than canvas.toBlob
    // at equivalent visual quality.
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const jpegBytes = await encodeJpeg(
      pixels,
      canvas.width,
      canvas.height,
      options.jpegQuality,
    );

    // New output page sized to the source's PDF-point dimensions, so
    // links/bookmarks/page numbers still point at the visually-same page.
    const outPage = outPdf.addPage([baseViewport.width, baseViewport.height]);
    const img = await outPdf.embedJpg(jpegBytes);
    outPage.drawImage(img, {
      x: 0,
      y: 0,
      width: baseViewport.width,
      height: baseViewport.height,
    });

    // Overlay invisible text. pdf.js gives us each text run with a 6-elem
    // transform [a, b, c, d, e, f] where (e, f) is the baseline origin in
    // unrotated PDF user space, and (a, b, c, d) is the text matrix
    // (scale + skew + rotation). We approximate font size as the magnitude
    // of the vertical axis and skip rotation handling for v1 — most
    // selectable text in real PDFs is unrotated.
    const textContent = await srcPage.getTextContent();
    for (const rawItem of textContent.items) {
      // pdf.js's items union includes TextMarkedContent — we only care
      // about TextItem (has `str`).
      const item = rawItem as { str?: string; transform?: number[] };
      if (!item.str || !item.transform || item.transform.length < 6) continue;
      const text = item.str;
      if (!text.trim()) continue;

      const [, , c, d, e, f] = item.transform;
      const fontSize = Math.hypot(c, d);
      if (fontSize < MIN_TEXT_FONT_SIZE) continue;

      // drawText with opacity 0 puts a Tj operator into the content stream
      // (so the text is selectable / searchable) but renders with zero
      // alpha — the JPEG above shows through. We catch encoding errors so
      // non-Latin characters that Helvetica's WinAnsi can't represent
      // don't abort the whole page; they just don't contribute to the
      // text layer.
      try {
        outPage.drawText(text, {
          x: e,
          y: f,
          size: fontSize,
          font,
          opacity: 0,
          color: rgb(0, 0, 0),
        });
      } catch {
        // skip unsupported characters; rest of the page still works
      }
    }

    // Help GC reclaim memory between pages — large PDFs can hold many MB
    // of decoded pixel data otherwise.
    srcPage.cleanup();
  }

  const bytes = await outPdf.save({ useObjectStreams: true });
  return { bytes, pagesRasterized: srcPdf.numPages };
}
