/**
 * Magic-byte detection for image files.
 *
 * We don't trust the file extension or browser-reported MIME type — both can
 * lie (or be wrong on weird systems). The first few bytes of an image are
 * deterministic, so we read them and decide for ourselves.
 */

export type DetectedImageType = 'png' | 'jpeg' | 'webp' | 'gif' | 'unknown';

export const SUPPORTED_INPUT: readonly DetectedImageType[] = ['png', 'jpeg', 'webp'] as const;

export async function detectImageType(file: File): Promise<DetectedImageType> {
  // 12 bytes is enough to disambiguate every format we care about.
  const head = await file.slice(0, 12).arrayBuffer();
  const b = new Uint8Array(head);

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'jpeg';
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'webp';
  }

  // GIF: "GIF87a" or "GIF89a"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return 'gif';
  }

  return 'unknown';
}
