import { useEffect, useRef, useState } from 'react';
import FileDrop from './FileDrop';
import FormatPicker from './FormatPicker';
import { convertImage, newFilename, type ImageFormat } from '~/lib/imageConvert';
import { detectImageType, SUPPORTED_INPUT, type DetectedImageType } from '~/lib/fileTypes';
import { formatBytes, sizeDelta } from '~/lib/format';

type Status = 'pending' | 'converting' | 'done' | 'error';

interface Item {
  id: string;
  originalName: string;
  originalSize: number;
  status: Status;
  // Filled when status is 'done':
  newName?: string;
  newSize?: number;
  blobUrl?: string;
  // Filled when status is 'error':
  error?: string;
}

export default function ImageConverter() {
  const [format, setFormat] = useState<ImageFormat>('jpeg');
  const [quality, setQuality] = useState(0.85);
  const [items, setItems] = useState<Item[]>([]);

  // Track every blob URL we've ever created so we can revoke them on unmount.
  const blobUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const reset = () => {
    items.forEach((it) => {
      if (it.blobUrl) {
        URL.revokeObjectURL(it.blobUrl);
        blobUrlsRef.current.delete(it.blobUrl);
      }
    });
    setItems([]);
  };

  const handleFiles = async (files: File[]) => {
    // Seed every file as 'pending' so the user sees them appear instantly,
    // then convert sequentially. Sequential keeps memory low for big batches.
    const initial: Item[] = files.map((file) => ({
      id: crypto.randomUUID(),
      originalName: file.name,
      originalSize: file.size,
      status: 'pending',
    }));
    setItems((prev) => [...prev, ...initial]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = initial[i].id;
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'converting' } : it)));

      try {
        const detected: DetectedImageType = await detectImageType(file);
        if (!SUPPORTED_INPUT.includes(detected)) {
          throw new Error(
            detected === 'unknown'
              ? 'Not a recognized image (need PNG, JPEG, or WebP).'
              : `${detected.toUpperCase()} input is not supported yet.`,
          );
        }

        const blob = await convertImage(file, { format, quality });
        const newName = newFilename(file.name, format);
        const blobUrl = URL.createObjectURL(blob);
        blobUrlsRef.current.add(blobUrl);

        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, status: 'done', newName, newSize: blob.size, blobUrl }
              : it,
          ),
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? {
                  ...it,
                  status: 'error',
                  error: err instanceof Error ? err.message : 'Conversion failed.',
                }
              : it,
          ),
        );
      }
    }
  };

  const inProgress = items.filter((it) => it.status === 'pending' || it.status === 'converting').length;
  const doneCount = items.filter((it) => it.status === 'done').length;

  return (
    <div className="space-y-8">
      <FormatPicker
        value={format}
        onChange={setFormat}
        quality={quality}
        onQualityChange={setQuality}
      />

      <FileDrop accept="image/png,image/jpeg,image/webp" multiple onFiles={handleFiles}>
        <p className="mb-2 text-lg font-medium">Drop images here</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          or click to select · PNG · JPEG · WebP · multiple files OK
        </p>
      </FileDrop>

      {items.length > 0 && (
        <section aria-live="polite">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              Results
              <span className="ml-2 text-sm font-normal" style={{ color: 'var(--color-muted)' }}>
                {inProgress > 0
                  ? `· converting ${inProgress}…`
                  : `· ${doneCount} of ${items.length} ready`}
              </span>
            </h2>
            <button
              type="button"
              onClick={reset}
              className="text-sm underline hover:no-underline"
              style={{ color: 'var(--color-muted)' }}
            >
              Clear all
            </button>
          </div>

          <ul className="space-y-2">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-4 rounded-lg border p-3"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {it.status === 'done' ? it.newName : it.originalName}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {it.status === 'pending' && 'Queued…'}
                    {it.status === 'converting' && 'Converting…'}
                    {it.status === 'done' &&
                      it.newSize !== undefined &&
                      `${formatBytes(it.originalSize)} → ${formatBytes(it.newSize)} (${sizeDelta(it.originalSize, it.newSize)})`}
                    {it.status === 'error' && (
                      <span style={{ color: '#dc2626' }}>{it.error}</span>
                    )}
                  </div>
                </div>
                {it.status === 'done' && it.blobUrl && it.newName && (
                  <a
                    href={it.blobUrl}
                    download={it.newName}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
                    style={{ background: 'var(--color-accent)' }}
                  >
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
