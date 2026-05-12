/**
 * JPEG encoding helpers for the compress pipeline.
 *
 * Two encoders are available:
 *  - mozjpeg via @jsquash/jpeg (WASM, ~200 KB) — produces ~20% smaller files
 *    than the browser's built-in encoder at the same visual quality.
 *  - Canvas fallback — used if @jsquash fails to load or encoding throws.
 *
 * Plus a JPEG quality probe: we can read the DC and AC quantization tables
 * from a JPEG's APP segments and reverse-look-up the approximate "Q" value
 * the source was encoded at. If a source is already <80 quality, recompressing
 * it at 0.72 buys us almost nothing and adds visible artefacts, so we skip
 * it.
 */

/** Approximate quality (0–100) of a JPEG, reverse-engineered from its quantization tables. */
export function probeJpegQuality(jpegBytes: Uint8Array): number | null {
  // Find a DQT marker (FF DB) and read the first quantization table's values.
  // The "standard" JPEG quality formula maps the table to a 0-100 number; we
  // use a simplified version that works well for typical encoder output.
  let i = 0;
  // Skip SOI
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) return null;
  i = 2;

  while (i < jpegBytes.length - 1) {
    if (jpegBytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = jpegBytes[i + 1];
    if (marker === 0xdb) {
      // DQT
      // Pq/Tq byte, then 64 values
      const tableStart = i + 5;
      const precision = (jpegBytes[i + 4] >> 4) & 0x0f; // 0 = 8-bit, 1 = 16-bit
      const bytesPerValue = precision === 0 ? 1 : 2;
      if (tableStart + 64 * bytesPerValue > jpegBytes.length) return null;

      let sum = 0;
      for (let k = 0; k < 64; k++) {
        const v =
          bytesPerValue === 1
            ? jpegBytes[tableStart + k]
            : (jpegBytes[tableStart + k * 2] << 8) |
              jpegBytes[tableStart + k * 2 + 1];
        sum += v;
      }
      const avg = sum / 64;
      // Inverse of the standard IJG quality→table scaling. avg ≈ 1 means Q≈100;
      // avg ≈ 50 means roughly Q≈50; avg ≈ 100+ means very low quality.
      // This formula gives sane outputs across typical encoder ranges.
      if (avg < 1) return 100;
      const q = avg < 50 ? 100 - avg : Math.max(0, Math.round(5000 / avg));
      return Math.max(1, Math.min(100, Math.round(q)));
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI or SOS
    if (marker >= 0xd0 && marker <= 0xd7) {
      i += 2;
      continue;
    }
    // Segment with length follows
    const len = (jpegBytes[i + 2] << 8) | jpegBytes[i + 3];
    i += 2 + len;
  }
  return null;
}

/**
 * Construct an ImageData object from a pixel buffer + dimensions in a way
 * that satisfies TypeScript 5.7+'s stricter generic-buffer typing for
 * Uint8ClampedArray. We create a fresh ImageData and copy the pixels in,
 * which sidesteps the issue of `pixels` being `Uint8ClampedArray<ArrayBufferLike>`
 * (which can in principle wrap a SharedArrayBuffer that ImageData rejects).
 */
function toImageData(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  if (typeof ImageData !== 'undefined') {
    const data = new ImageData(width, height);
    data.data.set(pixels);
    return data;
  }
  return { data: pixels, width, height } as ImageData;
}

/**
 * Encode an RGBA pixel buffer as JPEG. Tries mozjpeg first (smaller files
 * at the same visual quality), falls back to canvas if anything throws.
 *
 * @param pixels   RGBA bytes, length = width*height*4
 * @param width    pixel width
 * @param height   pixel height
 * @param quality  0..100 — internally normalised; defaults to 75
 */
export async function encodeJpeg(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  quality: number,
): Promise<Uint8Array> {
  try {
    const mod = await import('@jsquash/jpeg');
    const imageData = toImageData(pixels, width, height);
    const result = await mod.encode(imageData, {
      quality,
      // mozjpeg-specific knobs that produce smaller files for natural images
      progressive: true,
      optimize_coding: true,
      trellis_multipass: true,
      // 'auto_subsample' is on by default and is what we want
    });
    return new Uint8Array(result);
  } catch (err) {
    // Fall back to canvas encoder if @jsquash isn't available or chokes
    return encodeJpegCanvas(pixels, width, height, quality / 100);
  }
}

/** Fallback: encode via the browser's built-in canvas JPEG encoder. */
async function encodeJpegCanvas(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  qualityFraction: number,
): Promise<Uint8Array> {
  const imageData = toImageData(pixels, width, height);

  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context (OffscreenCanvas).');
    ctx.putImageData(imageData, 0, 0);
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: qualityFraction });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context.');
    ctx.putImageData(imageData, 0, 0);
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
        'image/jpeg',
        qualityFraction,
      ),
    );
  }

  return new Uint8Array(await blob.arrayBuffer());
}
