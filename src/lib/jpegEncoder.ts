/**
 * JPEG encoding helpers for the compress pipeline.
 *
 * Two encoders are available:
 *  - mozjpeg via @jsquash/jpeg (WASM, ~200 KB) — produces ~20% smaller files
 *    than the browser's built-in encoder at the same visual quality.
 *  - Canvas fallback — used if @jsquash fails to load or encoding throws.
 */

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
