/**
 * High-fidelity DOCX rendering via docx-preview.
 *
 * Replaces our earlier mammoth.js approach. Mammoth was designed for SEMANTIC
 * conversion — it intentionally strips most visual formatting (fonts, colors,
 * alignment, headers/footers) because its philosophy is "extract content,
 * ignore styling." That made our Word→PDF output look generic.
 *
 * docx-preview's philosophy is the opposite: render the document as faithfully
 * to Word as the browser allows. It writes its own CSS into the target
 * document, preserving:
 *  - Font family and size (subject to font availability)
 *  - Font colors and weight
 *  - Paragraph alignment and spacing
 *  - Table borders, shading, column widths
 *  - List nesting and numbering
 *  - Headers and footers (when opt-in)
 *  - Page breaks (when opt-in)
 *  - Embedded images (positioning best-effort)
 *
 * The output is rendered into a real DOM element. We then either show it
 * (for the in-page preview) or trigger the browser's print dialog (for PDF).
 *
 * Known limits we can't fix client-side without a 200MB+ WASM blob:
 *  - Word's default font is Calibri; we bundle Carlito (its open-source clone)
 *    aliased as 'Calibri' so most documents render with correct metrics.
 *  - Complex section breaks, multi-column layouts, embedded OLE objects, and
 *    advanced typography features may still shift.
 *  - Tracked changes / comments are not rendered (they aren't visual content).
 */
import { renderAsync } from 'docx-preview';

export interface DocxRenderOptions {
  /** Render with page breaks + headers + footers. Use true for print, false for in-page preview. */
  forPrint?: boolean;
}

/**
 * Render a DOCX file into the given container. Returns when rendering is done.
 * Throws if the file isn't a valid DOCX or rendering fails.
 */
export async function renderDocx(
  file: File,
  container: HTMLElement,
  styleContainer: HTMLElement | undefined,
  options: DocxRenderOptions = {},
): Promise<void> {
  const { forPrint = false } = options;
  const buf = await file.arrayBuffer();

  await renderAsync(buf, container, styleContainer, {
    // Wrap output in .docx-wrapper for scoped styling
    inWrapper: true,
    // Honor the page width/height specified in the DOCX (paper size, margins)
    ignoreWidth: false,
    ignoreHeight: false,
    // Honor font specifications in the DOCX (we provide @font-face fallbacks
    // for common Microsoft fonts in global.css)
    ignoreFonts: false,
    // Visually break pages for print; continuous scroll for preview
    breakPages: forPrint,
    // Respect Word's "last rendered page break" hints for fidelity to original pagination
    ignoreLastRenderedPageBreak: false,
    // Render every visual chrome element so headers/footers/images survive
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    // Embed images as base64 data URLs so they print reliably (no async load)
    useBase64URL: true,
    // Experimental features include better table column-width handling
    experimental: true,
    // CSS class prefix used inside the wrapper
    className: 'docx',
  });
}

/** Quick check: is this file plausibly a DOCX (zip-based Office format)? */
export async function isDocx(file: File): Promise<boolean> {
  if (!/\.docx$/i.test(file.name)) {
    // Allow MIME-based fallback for files without extension
    if (file.type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return false;
    }
  }
  // DOCX is a zip — magic bytes "PK\x03\x04"
  if (file.size < 4) return false;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}
