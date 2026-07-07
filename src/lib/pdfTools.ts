/**
 * Shared PDF tooling for Phase 5.
 *
 * All operations are 100% in-browser. Inputs are File objects (from the
 * drop zone), outputs are Blobs ready to download. No uploads anywhere.
 *
 *  - mergePdfs           N PDFs → 1 PDF
 *  - splitPdfPerPage     1 PDF → N single-page PDFs
 *  - rotatePdf           1 PDF → 1 rotated PDF
 *  - imagesToPdf         N JPG/PNG → 1 PDF
 *  - pdfToJpgs           1 PDF → N JPGs (one per page)
 *  - compressPdf         1 PDF → 1 compressed PDF (render-and-recombine)
 *
 * Library choices:
 *  - pdf-lib (Apache-2): reading + writing PDF structure, page operations,
 *    image embedding. Pure JS, no WASM.
 *  - pdfjs-dist (Apache-2): rendering pages to canvas (needed for PDF→JPG
 *    and compression). Already in the bundle from Phase 3.
 */
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { OnCompressProgress } from './compressProgress';

// One-time pdf.js worker setup. Unconditional (not window-guarded): this
// module also runs INSIDE the compress Web Worker, where `window` is
// undefined but pdf.js still requires workerSrc.
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

/** Detect PDF by magic bytes: "%PDF-" at the start of the file. */
export async function isPdf(file: File): Promise<boolean> {
  if (file.size < 5) return false;
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return (
    head[0] === 0x25 && // %
    head[1] === 0x50 && // P
    head[2] === 0x44 && // D
    head[3] === 0x46 && // F
    head[4] === 0x2d //   -
  );
}

/** Detect JPEG or PNG by magic bytes. Both are valid inputs to imagesToPdf. */
export async function isJpegOrPng(file: File): Promise<'jpeg' | 'png' | null> {
  if (file.size < 8) return null;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  )
    return 'png';
  return null;
}

const PDF_MIME = 'application/pdf';

/**
 * Wrap pdf-lib's output bytes in a Blob.
 *
 * TS 5.7+ made Uint8Array generic over the buffer type. pdf-lib's save()
 * returns Uint8Array<ArrayBufferLike>, but the Blob constructor only accepts
 * BlobPart (which requires Uint8Array<ArrayBuffer>, i.e. not SharedArrayBuffer).
 * pdf-lib never produces a SharedArrayBuffer in practice, so this cast is
 * safe — it's just appeasing the stricter type system.
 */
function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: PDF_MIME });
}

// ────────────────────────────────────────────────────────────────────────────
// Merge: N PDFs → 1 PDF
// ────────────────────────────────────────────────────────────────────────────

