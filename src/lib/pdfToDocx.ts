/**
 * PDF → DOCX conversion via pdf.js + docx.
 *
 * Strategy:
 *  1. Use pdf.js to extract every text run on every page, with x/y/font-size,
 *     plus bold/italic detection from font names and link annotations.
 *  2. Heuristically reconstruct paragraphs:
 *       - Sort by page, then y (PDF y is bottom-up), then x.
 *       - Same line if y is close. Same paragraph if vertical gap is small.
 *       - Big gap or font-size jump → start a new paragraph.
 *  3. Within each paragraph, keep consecutive runs with the same style (bold,
 *     italic, link) merged together for cleaner Word output.
 *  4. Classify each paragraph:
 *       - Heading levels by font size relative to median body size.
 *       - Bulleted list by leading bullet char.
 *  5. Emit a real .docx with proper Heading/Paragraph/Bullet styles, with
 *     bold/italic/hyperlink runs preserved.
 *
 * Known limitations are documented in the UI: tables flatten, multi-column
 * may interleave, scanned PDFs need OCR (Phase 4), images dropped.
 */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from 'docx';

// One-time worker setup. Vite bundles the worker file and gives us a URL.
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

interface LinkRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  url: string;
}

interface RawItem {
  str: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  link?: string;
  x: number;
  y: number;
  width: number;
  page: number;
}

interface StyledRun {
  text: string;
  bold: boolean;
  italic: boolean;
  link?: string;
}

interface ParaGroup {
  runs: StyledRun[];
  fontSize: number;
  page: number;
}

export interface PdfConversionResult {
  blob: Blob;
  /** Total characters of extractable text (low number → likely scanned). */
  charCount: number;
  /** How many heading-level paragraphs we detected (sanity signal). */
  headingCount: number;
  /** How many pages the PDF has. */
  pageCount: number;
  /** How many hyperlinks we preserved. */
  linkCount: number;
  warnings: string[];
}

const BULLET_RX = /^([•‣◦⁃∙·●○‣⁃\-\*])\s+/;

/** Detect bold/italic from a font name string. Best-effort pattern match. */
function detectStyle(fontDescriptor: string): { bold: boolean; italic: boolean } {
  const s = fontDescriptor.toLowerCase();
  return {
    bold: /\bbold\b|\bblack\b|\bheavy\b|\bsemibold\b|-bd|-bold|-black/.test(s),
    italic: /\bitalic\b|\boblique\b|-it|-italic|-oblique/.test(s),
  };
}

