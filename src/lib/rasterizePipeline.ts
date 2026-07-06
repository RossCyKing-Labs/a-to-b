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
 *
 * Structure. The pipeline is split into three reusable pieces so a
 * target-size search can render each page ONCE and then re-encode the
 * JPEGs at different qualities without paying pdf.js's (expensive)
 * render cost again:
 *
 *   renderPdfToPages   — pdf.js render + text extraction → raw pixels
 *   assembleRasterizedPdf — encoded JPEGs + text → a new PDF
 *   rasterizePdf       — convenience wrapper (render → encode → assemble),
 *                        kept streaming (one page's pixels at a time) so
 *                        the Strong preset's memory profile is unchanged.
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

/** A single text run pulled from pdf.js, in unrotated PDF user space. */
export interface TextRun {
  str: string;
  /** pdf.js 6-element transform [a, b, c, d, e, f]. */
  transform: number[];
}

/** A page rendered to raw pixels, plus everything needed to re-encode it. */
export interface RenderedPage {
  /** RGBA pixel buffer, length = pxWidth * pxHeight * 4. */
  pixels: Uint8ClampedArray;
  pxWidth: number;
  pxHeight: number;
  /** Output page size in PDF points (unrotated source dimensions). */
  pointWidth: number;
  pointHeight: number;
  /** Text runs to overlay as an invisible, selectable layer. */
  textRuns: TextRun[];
}

/** An encoded page ready to place into the output PDF. */
export interface EncodedPage {
  jpegBytes: Uint8Array;
  pointWidth: number;
  pointHeight: number;
  textRuns: TextRun[];
}

/**
 * Skip text items whose font size is microscopic — usually they're
 * structural artefacts (table-of-contents dots, decorative spacers) and
 * embedding them adds bytes without helping search.
 */
const MIN_TEXT_FONT_SIZE = 0.5;

/** Pull the selectable text runs out of a pdf.js page (unrotated space). */
async function extractTextRuns(
  srcPage: Awaited<ReturnType<pdfjsLib.PDFDocumentProxy['getPage']>>,
): Promise<TextRun[]> {
  const textContent = await srcPage.getTextContent();
  const runs: TextRun[] = [];
  for (const rawItem of textContent.items) {
    // pdf.js's items union includes TextMarkedContent — we only care
    // about TextItem (has `str`).
    const item = rawItem as { str?: string; transform?: number[] };
    if (!item.str || !item.transform || item.transform.length < 6) continue;
    if (!item.str.trim()) continue;
    runs.push({ str: item.str, transform: item.transform });
  }
  return runs;
}

/**
 * Overlay invisible (opacity-0) selectable text onto an output page.
 *
 * pdf.js gives each run a 6-elem transform [a, b, c, d, e, f] where (e, f)
 * is the baseline origin and (a, b, c, d) is the text matrix; we approximate
 * font size as the magnitude of the vertical axis and skip rotation handling
 * (most selectable text in real PDFs is unrotated). drawText with opacity 0
 * still emits a Tj operator, so the text is selectable/searchable while the
 * JPEG shows through.
 */
function drawInvisibleText(
  outPage: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  runs: TextRun[],
): void {
  for (const run of runs) {
    const [, , c, d, e, f] = run.transform;
    const fontSize = Math.hypot(c, d);
    if (fontSize < MIN_TEXT_FONT_SIZE) continue;
    try {
      outPage.drawText(run.str, {
        x: e,
        y: f,
        size: fontSize,
        font,
        opacity: 0,
        color: rgb(0, 0, 0),
      });
    } catch {
      // Skip characters Helvetica's WinAnsi can't represent; the rest of
      // the page's text layer still works.
    }
  }
}

/** Render a single pdf.js page to a white-backed RGBA buffer. */
function renderPageToPixels(
  srcPage: Awaited<ReturnType<pdfjsLib.PDFDocumentProxy['getPage']>>,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  renderScale: number,
): Promise<{ pixels: Uint8ClampedArray; pxWidth: number; pxHeight: number; pointWidth: number; pointHeight: number }> {
  // Always render unrotated — keeps the text-layer coordinate system simple.
  const baseViewport = srcPage.getViewport({ scale: 1, rotation: 0 });
  const renderViewport = srcPage.getViewport({ scale: renderScale, rotation: 0 });

  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);
  // White background — JPEGs don't have alpha; without this, transparent
  // regions render as black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return srcPage
    .render({ canvasContext: ctx, viewport: renderViewport })
    .promise.then(() => ({
      pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      pxWidth: canvas.width,
      pxHeight: canvas.height,
      pointWidth: baseViewport.width,
      pointHeight: baseViewport.height,
    }));
}

