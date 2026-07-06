import { useState } from 'react';
import FileDrop from './FileDrop';
import PendingFilesConfirmation from './PendingFilesConfirmation';
import ResultList from './ui/ResultList';
import DownloadRow from './ui/DownloadRow';
import ErrorText from './ui/ErrorText';
import { isPdf, rotatePdf, type RotationDegrees } from '~/lib/pdfTools';
import { formatBytes } from '~/lib/format';
import { useObjectUrls } from '~/lib/useObjectUrls';

type Status = 'pending' | 'rotating' | 'done' | 'error';

interface Item {
  id: string;
  originalName: string;
  originalSize: number;
  status: Status;
  newName?: string;
  newSize?: number;
  url?: string;
  error?: string;
}

const ROTATIONS: { value: RotationDegrees; label: string }[] = [
  { value: 90, label: '90° right' },
  { value: 180, label: '180°' },
  { value: 270, label: '90° left' },
];

/**
 * Rotate every page of one or more PDFs by 90/180/270 degrees.
 */
export default function RotatePdfConverter() {
  const [rotation, setRotation] = useState<RotationDegrees>(90);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const urls = useObjectUrls();

  const reset = () => {
    urls.revokeAll();
    setItems([]);
  };

  // Files chosen go into a "pending" queue first — they're not rotated
  // until the user clicks Confirm. Lets the user pick the rotation angle
  // after staging the files.
  const handleSelect = (files: File[]) => {
    if (files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...files]);
  };

  const handleCancel = () => {
    setPendingFiles([]);
  };

  const handleConfirm = async () => {
    if (pendingFiles.length === 0) return;
    // Snapshot rotation at confirm time so changing the radio later
    // doesn't affect already-queued files.
    const rotationToUse = rotation;
    const files = pendingFiles;
    setPendingFiles([]);
    await rotateFiles(files, rotationToUse);
  };

  const rotateFiles = async (files: File[], rotationToUse: RotationDegrees) => {
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

      if (!(await isPdf(file))) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, status: 'error', error: 'Not a PDF.' }
              : it,
          ),
        );
        continue;
      }

      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'rotating' } : it)));

      try {
        const blob = await rotatePdf(file, rotationToUse);
        const stem = file.name.replace(/\.pdf$/i, '');
        const newName = `${stem}-rotated-${rotationToUse}.pdf`;
        const url = urls.track(blob);
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, status: 'done', newName, newSize: blob.size, url }
              : it,
          ),
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, status: 'error', error: e instanceof Error ? e.message : 'Rotation failed.' }
              : it,
          ),
        );
      }
    }
  };

  const rotationLabel = ROTATIONS.find((r) => r.value === rotation)?.label ?? `${rotation}°`;

  const inProgress = items.filter(
    (it) => it.status === 'pending' || it.status === 'rotating',
  ).length;
  const doneCount = items.filter((it) => it.status === 'done').length;

  return (
    <div className="space-y-8">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Rotation</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {ROTATIONS.map((r) => {
            const selected = rotation === r.value;
            const id = `rot-${r.value}`;
            return (
              <label
                key={r.value}
                htmlFor={id}
                className="block cursor-pointer rounded-lg border p-3 text-center transition"
                style={{
                  borderColor: selected ? 'var(--color-accent)' : 'var(--color-border)',
                  background: selected ? 'var(--color-accent-soft)' : 'transparent',
                }}
              >
                <input
                  id={id}
                  type="radio"
                  name="rotation"
                  value={r.value}
                  className="sr-only"
                  checked={selected}
                  onChange={() => setRotation(r.value)}
                />
                <span className="text-sm font-medium">{r.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {pendingFiles.length === 0 ? (
        <FileDrop accept="application/pdf,.pdf" multiple onFiles={handleSelect}>
          <p className="mb-2 text-lg font-medium">Drop PDFs here</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            or click to select · multiple files OK
          </p>
        </FileDrop>
      ) : (
        <PendingFilesConfirmation
          files={pendingFiles}
          verb="rotate"
          badge={rotationLabel}
          hint="Change the rotation above before confirming if you want a different angle."
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
              <span
                className="ml-2 text-sm font-normal"
                style={{ color: 'var(--color-muted)' }}
              >
                {inProgress > 0
                  ? `· rotating ${inProgress}…`
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
                  {it.status === 'rotating' && 'Rotating…'}
                  {it.status === 'done' && it.newSize !== undefined && formatBytes(it.newSize)}
                  {it.status === 'error' && <ErrorText inline>{it.error}</ErrorText>}
                </>
              }
              href={it.status === 'done' ? it.url : undefined}
              filename={it.status === 'done' ? it.newName : undefined}
            />
          ))}
        </ResultList>
      )}
    </div>
  );
}
