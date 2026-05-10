/**
 * Image format conversion via Canvas API.
 *
 * Pure browser primitives — zero dependencies, zero WASM.
 * Input: a File. Output: a Blob in the requested format.
 *
 * The browser handles all decode/encode. The file never leaves memory.
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const EXT: Record<ImageFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
};

export interface ConvertOptions {
  format: ImageFormat;
  /** 0–1, only honored for jpeg and webp (lossy formats) */
  quality?: number;
}

/**
 * Convert a single image file to a target format.
 * Throws if the source can't be decoded.
 */
export async function convertImage(file: File, options: ConvertOptions): Promise<Blob> {
  // Decode using the browser's native image decoder. Works for any format the
  // browser supports (PNG/JPEG/WebP, plus GIF/BMP/AVIF in modern browsers).
  const bitmap = await createImageBitmap(file);

  try {
    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas = useOffscreen
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), {
          width: bitmap.width,
          height: bitmap.height,
        });

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get a 2D rendering context.');
    }

    // JPEG has no alpha channel — paint white behind transparent pixels so
    // they don't render as black blocks in the output.
    if (options.format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    }

    ctx.drawImage(bitmap, 0, 0);

    const mime = MIME[options.format];
    const quality = options.format === 'png' ? undefined : options.quality;

    if (canvas instanceof OffscreenCanvas) {
      return await canvas.convertToBlob({ type: mime, quality });
    }

    return await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas conversion failed.'))),
        mime,
        quality,
      );
    });
  } finally {
    bitmap.close();
  }
}

/** Replace (or add) the file extension for a converted file. */
export function newFilename(originalName: string, format: ImageFormat): string {
  const dotIdx = originalName.lastIndexOf('.');
  const stem = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  return `${stem}.${EXT[format]}`;
}
