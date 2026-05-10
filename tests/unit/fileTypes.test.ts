import { describe, expect, it } from 'vitest';
import { detectImageType, SUPPORTED_INPUT } from '~/lib/fileTypes';

/** Helper: build a File from a header byte array — pads with zeros to 12 bytes. */
function fileWithHeader(header: number[], name = 'sample.bin'): File {
  const bytes = new Uint8Array(12);
  bytes.set(header.slice(0, 12));
  return new File([bytes], name, { type: 'application/octet-stream' });
}

describe('detectImageType', () => {
  it('detects PNG by magic bytes', async () => {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const file = fileWithHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await detectImageType(file)).toBe('png');
  });

  it('detects JPEG by magic bytes', async () => {
    // JPEG: FF D8 FF E0 (JFIF) or FF D8 FF E1 (Exif)
    const file = fileWithHeader([0xff, 0xd8, 0xff, 0xe0]);
    expect(await detectImageType(file)).toBe('jpeg');
  });

  it('detects WebP by magic bytes', async () => {
    // WebP: "RIFF" .... "WEBP"
    const file = fileWithHeader([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x00, 0x00, 0x00, 0x00, // size placeholder
      0x57, 0x45, 0x42, 0x50, // "WEBP"
    ]);
    expect(await detectImageType(file)).toBe('webp');
  });

  it('detects GIF by magic bytes', async () => {
    // GIF: "GIF87a" or "GIF89a"
    const file = fileWithHeader([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(await detectImageType(file)).toBe('gif');
  });

  it('returns "unknown" for unrecognized headers', async () => {
    const file = fileWithHeader([0x00, 0x01, 0x02, 0x03]);
    expect(await detectImageType(file)).toBe('unknown');
  });

  it('returns "unknown" for plain text', async () => {
    const file = new File(['hello world'], 'sample.txt', { type: 'text/plain' });
    expect(await detectImageType(file)).toBe('unknown');
  });

  it('exposes a list of supported input formats', () => {
    expect(SUPPORTED_INPUT).toContain('png');
    expect(SUPPORTED_INPUT).toContain('jpeg');
    expect(SUPPORTED_INPUT).toContain('webp');
    // GIF is detected but not yet supported as an input
    expect(SUPPORTED_INPUT).not.toContain('gif');
  });
});
