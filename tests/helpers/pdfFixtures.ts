/**
 * Synthetic PDF fixtures for benchmarking the Phase 5 PDF compressor.
 *
 * These helpers build deterministic, self-contained PDFs entirely with
 * pdf-lib — no canvas, no DOM, no filesystem — so they run identically in
 * Node, jsdom, and the browser. Each generator returns raw PDF bytes as a
 * Uint8Array (always starting with the "%PDF-" magic header).
 *
 *  - makeTextPdf    N pages of Helvetica body text, no images (compresses
 *                   poorly — the baseline "small" file).
 *  - makeImagePdf   N pages, each filled by an embedded baseline JPEG
 *                   (heavy — the file a real compressor could shrink).
 *  - makeMixedPdf   N pages alternating text-forward and image-forward
 *                   layouts, one embedded image per page.
 *
 * The embedded image is a real baseline JPEG carried inline as a base64
 * constant (a 96×96 noisy colour tile, ~14 KB). It is deterministic and
 * embed-able via doc.embedJpg(); drawing it scaled to fill a Letter page,
 * once per page, inflates the image fixtures into the hundreds-of-KB range
 * while the text fixtures stay tiny.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** US Letter, in PDF points (72pt = 1in). Matches the app's default page. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

/** A few paragraphs of filler prose, wrapped per page in the text fixtures. */
const LOREM = [
  'The quick brown fox jumps over the lazy dog while the compressor benchmark',
  'measures how a page of plain Helvetica body text is stored inside a PDF.',
  'Text content streams compress poorly compared to already-compressed image',
  'data, so these paragraphs establish the small-file baseline for the suite.',
  'Every generator here is deterministic: the same page count always yields',
  'byte-for-byte identical output, which keeps size assertions stable in CI.',
  'We repeat several lines of prose per page to give the layout engine real',
  'work to do, filling the printable area from the top margin to the bottom.',
];

/**
 * A real baseline JPEG (96×96 noisy colour tile, quality ~88) encoded as
 * base64. Kept inline so the fixtures need no binary assets on disk. It has
 * genuine high-frequency content, so each embedding contributes real bytes
 * rather than collapsing to near-nothing.
 */
const TILE_JPEG_BASE64 =
  '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';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Decode the inline base64 JPEG into raw bytes for doc.embedJpg(). */
function decodeTileJpeg(): Uint8Array {
  const binary = atob(TILE_JPEG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Clamp a requested page count to at least one page. */
function normalizePages(pages: number): number {
  return Math.max(1, Math.floor(pages));
}

/**
 * How many independent copies of the tile to embed per image page.
 *
 * pdf-lib de-duplicates a single embedJpg() result into one shared XObject,
 * so drawing it N times costs almost nothing. To make the image fixtures
 * genuinely heavy (the whole point — a file a compressor can shrink), we
 * embed the JPEG as several *distinct* streams per page. Each embedJpg()
 * call yields a fresh ~14 KB stream, so the byte weight scales with copies.
 */
const IMAGE_COPIES_PER_PAGE = 12;

// ────────────────────────────────────────────────────────────────────────────
// Generators
// ────────────────────────────────────────────────────────────────────────────

/**
 * Text-heavy fixture: each page carries several paragraphs of Helvetica body
 * text and no images. This is the "small" baseline in size comparisons.
 */
export async function makeTextPdf(pages: number): Promise<Uint8Array> {
  const count = normalizePages(pages);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const fontSize = 12;
  const lineHeight = 16;
  const margin = 56;

  for (let p = 0; p < count; p++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - margin;

    // Fill the printable area top-to-bottom by cycling the filler lines.
    let line = 0;
    while (y > margin) {
      const text = `${p + 1}.${line + 1}  ${LOREM[line % LOREM.length]}`;
      page.drawText(text, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
      line++;
    }
  }

  return doc.save();
}

/**
 * Image-heavy fixture: every page is filled edge-to-edge by the embedded
 * baseline JPEG. Repeating a real ~14 KB image once per page inflates the
 * file into the hundreds-of-KB range — the kind of PDF a compressor shrinks.
 */
export async function makeImagePdf(pages: number): Promise<Uint8Array> {
  const count = normalizePages(pages);
  const doc = await PDFDocument.create();
  const tileBytes = decodeTileJpeg();

  for (let p = 0; p < count; p++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    // Embed several *distinct* copies so pdf-lib can't de-dupe them, then
    // stack them full-bleed. The topmost one is what shows; the rest are
    // real byte weight that inflates the file (and that a compressor could
    // reclaim). Each embedJpg() is a fresh stream.
    for (let c = 0; c < IMAGE_COPIES_PER_PAGE; c++) {
      const jpg = await doc.embedJpg(tileBytes);
      page.drawImage(jpg, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
    }
  }

  return doc.save();
}

/**
 * Mixed fixture: alternating layouts. Odd pages are text-forward with the
 * image as a footer band; even pages are image-forward with a text caption
 * on top. Exactly one embedded image per page keeps things realistic.
 */
export async function makeMixedPdf(pages: number): Promise<Uint8Array> {
  const count = normalizePages(pages);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const tileBytes = decodeTileJpeg();

  const margin = 56;
  const lineHeight = 16;

  for (let p = 0; p < count; p++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const imageForward = p % 2 === 1;
    // One distinct embedded image per page (fresh stream, so pages add up).
    const jpg = await doc.embedJpg(tileBytes);

    if (imageForward) {
      // Image fills the page; a short text caption is drawn on top.
      page.drawImage(jpg, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
      page.drawText(`Page ${p + 1} — image-forward`, {
        x: margin,
        y: PAGE_HEIGHT - margin,
        size: 14,
        font,
        color: rgb(1, 1, 1),
      });
    } else {
      // Text-forward: paragraphs on top, a banded image along the bottom.
      let y = PAGE_HEIGHT - margin;
      let line = 0;
      const textFloor = PAGE_HEIGHT / 3;
      while (y > textFloor) {
        page.drawText(`${p + 1}.${line + 1}  ${LOREM[line % LOREM.length]}`, {
          x: margin,
          y,
          size: 12,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= lineHeight;
        line++;
      }
      page.drawImage(jpg, {
        x: 0,
        y: 0,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT / 3,
      });
    }
  }

  return doc.save();
}
