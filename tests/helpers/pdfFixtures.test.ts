import { describe, expect, it } from 'vitest';
import { makeImagePdf, makeMixedPdf, makeTextPdf } from '../helpers/pdfFixtures';

/**
 * Sanity checks for the synthetic PDF fixtures. We only assert the
 * structural invariants the benchmarks rely on: real PDF bytes come out,
 * and the image path inflates size well beyond the text path. Small page
 * counts keep this fast.
 */

/** The five bytes every PDF starts with: "%PDF-". */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

function startsWithPdfHeader(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

describe('pdf fixtures', () => {
  it('makeTextPdf produces a valid, non-empty PDF', async () => {
    const bytes = await makeTextPdf(3);
    expect(bytes.length).toBeGreaterThan(0);
    expect(startsWithPdfHeader(bytes)).toBe(true);
  });

  it('makeImagePdf produces a valid, non-empty PDF', async () => {
    const bytes = await makeImagePdf(3);
    expect(bytes.length).toBeGreaterThan(0);
    expect(startsWithPdfHeader(bytes)).toBe(true);
  });

  it('makeMixedPdf produces a valid, non-empty PDF', async () => {
    const bytes = await makeMixedPdf(3);
    expect(bytes.length).toBeGreaterThan(0);
    expect(startsWithPdfHeader(bytes)).toBe(true);
  });

  it('image fixtures are substantially larger than text fixtures', async () => {
    const text = await makeTextPdf(3);
    const image = await makeImagePdf(3);
    // The embedded JPEG per page should dwarf the plain-text baseline.
    expect(image.length).toBeGreaterThan(text.length * 5);
  });
});
