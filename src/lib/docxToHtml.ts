/**
 * DOCX → HTML conversion via mammoth.js.
 *
 * Mammoth runs entirely in the browser. It parses the DOCX file
 * (which is just a zip of XML), extracts paragraph/heading/list/table
 * structure, and emits clean semantic HTML. It does NOT preserve every
 * Word styling detail (intentionally — Word's formatting model is huge);
 * it focuses on document structure.
 *
 * From here we render the HTML in a print-styled iframe and let the
 * browser produce a real, selectable-text PDF.
 */
import mammoth from 'mammoth';

export interface DocxConversionResult {
  /** Sanitized HTML string ready to inject into a document. */
  html: string;
  /** Non-fatal warnings from mammoth (unsupported styles, image issues, etc.) */
  warnings: string[];
}

/** Style map: tells mammoth how to map Word style names to HTML elements. */
const STYLE_MAP = [
  "p[style-name='Title'] => h1.title",
  "p[style-name='Subtitle'] => h2.subtitle",
  "p[style-name='Heading 1'] => h1",
  "p[style-name='Heading 2'] => h2",
  "p[style-name='Heading 3'] => h3",
  "p[style-name='Heading 4'] => h4",
  "p[style-name='Quote'] => blockquote",
  "p[style-name='Intense Quote'] => blockquote.intense",
  "r[style-name='Strong'] => strong",
  "r[style-name='Emphasis'] => em",
];

export async function docxToHtml(file: File): Promise<DocxConversionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    { styleMap: STYLE_MAP },
  );

  return {
    html: result.value,
    warnings: result.messages.map((m) => m.message),
  };
}

/**
 * The CSS we apply to the rendered HTML when printing.
 * This is what makes the PDF look like a "real" document instead of a webpage.
 */
export const PRINT_STYLESHEET = `
  @page {
    size: letter;
    margin: 1in;
  }

  * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  html, body {
    background: white;
    color: black;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-size: 11pt;
    line-height: 1.5;
    max-width: none;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      'Helvetica Neue', Arial, sans-serif;
    page-break-after: avoid;
    break-after: avoid;
    color: black;
  }

  h1.title { font-size: 26pt; margin: 0 0 4pt 0; }
  h2.subtitle { font-size: 14pt; font-weight: normal; color: #555; margin: 0 0 24pt 0; }
  h1 { font-size: 22pt; margin: 24pt 0 12pt; }
  h2 { font-size: 17pt; margin: 18pt 0 8pt; }
  h3 { font-size: 13pt; margin: 14pt 0 6pt; }
  h4 { font-size: 11pt; margin: 12pt 0 4pt; }

  p {
    margin: 0 0 9pt 0;
    orphans: 3;
    widows: 3;
  }

  ul, ol {
    margin: 0 0 9pt 0;
    padding-left: 24pt;
  }

  li {
    margin-bottom: 3pt;
  }

  blockquote {
    margin: 12pt 24pt;
    padding-left: 12pt;
    border-left: 3pt solid #888;
    color: #333;
    font-style: italic;
  }

  blockquote.intense {
    background: #f5f5f5;
    padding: 12pt;
    border-left: 4pt solid #444;
    font-style: normal;
  }

  table {
    border-collapse: collapse;
    margin: 9pt 0;
    width: 100%;
    page-break-inside: avoid;
  }

  td, th {
    border: 1pt solid #888;
    padding: 5pt 8pt;
    vertical-align: top;
    text-align: left;
  }

  th {
    background: #f0f0f0;
    font-weight: bold;
  }

  img {
    max-width: 100%;
    height: auto;
    page-break-inside: avoid;
  }

  a {
    color: #0a58ca;
    text-decoration: underline;
  }

  pre, code {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 10pt;
    background: #f5f5f5;
  }

  pre {
    padding: 8pt;
    page-break-inside: avoid;
    white-space: pre-wrap;
  }
`;
