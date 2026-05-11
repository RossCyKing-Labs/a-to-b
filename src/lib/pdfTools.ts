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

// One-time worker setup for pdf.js — same pattern as src/lib/pdfToDocx.ts
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
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
// Compress PDF (image-only recompression — preserves text)
// ────────────────────────────────────────────────────────────────────────────

export type CompressLevel = 'low' | 'medium' | 'high';

interface CompressPreset {
  /** JPEG re-encode quality (0–1). */
  quality: number;
  /** Max longest-edge dimension in pixels. Larger images get downscaled. */
  maxDim: number;
}

const COMPRESS_PRESETS: Record<CompressLevel, CompressPreset> = {
  low: { quality: 0.88, maxDim: 2400 }, // lightest compression, best quality
  medium: { quality: 0.72, maxDim: 1800 }, // balanced
  high: { quality: 0.55, maxDim: 1400 }, // aggressive
};

export interface CompressResult {
  blob: Blob;
  /** How many embedded images we recompressed. */
  imagesRecompressed: number;
  /** Whether compression actually reduced the file size. */
  smallerThanOriginal: boolean;
}

/**
 * Compress a PDF by recompressing embedded JPEG images at lower quality and
 * downscaling oversized images. Text content, vector graphics, and the PDF's
 * structural elements are left UNTOUCHED — text in the output remains fully
 * selectable and searchable.
 *
 * How well this works depends on what's inside the PDF:
 *  - Image-heavy PDFs (scans, brochures with photos): substantial size reduction
 *  - Text-only PDFs: little to no reduction (there's nothing to recompress)
 *
 * If the recompressed result is somehow larger than the input (rare — happens
 * when images are already aggressively compressed), we return the original
 * bytes unchanged so the user never gets a worse outcome.
 */
export async function compressPdf(
  file: File,
  level: CompressLevel = 'medium',
): Promise<CompressResult> {
  const { quality, maxDim } = COMPRESS_PRESETS[level];
  const buf = await file.arrayBuffer();
  const originalSize = buf.byteLength;
  const doc = await PDFDocument.load(buf, { ignoreEncryption: false });

  const indirects = doc.context.enumerateIndirectObjects();
  let imagesRecompressed = 0;

  for (const [ref, obj] of indirects) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;

    // Image XObjects have /Subtype /Image in their dictionary
    const subtype = dict.get(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Image') continue;

    // We only handle JPEG (DCTDecode filter) — most common image format in
    // PDFs. PNG-style (FlateDecode) images are skipped to keep the
    // implementation focused and reliable.
    const filter = dict.get(PDFName.of('Filter'));
    const filterStr = filter ? filter.toString() : '';
    if (!filterStr.includes('DCTDecode')) continue;

    // The raw JPEG bytes are the stream contents (since DCTDecode == JPEG)
    const jpegBytes = obj.contents;
    if (!jpegBytes || jpegBytes.length === 0) continue;

    try {
      const blob = new Blob([jpegBytes as BlobPart], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(blob);

      // Downscale if the image is bigger than maxDim along its longest edge
      const longestEdge = Math.max(bitmap.width, bitmap.height);
      const scale = longestEdge > maxDim ? maxDim / longestEdge : 1;
      const targetW = Math.max(1, Math.round(bitmap.width * scale));
      const targetH = Math.max(1, Math.round(bitmap.height * scale));

      let recompressed: Blob;
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(targetW, targetH);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D context');
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        recompressed = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D context');
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        recompressed = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
            'image/jpeg',
            quality,
          ),
        );
      }

      const newBytes = new Uint8Array(await recompressed.arrayBuffer());

      // Only replace if smaller (else we'd inflate the PDF)
      if (newBytes.length < jpegBytes.length) {
        // Build a fresh dict carrying over everything except size-related keys
        const newDict = doc.context.obj({}) as typeof dict;
        for (const [key, value] of dict.entries()) {
          newDict.set(key, value);
        }
        newDict.set(PDFName.of('Width'), PDFNumber.of(targetW));
        newDict.set(PDFName.of('Height'), PDFNumber.of(targetH));
        newDict.delete(PDFName.of('Length')); // recomputed on save

        const newStream = PDFRawStream.of(newDict, newBytes);
        doc.context.assign(ref, newStream);
        imagesRecompressed++;
      }

      bitmap.close();
    } catch {
      // If a specific image can't be processed, skip it and continue
      // with the rest. The PDF stays intact otherwise.
      continue;
    }
  }

  // Save with object streams — packs the PDF more tightly without touching
  // visible content
  const bytes = await doc.save({ useObjectStreams: true });

  // Safety net: if our "compressed" output is somehow larger, return the
  // original instead so the user doesn't get a worse file.
  if (bytes.byteLength >= originalSize) {
    return {
      blob: new Blob([buf as BlobPart], { type: 'application/pdf' }),
      imagesRecompressed,
      smallerThanOriginal: false,
    };
  }

  return {
    blob: pdfBlob(bytes),
    imagesRecompressed,
    smallerThanOriginal: true,
  };
}
