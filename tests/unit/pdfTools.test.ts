import { describe, expect, it } from 'vitest';
import { isJpegOrPng, isPdf } from '~/lib/pdfTools';

/**
 * Magic-byte detection for the Phase 5 PDF tools. The heavyweight pdf-lib
 * and pdf.js operations are covered by E2E tests; here we just lock down
 * the lightweight format-detection helpers.
 */

function fileFromBytes(bytes: number[], name = 'sample.bin', type = 'application/octet-stream') {
  const buf = new Uint8Array(bytes);
  return new File([buf], name, { type });
}

describe('isPdf', () => {
  it('returns true for a "%PDF-" header', async () => {
    const file = fileFromBytes(
      [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37],
      'doc.pdf',
      'application/pdf',
    );
    expect(await isPdf(file)).toBe(true);
  });

  it('returns false for non-PDF bytes even with a .pdf extension', async () => {
    const file = fileFromBytes([0x00, 0x01, 0x02, 0x03, 0x04], 'fake.pdf');
    expect(await isPdf(file)).toBe(false);
  });

  it('returns false for a tiny file that cannot fit the header', async () => {
    const file = fileFromBytes([0x25, 0x50, 0x44], 'short.pdf');
    expect(await isPdf(file)).toBe(false);
  });

  it('returns false for plain text', async () => {
    const file = new File(['hello world'], 'note.txt', { type: 'text/plain' });
    expect(await isPdf(file)).toBe(false);
  });
});

describe('isJpegOrPng', () => {
  it('detects JPEG by FF D8 FF magic bytes', async () => {
    const file = fileFromBytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
    expect(await isJpegOrPng(file)).toBe('jpeg');
  });

  it('detects PNG by 89 50 4E 47 magic bytes', async () => {
    const file = fileFromBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await isJpegOrPng(file)).toBe('png');
  });

  it('returns null for WebP', async () => {
    // RIFF .... WEBP — valid image but not accepted by JPG→PDF
    const file = fileFromBytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]);
    expect(await isJpegOrPng(file)).toBe(null);
  });

  it('returns null for plain text', async () => {
    const file = new File(['hello'], 'note.txt');
    expect(await isJpegOrPng(file)).toBe(null);
  });
});
