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
import { PDFDocument, degrees } from 'pdf-lib';
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
  const bytes = await merged.save();
  return new Blob([bytes], { type: PDF_MIME });
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
    const bytes = await doc.save();
    out.push({
      name: `${stem}-page-${String(i + 1).padStart(pad, '0')}.pdf`,
      blob: new Blob([bytes], { type: PDF_MIME }),
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
  const bytes = await doc.save();
  return new Blob([bytes], { type: PDF_MIME });
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

  const bytes = await doc.save();
  return new Blob([bytes], { type: PDF_MIME });
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
// Compress PDF (render-and-recombine)
// ────────────────────────────────────────────────────────────────────────────

export type CompressLevel = 'low' | 'medium' | 'high';

const COMPRESS_PRESETS: Record<CompressLevel, { scale: number; quality: number }> = {
  low: { scale: 2, quality: 0.85 }, // lightest compression, best quality
  medium: { scale: 1.5, quality: 0.7 }, // balanced
  high: { scale: 1, quality: 0.55 }, // aggressive
};

/**
 * Compress a PDF by rendering each page to a JPEG, then assembling those
 * JPEGs into a new PDF. Effective for image-heavy PDFs; less effective (or
 * negative) for already-compressed text-only PDFs.
 *
 * Trade-off: text in the output is part of the page image (not selectable).
 * This is surfaced in the UI as a clear note.
 */
export async function compressPdf(file: File, level: CompressLevel = 'medium'): Promise<Blob> {
  const { scale, quality } = COMPRESS_PRESETS[level];
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const out = await PDFDocument.create();

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D rendering context.');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode page.'))),
        'image/jpeg',
        quality,
      );
    });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = await out.embedJpg(bytes);

    // Use original viewport dimensions for the new page so visual sizing matches.
    const origViewport = page.getViewport({ scale: 1 });
    const newPage = out.addPage([origViewport.width, origViewport.height]);
    newPage.drawImage(img, {
      x: 0,
      y: 0,
      width: origViewport.width,
      height: origViewport.height,
    });
  }

  const bytes = await out.save();
  return new Blob([bytes], { type: PDF_MIME });
}