/**
 * Render every page of a PDF to raw pixels + its text layer, ONCE.
 *
 * Returns all pages' pixel buffers in memory so a caller (the target-size
 * search) can re-encode them at different JPEG qualities without re-running
 * pdf.js. Memory ≈ Σ(pxWidth·pxHeight·4); for the typical 1–5 page documents
 * this tool targets that's tens of MB. Callers handling arbitrary input
 * should pick `dpi` with page count in mind.
 */
export async function renderPdfToPages(file: File, dpi: number): Promise<RenderedPage[]> {
  const buf = await file.arrayBuffer();
  const srcPdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const renderScale = dpi / 72;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D rendering context available.');

  const pages: RenderedPage[] = [];
  for (let i = 1; i <= srcPdf.numPages; i++) {
    const srcPage = await srcPdf.getPage(i);
    const rendered = await renderPageToPixels(srcPage, canvas, ctx, renderScale);
    const textRuns = await extractTextRuns(srcPage);
    pages.push({ ...rendered, textRuns });
    srcPage.cleanup();
  }
  return pages;
}

/** Assemble encoded page JPEGs + their text layers into a new PDF. */
export async function assembleRasterizedPdf(pages: EncodedPage[]): Promise<Uint8Array> {
  const outPdf = await PDFDocument.create();
  // One Helvetica embed for the whole document — invisible text doesn't
  // need glyph-accurate metrics for selection to work.
  const font = await outPdf.embedFont(StandardFonts.Helvetica);

  for (const page of pages) {
    const outPage = outPdf.addPage([page.pointWidth, page.pointHeight]);
    const img = await outPdf.embedJpg(page.jpegBytes);
    outPage.drawImage(img, {
      x: 0,
      y: 0,
      width: page.pointWidth,
      height: page.pointHeight,
    });
    drawInvisibleText(outPage, font, page.textRuns);
  }

  return outPdf.save({ useObjectStreams: true });
}

/**
 * Re-render an entire PDF as page-images with an invisible text layer.
 *
 * Streaming: encodes and discards each page's pixels before rendering the
 * next, so peak memory is one page — the Strong preset relies on this.
 * Throws if pdf.js can't decode the input (encrypted, corrupt, etc.).
 */
export async function rasterizePdf(
  file: File,
  options: RasterizeOptions,
): Promise<RasterizeResult> {
  const buf = await file.arrayBuffer();
  const srcPdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const renderScale = options.dpi / 72;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D rendering context available.');

  const encoded: EncodedPage[] = [];
  for (let i = 1; i <= srcPdf.numPages; i++) {
    const srcPage = await srcPdf.getPage(i);
    const rendered = await renderPageToPixels(srcPage, canvas, ctx, renderScale);
    const textRuns = await extractTextRuns(srcPage);
    const jpegBytes = await encodeJpeg(
      rendered.pixels,
      rendered.pxWidth,
      rendered.pxHeight,
      options.jpegQuality,
    );
    encoded.push({
      jpegBytes,
      pointWidth: rendered.pointWidth,
      pointHeight: rendered.pointHeight,
      textRuns,
    });
    srcPage.cleanup();
  }

  const bytes = await assembleRasterizedPdf(encoded);
  return { bytes, pagesRasterized: srcPdf.numPages };
}
