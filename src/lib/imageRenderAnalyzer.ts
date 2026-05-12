/**
 * Walk a PDF's pages, parse each page's content stream(s), and compute
 * the maximum rendered size (in PDF points) of every image XObject across
 * the whole document.
 *
 * The output is a map keyed by indirect-object number → max rendered
 * width/height. The compress pipeline uses this to decide whether each
 * image can be safely downscaled. An image that's drawn at 2 inches
 * wide on a Letter page doesn't need to be 4000 pixels along its long
 * edge — that's overkill and inflates the PDF.
 *
 * Limitations:
 *  - We don't follow Form XObjects (nested content streams inside an
 *    XObject of subtype /Form). If an image is drawn inside a Form
 *    XObject, we'll only know the form's CTM, not the image's. For most
 *    real-world PDFs this is fine because images live directly on pages.
 *  - We don't handle inline images (BI/ID/EI) because they don't have an
 *    indirect-object number anyway.
 */

import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from 'pdf-lib';
import {
  multiplyCTM,
  parseContentOps,
  unitBoxDimensions,
} from './contentStreamParser';

export interface ImageRenderInfo {
  /** Max width (in PDF points) the image is rendered at, across all pages. */
  maxRenderedWidth: number;
  /** Max height (in PDF points) the image is rendered at, across all pages. */
  maxRenderedHeight: number;
}

/**
 * Extract the raw bytes of a page's content stream(s). The Contents entry
 * may be a single stream or an array of streams (PDF 32000-1 §7.8.2);
 * either way the operators are interpreted as if concatenated.
 */
function collectContentBytes(pageDict: PDFDict): Uint8Array {
  const contents = pageDict.lookup(PDFName.of('Contents'));
  if (!contents) return new Uint8Array(0);

  const streams: PDFStream[] = [];
  if (contents instanceof PDFStream) {
    streams.push(contents);
  } else if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const entry = contents.lookup(i);
      if (entry instanceof PDFStream) streams.push(entry);
    }
  }

  // Decoded contents per stream — pdf-lib's getContents returns already
  // filter-decoded bytes for the streams it knows about.
  const buffers: Uint8Array[] = [];
  let total = 0;
  for (const s of streams) {
    try {
      const bytes = s.getContents();
      buffers.push(bytes);
      total += bytes.length;
      // PDF spec: streams are joined with a separator
      buffers.push(new Uint8Array([0x0a]));
      total++;
    } catch {
      // If a stream uses a filter pdf-lib can't decode, skip it. We'll
      // miss image references in that stream but won't crash.
    }
  }
  if (!buffers.length) return new Uint8Array(0);

  const out = new Uint8Array(total);
  let off = 0;
  for (const buf of buffers) {
    out.set(buf, off);
    off += buf.length;
  }
  return out;
}

/**
 * Map XObject names declared in a page's Resources to their indirect refs.
 * Returns only entries whose Subtype is /Image (we don't care about Form
 * XObjects for this analysis).
 */
function buildPageImageMap(
  doc: PDFDocument,
  pageDict: PDFDict,
): Map<string, PDFRef> {
  const out = new Map<string, PDFRef>();
  const resources = pageDict.lookup(PDFName.of('Resources'));
  if (!(resources instanceof PDFDict)) return out;

  const xObject = resources.lookup(PDFName.of('XObject'));
  if (!(xObject instanceof PDFDict)) return out;

  for (const [key, value] of xObject.entries()) {
    if (!(value instanceof PDFRef)) continue;
    const target = doc.context.lookup(value);
    if (!(target instanceof PDFRawStream)) continue;
    const subtype = target.dict.lookup(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') continue;
    out.set(key.asString(), value);
  }
  return out;
}

/**
 * For every image XObject reachable from a page, compute the max
 * rendered size across the document.
 *
 * The returned map is keyed by pdf-lib's `PDFRef.tag` so it can be used
 * to look up images during the recompression pass.
 */
export function analyzeImageRenderSizes(
  doc: PDFDocument,
): Map<string, ImageRenderInfo> {
  const result = new Map<string, ImageRenderInfo>();

  const pages = doc.getPages();
  for (const page of pages) {
    const pageDict = page.node;
    const imageMap = buildPageImageMap(doc, pageDict);
    if (imageMap.size === 0) continue;

    const contentBytes = collectContentBytes(pageDict);
    if (contentBytes.length === 0) continue;

    // CTM stack — starts at identity
    let ctm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    const stack: typeof ctm[] = [];

    for (const op of parseContentOps(contentBytes)) {
      if (op.op === 'q') {
        stack.push([...ctm] as typeof ctm);
      } else if (op.op === 'Q') {
        const popped = stack.pop();
        if (popped) ctm = popped;
      } else if (op.op === 'cm') {
        ctm = multiplyCTM(op.args, ctm);
      } else if (op.op === 'Do') {
        const ref = imageMap.get(op.name);
        if (!ref) continue;
        const { width, height } = unitBoxDimensions(ctm);
        const key = ref.tag;
        const prev = result.get(key);
        if (!prev) {
          result.set(key, { maxRenderedWidth: width, maxRenderedHeight: height });
        } else {
          result.set(key, {
            maxRenderedWidth: Math.max(prev.maxRenderedWidth, width),
            maxRenderedHeight: Math.max(prev.maxRenderedHeight, height),
          });
        }
      }
    }
  }

  return result;
}

/**
 * Translate a rendered size in PDF points into a target pixel size,
 * assuming a viewing DPI we want to support without softness.
 *
 * 1 PDF point = 1/72 inch.
 *   targetPixels = points × (targetDpi / 72)
 *
 * The default 220 DPI roughly matches a retina-class viewing experience —
 * higher than legacy 96 DPI screens but well below print fidelity. Going
 * above ~300 DPI gives diminishing returns for screen viewing.
 */
export function pointsToPixels(points: number, targetDpi = 220): number {
  return Math.ceil(points * (targetDpi / 72));
}
