import { useState } from 'react';
import FileDrop from './FileDrop';
import FormatPicker from './FormatPicker';
import PendingFilesConfirmation from './PendingFilesConfirmation';
import ResultList from './ui/ResultList';
import DownloadRow from './ui/DownloadRow';
import ErrorText from './ui/ErrorText';
import { convertImage, newFilename, type ImageFormat } from '~/lib/imageConvert';
import { detectImageType, SUPPORTED_INPUT, type DetectedImageType } from '~/lib/fileTypes';
import { formatBytes, sizeDelta } from '~/lib/format';
import { useObjectUrls } from '~/lib/useObjectUrls';

const FORMAT_LABEL: Record<ImageFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WEBP',
};

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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const urls = useObjectUrls();

  const reset = () => {
    urls.revokeAll();
    setItems([]);
  };

  // Files dropped or selected go into a "pending" queue first — they're
  // not converted until the user clicks Confirm. This lets the user change
  // the target format / quality after picking, and matches the UX of the
  // other tools.
  const handleSelect = (files: File[]) => {
    if (files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...files]);
  };

  const handleCancel = () => {
    setPendingFiles([]);
  };

  const handleConfirm = async () => {
    if (pendingFiles.length === 0) return;
    // Snapshot format + quality at confirm time so changing the radio
    // afterwards doesn't affect already-queued files.
    const fmtToUse = format;
    const qualityToUse = quality;
    const files = pendingFiles;
    setPendingFiles([]);
    await convertFiles(files, fmtToUse, qualityToUse);
  };

  const convertFiles = async (
    files: File[],
    fmtToUse: ImageFormat,
    qualityToUse: number,
  ) => {
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

        const blob = await convertImage(file, { format: fmtToUse, quality: qualityToUse });
        const newName = newFilename(file.name, fmtToUse);
        const blobUrl = urls.track(blob);

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

      {pendingFiles.length === 0 ? (
        <FileDrop accept="image/png,image/jpeg,image/webp" multiple onFiles={handleSelect}>
          <p className="mb-2 text-lg font-medium">Drop images here</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            or click to select · PNG · JPEG · WebP · multiple files OK
          </p>
        </FileDrop>
      ) : (
        <PendingFilesConfirmation
          files={pendingFiles}
          verb="convert"
          badge={`→ ${FORMAT_LABEL[format]}`}
          hint="Change the target format above before confirming if you want a different one."
          disabled={inProgress > 0}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {items.length > 0 && (
        <ResultList
          heading={
            <>
              Results
              <span className="ml-2 text-sm font-normal" style={{ color: 'var(--color-muted)' }}>
                {inProgress > 0
                  ? `· converting ${inProgress}…`
                  : `· ${doneCount} of ${items.length} ready`}
              </span>
            </>
          }
          onClear={reset}
        >
          {items.map((it) => (
            <DownloadRow
              key={it.id}
              name={it.status === 'done' ? (it.newName ?? it.originalName) : it.originalName}
              meta={
                <>
                  {it.status === 'pending' && 'Queued…'}
                  {it.status === 'converting' && 'Converting…'}
                  {it.status === 'done' &&
                    it.newSize !== undefined &&
                    `${formatBytes(it.originalSize)} → ${formatBytes(it.newSize)} (${sizeDelta(it.originalSize, it.newSize)})`}
                  {it.status === 'error' && <ErrorText inline>{it.error}</ErrorText>}
                </>
              }
              href={it.status === 'done' ? it.blobUrl : undefined}
              filename={it.status === 'done' ? it.newName : undefined}
            />
          ))}
        </ResultList>
      )}
    </div>
  );
}