/** Convert a PDF File into a .docx Blob. */
export async function pdfToDocx(file: File): Promise<PdfConversionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const warnings: string[] = [];

  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    isEvalSupported: false,
    disableFontFace: false,
  });

  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('password')) {
      throw new Error('This PDF is password-protected. Please remove the password and try again.');
    }
    throw new Error(`Could not read this PDF: ${msg}`);
  }

  const allItems: RawItem[] = [];
  let linkCount = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const [content, annotations] = await Promise.all([
      page.getTextContent(),
      page.getAnnotations().catch(() => [] as unknown[]),
    ]);

    // Build the per-page list of clickable link rectangles.
    const links: LinkRect[] = [];
    for (const a of annotations as Array<Record<string, unknown>>) {
      if (a['subtype'] !== 'Link') continue;
      const url = a['url'];
      if (typeof url !== 'string' || !url) continue;
      const rect = a['rect'];
      if (!Array.isArray(rect) || rect.length < 4) continue;
      const [x1, y1, x2, y2] = rect as number[];
      links.push({
        x1: Math.min(x1, x2),
        y1: Math.min(y1, y2),
        x2: Math.max(x1, x2),
        y2: Math.max(y1, y2),
        url,
      });
    }
    linkCount += links.length;

    // Build a font-name → {bold, italic} map from textContent.styles.
    // Works when the font family encodes style ("Calibri-Bold,sans-serif").
    const styles = (content as { styles?: Record<string, { fontFamily?: string }> }).styles ?? {};
    const fontStyleCache = new Map<string, { bold: boolean; italic: boolean }>();

    const styleForFont = (fontName: string): { bold: boolean; italic: boolean } => {
      let cached = fontStyleCache.get(fontName);
      if (cached) return cached;

      // Try fontFamily first (often includes style: "Times-Bold,serif").
      const family = styles[fontName]?.fontFamily ?? '';
      let style = detectStyle(family);

      // Fallback: try the actual font name via commonObjs (more reliable but
      // not always available). Wrap in try/catch — different pdfjs versions
      // throw differently when the object isn't loaded.
      if (!style.bold && !style.italic) {
        try {
          const obj = (page as unknown as {
            commonObjs: { get: (id: string) => { name?: string } | undefined };
          }).commonObjs.get(fontName);
          if (obj?.name) {
            style = detectStyle(obj.name);
          }
        } catch {
          /* not loaded yet — fall through */
        }
      }

      // Last resort: pattern-match the fontName itself.
      if (!style.bold && !style.italic) {
        style = detectStyle(fontName);
      }

      fontStyleCache.set(fontName, style);
      return style;
    };

    for (const raw of content.items) {
      if (typeof (raw as { str?: unknown }).str !== 'string') continue;
      const item = raw as {
        str: string;
        transform: number[];
        width: number;
        height?: number;
        hasEOL?: boolean;
        fontName?: string;
      };
      if (item.str === '' && !item.hasEOL) continue;

      const fontSize = Math.abs(item.transform[3]) || item.height || 12;
      const x = item.transform[4];
      const y = item.transform[5];
      const fontName = item.fontName ?? '';
      const { bold, italic } = fontName ? styleForFont(fontName) : { bold: false, italic: false };
      const link = findLink(x, y, item.width, fontSize, links);

      allItems.push({
        str: item.str,
        fontSize,
        bold,
        italic,
        link,
        x,
        y,
        width: item.width,
        page: pageNum,
      });
    }
  }

  const charCount = allItems.reduce((acc, it) => acc + it.str.length, 0);
  if (charCount < 50 && pdf.numPages > 0) {
    warnings.push(
      'Very little text extracted — this PDF may be a scanned image. OCR (coming soon) would be needed.',
    );
  }

  const paragraphs = groupIntoParagraphs(allItems);
  const medianFontSize = median(paragraphs.map((p) => p.fontSize));

  // Classify and build docx paragraphs
  let headingCount = 0;
  const docParas: Paragraph[] = paragraphs.map((p) => {
    const ratio = p.fontSize / (medianFontSize || p.fontSize);
    let heading: HeadingLevel | undefined;
    if (ratio >= 1.6) heading = HeadingLevel.HEADING_1;
    else if (ratio >= 1.35) heading = HeadingLevel.HEADING_2;
    else if (ratio >= 1.18) heading = HeadingLevel.HEADING_3;

    if (heading) headingCount++;

    // Bullet list? Strip the prefix from the first run.
    if (!heading && p.runs.length > 0) {
      const first = p.runs[0].text;
      const bulletMatch = first.match(BULLET_RX);
      if (bulletMatch) {
        const stripped = first.slice(bulletMatch[0].length);
        const trimmedRuns = stripped
          ? [{ ...p.runs[0], text: stripped }, ...p.runs.slice(1)]
          : p.runs.slice(1);
        return new Paragraph({
          children: renderRuns(trimmedRuns),
          bullet: { level: 0 },
        });
      }
    }

    if (heading) {
      return new Paragraph({
        children: renderRuns(p.runs),
        heading,
      });
    }

    return new Paragraph({
      children: renderRuns(p.runs),
    });
  });

  if (docParas.length === 0) {
    docParas.push(
      new Paragraph({
        children: [new TextRun({ text: '(No extractable text found in this PDF.)' })],
      }),
    );
  }

  const doc = new Document({
    creator: 'a → b',
    description: 'Converted from PDF',
    sections: [
      {
        properties: {},
        children: docParas,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);

  return {
    blob,
    charCount,
    headingCount,
    pageCount: pdf.numPages,
    linkCount,
    warnings,
  };
}

/**
 * Find which (if any) link annotation a text item falls inside.
 * All coordinates are in PDF user space (origin = page bottom-left).
 */
function findLink(
  x: number,
  y: number,
  width: number,
  fontSize: number,
  links: LinkRect[],
): string | undefined {
  if (links.length === 0) return undefined;
  // Text item position: (x, y) is roughly the baseline-left of the run.
  // Approximate the run's bounding box.
  const left = x;
  const right = x + width;
  const bottom = y - fontSize * 0.2; // small descent allowance
  const top = y + fontSize * 0.9; // ascent

  // Tolerance so off-by-a-pixel doesn't disqualify a clear match.
  const TOL = 1.5;

  for (const link of links) {
    if (
      left + TOL >= link.x1 &&
      right - TOL <= link.x2 &&
      bottom + TOL >= link.y1 &&
      top - TOL <= link.y2
    ) {
      return link.url;
    }
  }
  return undefined;
}

/**
 * Group raw text items into paragraphs of styled runs.
 * Most of the heuristic work lives here.
 */
function groupIntoParagraphs(items: RawItem[]): ParaGroup[] {
  // Sort by page (asc), then y (desc, since PDF y is bottom-up), then x (asc)
  const sorted = [...items].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (Math.abs(a.y - b.y) > 1.5) return b.y - a.y;
    return a.x - b.x;
  });

  const paragraphs: ParaGroup[] = [];
  let current: ParaGroup | null = null;
  let lastY = -Infinity;
  let lastFontSize = -1;
  let lastPage = -1;
  let lastEndedWithSpace = true;

  const flush = () => {
    if (current && current.runs.some((r) => r.text.trim().length > 0)) {
      // Tidy whitespace per run, and trim the paragraph as a whole.
      for (const r of current.runs) r.text = r.text.replace(/[ \t]+/g, ' ');
      current.runs[0].text = current.runs[0].text.replace(/^[ \t]+/, '');
      const last = current.runs[current.runs.length - 1];
      last.text = last.text.replace(/[ \t]+$/, '');
      // Drop any runs that ended up empty after trimming
      current.runs = current.runs.filter((r) => r.text.length > 0);
      paragraphs.push(current);
    }
    current = null;
  };

  const sameStyle = (a: StyledRun, b: { bold: boolean; italic: boolean; link?: string }) =>
    a.bold === b.bold && a.italic === b.italic && a.link === b.link;

  for (const item of sorted) {
    if (item.str.length === 0) continue;

    const samePage = item.page === lastPage;
    const verticalGap = samePage ? lastY - item.y : Infinity;
    const sameLine = samePage && Math.abs(verticalGap) <= 1.5;
    const fontJump = Math.abs(item.fontSize - lastFontSize) > 1;

    let startNew = current === null;
    if (!startNew) {
      if (item.page !== lastPage) startNew = true;
      else if (verticalGap > item.fontSize * 1.6) startNew = true;
      else if (fontJump && verticalGap > item.fontSize * 0.5) startNew = true;
    }

    if (startNew) {
      flush();
      current = {
        runs: [
          { text: item.str, bold: item.bold, italic: item.italic, link: item.link },
        ],
        fontSize: item.fontSize,
        page: item.page,
      };
      lastEndedWithSpace = /\s$/.test(item.str);
    } else if (current) {
      const startsWithSpace = /^\s/.test(item.str);
      let separator = '';
      let textToAdd = item.str;

      if (sameLine) {
        if (!lastEndedWithSpace && !startsWithSpace) separator = ' ';
      } else {
        const lastRun = current.runs[current.runs.length - 1];
        if (lastRun?.text.endsWith('-')) {
          // Soft hyphen at line break — strip the hyphen, glue the words.
          lastRun.text = lastRun.text.slice(0, -1);
        } else if (!lastEndedWithSpace && !startsWithSpace) {
          separator = ' ';
        }
      }
      textToAdd = separator + textToAdd;

      const lastRun = current.runs[current.runs.length - 1];
      if (lastRun && sameStyle(lastRun, item)) {
        lastRun.text += textToAdd;
      } else {
        current.runs.push({
          text: textToAdd,
          bold: item.bold,
          italic: item.italic,
          link: item.link,
        });
      }
      lastEndedWithSpace = /\s$/.test(item.str);

      if (item.fontSize > current.fontSize) current.fontSize = item.fontSize;
    }

    lastY = item.y;
    lastPage = item.page;
    lastFontSize = item.fontSize;
  }
  flush();

  return paragraphs;
}

/** Map our internal StyledRuns to docx ParagraphChildren (TextRuns + Hyperlinks). */
function renderRuns(runs: StyledRun[]): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    if (r.link) {
      out.push(
        new ExternalHyperlink({
          link: r.link,
          children: [
            new TextRun({
              text: r.text,
              bold: r.bold,
              italics: r.italic,
              style: 'Hyperlink',
            }),
          ],
        }),
      );
    } else {
      out.push(
        new TextRun({
          text: r.text,
          bold: r.bold,
          italics: r.italic,
        }),
      );
    }
  }
  if (out.length === 0) {
    out.push(new TextRun({ text: '' }));
  }
  return out;
}

function median(numbers: number[]): number {
  if (numbers.length === 0) return 12;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