export async function mergePdfs(files: File[]): Promise<Blob> {
  const merged = await PDFDocument.create();
  for (const file of files) {
    const buf = await file.arrayBuffer();
    const src = await PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return pdfBlob(await merged.save());
}

// ────────────────────────────────────────────────────────────────────────────
// Split: 1 PDF → N single-page PDFs
// ────────────────────────────────────────────────────────────────────────────

export interface NamedBlob {
  name: string;
  blob: Blob;
}

export async function splitPdfPerPage(file: File): Promise<NamedBlob[]> {
  const buf = await file.arrayBuffer();
  const src = await PDFDocument.load(buf);
  const pageCount = src.getPageCount();
  const stem = file.name.replace(/\.pdf$/i, '');
  const out: NamedBlob[] = [];
  const pad = pageCount < 100 ? 2 : 3;
  for (let i = 0; i < pageCount; i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    out.push({
      name: `${stem}-page-${String(i + 1).padStart(pad, '0')}.pdf`,
      blob: pdfBlob(await doc.save()),
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Rotate: 1 PDF → 1 rotated PDF
// ────────────────────────────────────────────────────────────────────────────

export type RotationDegrees = 90 | 180 | 270;

export async function rotatePdf(file: File, by: RotationDegrees): Promise<Blob> {
  const buf = await file.arrayBuffer();
  const doc = await PDFDocument.load(buf);
  for (const page of doc.getPages()) {
    const current = page.getRotation().angle;
    page.setRotation(degrees(((current + by) % 360 + 360) % 360));
  }
  return pdfBlob(await doc.save());
}

// ────────────────────────────────────────────────────────────────────────────
// Images → PDF
// ────────────────────────────────────────────────────────────────────────────

export type PageSize = 'A4' | 'Letter' | 'Auto';
export type PageOrientation = 'portrait' | 'landscape';

// Page dimensions in PDF points (72 dpi). Portrait orientation.
const PAGE_DIMENSIONS: Record<Exclude<PageSize, 'Auto'>, [number, number]> = {
  A4: [595, 842], // 8.27 × 11.69 in
  Letter: [612, 792], // 8.5 × 11 in
};

const PAGE_MARGIN = 24; // points; ~0.33 in

export async function imagesToPdf(
  files: File[],
  pageSize: PageSize = 'Auto',
  orientation: PageOrientation = 'portrait',
): Promise<Blob> {
  const doc = await PDFDocument.create();

  for (const file of files) {
    const kind = await isJpegOrPng(file);
    if (!kind) {
      throw new Error(`"${file.name}" is not a supported image (JPEG or PNG only).`);
    }
    const buf = await file.arrayBuffer();
    const img =
      kind === 'png' ? await doc.embedPng(buf) : await doc.embedJpg(buf);

    let pageWidth: number;
    let pageHeight: number;
    if (pageSize === 'Auto') {
      pageWidth = img.width;
      pageHeight = img.height;
    } else {
      const [w, h] = PAGE_DIMENSIONS[pageSize];
      pageWidth = orientation === 'landscape' ? h : w;
      pageHeight = orientation === 'landscape' ? w : h;
    }

    const page = doc.addPage([pageWidth, pageHeight]);

    // Fit image with margins, preserving aspect ratio.
    const availW =
      pageSize === 'Auto' ? pageWidth : Math.max(0, pageWidth - 2 * PAGE_MARGIN);
    const availH =
      pageSize === 'Auto'
        ? pageHeight
        : Math.max(0, pageHeight - 2 * PAGE_MARGIN);
    const scale = Math.min(availW / img.width, availH / img.height, 1);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    page.drawImage(img, {
      x: (pageWidth - drawW) / 2,
      y: (pageHeight - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }

  return pdfBlob(await doc.save());
}

// ────────────────────────────────────────────────────────────────────────────
// PDF → JPGs (one per page)
// ────────────────────────────────────────────────────────────────────────────

export interface PdfToJpgOptions {
  /** JPEG quality 0–1. Default 0.85. */
  quality?: number;
  /** Render scale. 1 = native PDF resolution (~72 dpi). 2 = ~144 dpi. Default 2. */
  scale?: number;
}

export async function pdfToJpgs(
  file: File,
  options: PdfToJpgOptions = {},
): Promise<NamedBlob[]> {
  const { quality = 0.85, scale = 2 } = options;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const stem = file.name.replace(/\.pdf$/i, '');
  const pad = pdf.numPages < 100 ? 2 : 3;
  const out: NamedBlob[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D rendering context.');

    // White background — JPEGs have no alpha, prevents black bleed.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed.'))),
        'image/jpeg',
        quality,
      );
    });

    out.push({
      name: `${stem}-page-${String(i).padStart(pad, '0')}.jpg`,
      blob,
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Compress PDF — three-stage pipeline (preserves text)
//
//   Stage 1: pdf-lib walks indirect objects, recompresses JPEG image
//            streams. Each image is downscaled if it's bigger than what
//            its on-page rendered size justifies (DPI-aware downsampling
//            via content-stream analysis), then re-encoded via mozjpeg
//            for the smallest output at the chosen quality. Pages
//            without any rendered footprint fall back to a preset cap.
//            Pure-flate (PNG-style) images are left for qpdf to handle.
//
//   Stage 2: drop document bloat — /Thumb thumbnails, /Metadata XMP,
//            /PieceInfo, /SpiderInfo. None of this is needed for viewing.
//
//   Stage 3: qpdf-wasm structural pass in a Web Worker — re-deflates
//            every stream at max level, packs objects into compressed
//            streams, converts FlateDecode images to JPEG when smaller,
//            linearizes for web viewing.
//
// At the end we compare to the original and return whichever is smaller.
// ────────────────────────────────────────────────────────────────────────────

export type CompressLevel = 'low' | 'medium' | 'high';

interface CompressPreset {
  /** JPEG re-encode quality (0–100, mozjpeg scale). */
  quality: number;
  /**
   * Hard cap on a single edge in pixels when the rendered size is
   * unknown. The DPI-aware path overrides this when it has a render
   * footprint.
   */
  maxDim: number;
  /**
   * Pixels-per-PDF-point sample rate used to translate rendered size
   * into target pixels. 3.0 ≈ 220 DPI (retina-class viewing).
   */
  oversample: number;
}

const COMPRESS_PRESETS: Record<CompressLevel, CompressPreset> = {
  // Strong is genuinely aggressive: q=28 produces clearly softer images on
  // photos. Every image is attempted; the per-image safety check keeps the
  // original bytes whenever recompression would inflate, so worst-case a
  // preset is the same as the input image.
  low: { quality: 80, maxDim: 2200, oversample: 3.0 },
  medium: { quality: 65, maxDim: 1600, oversample: 2.5 },
  high: { quality: 28, maxDim: 900, oversample: 1.8 },
};

export interface CompressResult {
  blob: Blob;
  /** Original input size in bytes. */
  originalSize: number;
  /**
   * Size after pdf-lib's first pass (image recompression for Light/Balanced,
   * rasterize-and-rebuild for Strong), before qpdf if it runs.
   */
  afterPdfLibSize: number;
  /** Final size we're handing back (which is the smallest pass that ran). */
  finalSize: number;
  /** Which strategy the preset used. */
  strategy: 'image-recompress' | 'rasterize';
  /** How many embedded images we touched. 0 for the rasterize strategy. */
  imagesRecompressed: number;
  /** How many pages we rasterized. 0 for the image-recompress strategy. */
  pagesRasterized: number;
  /** Whether qpdf's structural pass ran (false if it failed/was skipped). */
  qpdfPassRan: boolean;
  /** If qpdf ran, was its output smaller than pdf-lib's? (we kept the smaller of the two) */
  qpdfHelped: boolean;
  /** Whether compression actually reduced the file size. */
  smallerThanOriginal: boolean;
}

/**
 * Strip bytes that aren't needed for rendering. The `aggressive` flag
 * enables more invasive removal that has user-visible consequences:
 * accessibility tags (used by screen readers), document outlines
 * (bookmarks), and the structure tree go. Only flip it for Strong
 * where the contract is explicitly "smallest file."
 *
 * Returns true if anything was removed.
 */
function dropBloat(doc: PDFDocument, aggressive: boolean): boolean {
  let removed = false;
  const drop = (parent: ReturnType<typeof doc.catalog.get> | typeof doc.catalog, key: string) => {
    // `parent` here is always a PDFDict-like; use a duck-typed delete
    // so we don't need to import the concrete type.
    const dict = parent as unknown as {
      has: (k: ReturnType<typeof PDFName.of>) => boolean;
      delete: (k: ReturnType<typeof PDFName.of>) => void;
    };
    const name = PDFName.of(key);
    if (dict.has(name)) {
      dict.delete(name);
      removed = true;
    }
  };

  const catalog = doc.catalog;
  // Catalog-level cruft that viewers don't display
  drop(catalog, 'Metadata');
  drop(catalog, 'PieceInfo');

  if (aggressive) {
    // /StructTreeRoot is the logical structure tree used by screen
    // readers and "Save as Tagged PDF" tools — large on academic PDFs.
    drop(catalog, 'StructTreeRoot');
    drop(catalog, 'MarkInfo');
    // Outlines = bookmarks in the sidebar. Typically small but free.
    drop(catalog, 'Outlines');
    // OCProperties = optional content groups (layers). Rare outside CAD.
    drop(catalog, 'OCProperties');
  }

  // Page-level cruft
  for (const page of doc.getPages()) {
    const node = page.node;
    drop(node, 'Thumb');
    drop(node, 'PieceInfo');
    drop(node, 'SpiderInfo');
    drop(node, 'Metadata');
    if (aggressive) {
      // /StructParents links into the StructTreeRoot we just dropped.
      drop(node, 'StructParents');
    }
  }

  return removed;
}

/**
 * Compress a PDF. Two strategies depending on the preset:
 *
 *  - Light / Balanced: image-recompression. Walk indirect objects,
 *    re-encode JPEG image streams at lower quality (DPI-aware), drop
 *    bloat (XMP, thumbnails), then run qpdf for structural compression.
 *    Text, vectors, fonts, structure all preserved. 25-40% on mixed PDFs.
 *
 *  - Strong: rasterize-and-rebuild. Each page becomes a flat JPEG with
 *    an invisible text layer overlaid so the output stays selectable
 *    and searchable. Form widgets, signatures, structure tags, and
 *    layers are dropped. 75-92% on mixed PDFs.
 *
 * In either strategy: if the result is somehow larger than the input,
 * we hand back the original bytes unchanged so the user never gets a
 * worse outcome.
 */
export async function compressPdf(
  file: File,
  level: CompressLevel = 'medium',
  onProgress?: OnCompressProgress,
): Promise<CompressResult> {
  const buf = await file.arrayBuffer();
  const originalSize = buf.byteLength;

  // ── Strong: completely different strategy ──
  if (level === 'high') {
    return compressViaRasterize(file, buf, originalSize, onProgress);
  }

  onProgress?.({ message: 'Recompressing images…', stage: 'recompress' });
  const preset = COMPRESS_PRESETS[level];
  const doc = await PDFDocument.load(buf, { ignoreEncryption: false });

  // ── Phase C: compute max rendered size per image (in PDF points) ──
  // Loaded lazily so the dependency only ships if the user actually
  // hits the compress page.
  const { analyzeImageRenderSizes, pointsToPixels } = await import(
    './imageRenderAnalyzer'
  );
  const { encodeJpeg } = await import('./jpegEncoder');
  let renderSizes: Awaited<ReturnType<typeof analyzeImageRenderSizes>>;
  try {
    renderSizes = analyzeImageRenderSizes(doc);
  } catch {
    renderSizes = new Map();
  }

  // ── Stage 1: JPEG-image pass via pdf-lib + mozjpeg ──
  let imagesRecompressed = 0;
  const indirects = doc.context.enumerateIndirectObjects();

  // Cheap dict-inspection pre-pass (no decoding): count the qualifying
  // JPEG image streams so the per-image progress below has a denominator.
  let totalJpegImages = 0;
  for (const [, obj] of indirects) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Image') continue;
    const filter = obj.dict.get(PDFName.of('Filter'));
    if (!filter || !filter.toString().includes('DCTDecode')) continue;
    totalJpegImages++;
  }
  let jpegImageIndex = 0;

  for (const [ref, obj] of indirects) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;

    const subtype = dict.get(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Image') continue;

    const filter = dict.get(PDFName.of('Filter'));
    const filterStr = filter ? filter.toString() : '';
    if (!filterStr.includes('DCTDecode')) continue;

    if (totalJpegImages > 0) {
      jpegImageIndex++;
      onProgress?.({
        message: `Recompressing image ${jpegImageIndex} of ${totalJpegImages}…`,
        stage: 'recompress',
        fraction: jpegImageIndex / totalJpegImages,
      });
    }

    const jpegBytes = obj.contents;
    if (!jpegBytes || jpegBytes.length === 0) continue;

    try {
      const blob = new Blob([jpegBytes as BlobPart], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(blob);

      // ── DPI-aware target sizing ──
      const info = renderSizes.get(ref.tag);
      let targetW: number;
      let targetH: number;
      if (info && info.maxRenderedWidth > 0 && info.maxRenderedHeight > 0) {
        // We know how big this image is rendered on the page. Cap pixels at
        // oversample × rendered points; never upscale; never go below 1px.
        const baseDpi = preset.oversample * 72;
        const allowedW = pointsToPixels(info.maxRenderedWidth, baseDpi);
        const allowedH = pointsToPixels(info.maxRenderedHeight, baseDpi);
        const sx = Math.min(1, allowedW / bitmap.width);
        const sy = Math.min(1, allowedH / bitmap.height);
        const s = Math.min(sx, sy);
        targetW = Math.max(1, Math.round(bitmap.width * s));
        targetH = Math.max(1, Math.round(bitmap.height * s));
      } else {
        // No render info — fall back to a preset cap on the longest edge.
        const longest = Math.max(bitmap.width, bitmap.height);
        const s = longest > preset.maxDim ? preset.maxDim / longest : 1;
        targetW = Math.max(1, Math.round(bitmap.width * s));
        targetH = Math.max(1, Math.round(bitmap.height * s));
      }

      // Draw onto a canvas at the target size to get a raw pixel buffer
      let pixels: Uint8ClampedArray;
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(targetW, targetH);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D context (OffscreenCanvas)');
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        pixels = ctx.getImageData(0, 0, targetW, targetH).data;
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D context');
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        pixels = ctx.getImageData(0, 0, targetW, targetH).data;
      }
      bitmap.close();

      const newBytes = await encodeJpeg(pixels, targetW, targetH, preset.quality);

      if (newBytes.length < jpegBytes.length) {
        const newDict = doc.context.obj({}) as typeof dict;
        for (const [key, value] of dict.entries()) {
          newDict.set(key, value);
        }
        newDict.set(PDFName.of('Width'), PDFNumber.of(targetW));
        newDict.set(PDFName.of('Height'), PDFNumber.of(targetH));
        newDict.delete(PDFName.of('Length'));

        const newStream = PDFRawStream.of(newDict, newBytes);
        doc.context.assign(ref, newStream);
        imagesRecompressed++;
      }
    } catch {
      continue;
    }
  }

  // ── Stage 2: drop bloat (XMP metadata, thumbnails, piece info) ──
  // Aggressive bloat removal (accessibility tags, bookmarks, structure
  // tree) was previously tied to Strong, but Strong now uses the
  // rasterize pipeline above which discards those naturally. Light and
  // Balanced keep accessibility intact, so we never pass `true` here.
  dropBloat(doc, false);

  // ── pdf-lib save (object streams help here too) ──
  const pdfLibBytes = await doc.save({ useObjectStreams: true });
  const afterPdfLibSize = pdfLibBytes.byteLength;

  // ── Stage 3: qpdf structural pass (off-thread) ──
  onProgress?.({ message: 'Finishing…', stage: 'finalize' });
  let bestBytes: Uint8Array = pdfLibBytes;
  let qpdfPassRan = false;
  let qpdfHelped = false;
  let qpdfBytesLength = 0;
  try {
    const { runQpdfPass } = await import('./qpdfClient');
    const qpdfBytes = await runQpdfPass(pdfLibBytes);
    qpdfPassRan = true;
    qpdfBytesLength = qpdfBytes.byteLength;
    if (qpdfBytes.byteLength < bestBytes.byteLength) {
      bestBytes = qpdfBytes;
      qpdfHelped = true;
    }
  } catch (err) {
    // Worker failed or qpdf threw — keep the pdf-lib bytes.
    console.warn('[compressPdf] qpdf pass failed:', err);
  }

  // Per-stage console breakdown so we can verify the pipeline is firing
  // end-to-end without instrumenting the UI permanently.
  const pct = (after: number) =>
    `${((1 - after / originalSize) * 100).toFixed(1)}%`;
  console.log(
    `[compressPdf] level=${level} images=${imagesRecompressed} | ` +
      `original=${originalSize} → pdf-lib=${afterPdfLibSize} (${pct(afterPdfLibSize)}) ` +
      `→ qpdf=${qpdfPassRan ? `${qpdfBytesLength} (${pct(qpdfBytesLength)})` : 'skipped'} ` +
      `→ final=${bestBytes.byteLength} (${pct(bestBytes.byteLength)})`,
  );

  // ── Safety net: never hand back a bigger file than we got ──
  if (bestBytes.byteLength >= originalSize) {
    return {
      blob: new Blob([buf as BlobPart], { type: 'application/pdf' }),
      originalSize,
      afterPdfLibSize,
      finalSize: originalSize,
      strategy: 'image-recompress',
      imagesRecompressed,
      pagesRasterized: 0,
      qpdfPassRan,
      qpdfHelped,
      smallerThanOriginal: false,
    };
  }

  return {
    blob: pdfBlob(bestBytes),
    originalSize,
    afterPdfLibSize,
    finalSize: bestBytes.byteLength,
    strategy: 'image-recompress',
    imagesRecompressed,
    pagesRasterized: 0,
    qpdfPassRan,
    qpdfHelped,
    smallerThanOriginal: true,
  };
}

/**
 * Strong-preset implementation: rasterize each page to a JPEG and overlay
 * an invisible text layer so the output stays selectable.
 *
 * Optionally chains through qpdf for a final structural pass — qpdf
 * usually shaves another 1-5% off the rasterized PDF by repacking the
 * indirect objects and re-deflating any flate streams the rasterize step
 * left behind (e.g., the small content streams that draw each image).
 *
 * Lazy-loads rasterizePipeline so users who pick Light/Balanced never
 * download the (already-bundled-elsewhere) pdf.js text-extraction path.
 */
async function compressViaRasterize(
  file: File,
  buf: ArrayBuffer,
  originalSize: number,
  onProgress?: OnCompressProgress,
): Promise<CompressResult> {
  const { rasterizePdf } = await import('./rasterizePipeline');
  onProgress?.({ message: 'Flattening pages…', stage: 'render' });
  // Tuned for "iLovePDF Recommended" parity: 144 DPI is retina-class
  // sharpness, q55 is the visual-equivalence sweet spot.
  const rasterized = await rasterizePdf(file, { dpi: 144, jpegQuality: 55 });
  const afterPdfLibSize = rasterized.bytes.byteLength;
  let bestBytes: Uint8Array = rasterized.bytes;
  let qpdfPassRan = false;
  let qpdfHelped = false;
  let qpdfBytesLength = 0;
  try {
    const { runQpdfPass } = await import('./qpdfClient');
    const qpdfBytes = await runQpdfPass(rasterized.bytes);
    qpdfPassRan = true;
    qpdfBytesLength = qpdfBytes.byteLength;
    if (qpdfBytes.byteLength < bestBytes.byteLength) {
      bestBytes = qpdfBytes;
      qpdfHelped = true;
    }
  } catch (err) {
    console.warn('[compressPdf:strong] qpdf pass failed:', err);
  }

  const pct = (after: number) =>
    `${((1 - after / originalSize) * 100).toFixed(1)}%`;
  console.log(
    `[compressPdf] level=high strategy=rasterize pages=${rasterized.pagesRasterized} | ` +
      `original=${originalSize} → rasterize=${afterPdfLibSize} (${pct(afterPdfLibSize)}) ` +
      `→ qpdf=${qpdfPassRan ? `${qpdfBytesLength} (${pct(qpdfBytesLength)})` : 'skipped'} ` +
      `→ final=${bestBytes.byteLength} (${pct(bestBytes.byteLength)})`,
  );

  if (bestBytes.byteLength >= originalSize) {
    return {
      blob: new Blob([buf as BlobPart], { type: 'application/pdf' }),
      originalSize,
      afterPdfLibSize,
      finalSize: originalSize,
      strategy: 'rasterize',
      imagesRecompressed: 0,
      pagesRasterized: rasterized.pagesRasterized,
      qpdfPassRan,
      qpdfHelped,
      smallerThanOriginal: false,
    };
  }

  return {
    blob: pdfBlob(bestBytes),
    originalSize,
    afterPdfLibSize,
    finalSize: bestBytes.byteLength,
    strategy: 'rasterize',
    imagesRecompressed: 0,
    pagesRasterized: rasterized.pagesRasterized,
    qpdfPassRan,
    qpdfHelped,
    smallerThanOriginal: true,
  };
}
