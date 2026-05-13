import { useEffect, useRef, useState } from 'react';
import FileDrop from './FileDrop';
import PendingFilesConfirmation from './PendingFilesConfirmation';
import { compressPdf, isPdf, type CompressLevel } from '~/lib/pdfTools';
import { formatBytes, sizeDelta } from '~/lib/format';

type Status = 'pending' | 'compressing' | 'done' | 'error';

interface Item {
  id: string;
  originalName: string;
  originalSize: number;
  /** Which compression level produced this row's output. */
  level: CompressLevel;
  status: Status;
  newName?: string;
  newSize?: number;
  url?: string;
  note?: string;
  error?: string;
}

const LEVELS: { id: CompressLevel; label: string; desc: string }[] = [
  { id: 'low', label: 'Light', desc: 'Best quality, modest reduction' },
  { id: 'medium', label: 'Balanced', desc: 'Recommended for most files' },
  {
    id: 'high',
    label: 'Strong',
    desc: 'Smallest file — pages flatten to images, text stays selectable',
  },
];

function levelLabel(level: CompressLevel): string {
  return LEVELS.find((l) => l.id === level)?.label ?? level;
}

/**
 * Compress PDFs by recompressing embedded JPEG images at lower quality and
 * downscaling oversized images. Text content, vector graphics, and structure
 * stay untouched — output text remains selectable and searchable.
 *
 * Effective for image-heavy PDFs (scans, photo-heavy docs). Text-only PDFs
 * see minimal change (there's nothing to recompress).
 *
 * UX flow: drop/pick → review queued files in a confirmation panel → confirm
 * to start compression (or cancel to drop the selection). This lets a user
 * change the compression level after picking files without accidentally
 * starting at the wrong setting.
 */
export default function CompressPdfConverter() {
  const [level, setLevel] = useState<CompressLevel>('medium');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const urlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const reset = () => {
    items.forEach((it) => {
      if (it.url) {
        URL.revokeObjectURL(it.url);
        urlsRef.current.delete(it.url);
      }
    });
    setItems([]);
  };

  // Called when files are dropped or chosen — instead of starting work,
  // we stage them in pendingFiles and show the confirmation panel.
  const handleSelect = (files: File[]) => {
    if (files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...files]);
  };

  const handleCancel = () => {
    setPendingFiles([]);
  };

  const handleConfirm = async () => {
    if (pendingFiles.length === 0) return;
    // Capture the level at confirm time so changing the radio later
    // doesn't affect already-queued files.
    const levelToUse = level;
    const files = pendingFiles;
    setPendingFiles([]);
    await compressFiles(files, levelToUse);
  };

  const compressFiles = async (files: File[], levelToUse: CompressLevel) => {
    const initial: Item[] = files.map((file) => ({
      id: crypto.randomUUID(),
      originalName: file.name,
      originalSize: file.size,
      level: levelToUse,
      status: 'pending',
    }));
    setItems((prev) => [...prev, ...initial]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = initial[i].id;

      if (!(await isPdf(file))) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id ? { ...it, status: 'error', error: 'Not a PDF.' } : it,
          ),
        );
        continue;
      }

      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'compressing' } : it)));

      try {
        const result = await compressPdf(file, levelToUse);
        const stem = file.name.replace(/\.pdf$/i, '');
        const newName = result.smallerThanOriginal
          ? `${stem}-compressed.pdf`
          : `${stem}.pdf`;
        const url = URL.createObjectURL(result.blob);
        urlsRef.current.add(url);
        // Compose a one-line breakdown of what we did.
        const noteParts: string[] = [];
        if (result.smallerThanOriginal) {
          if (result.strategy === 'rasterize') {
            noteParts.push(
              `${result.pagesRasterized} page${result.pagesRasterized === 1 ? '' : 's'} flattened`,
            );
            if (result.qpdfPassRan && result.qpdfHelped) {
              noteParts.push('qpdf saved more');
            }
          } else {
            if (result.imagesRecompressed > 0) {
              noteParts.push(
                `${result.imagesRecompressed} image${result.imagesRecompressed === 1 ? '' : 's'} recompressed`,
              );
            }
            if (result.qpdfPassRan) {
              noteParts.push(result.qpdfHelped ? 'qpdf saved more' : 'qpdf ran');
            } else if (noteParts.length === 0) {
              // No images, no qpdf — must've been bloat removal alone.
              noteParts.push('repacked');
            }
          }
        } else {
          noteParts.push('Already optimal — original returned');
        }
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? {
                  ...it,
                  status: 'done',
                  newName,
                  newSize: result.blob.size,
                  url,
                  note: noteParts.join(' · '),
                }
              : it,
          ),
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, status: 'error', error: e instanceof Error ? e.message : 'Compression failed.' }
              : it,
          ),
        );
      }
    }
  };

  const inProgress = items.filter(
    (it) => it.status === 'pending' || it.status === 'compressing',
  ).length;
  const doneCount = items.filter((it) => it.status === 'done').length;
  const compressing = inProgress > 0;

  return (
    <div className="space-y-8">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Compression level</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {LEVELS.map((lvl) => {
            const selected = level === lvl.id;
            const id = `lvl-${lvl.id}`;
            return (
              <label
                key={lvl.id}
                htmlFor={id}
                className="block cursor-pointer rounded-lg border p-3 transition"
                style={{
                  borderColor: selected ? 'var(--color-accent)' : 'var(--color-border)',
                  background: selected ? 'var(--color-accent-soft)' : 'transparent',
                }}
              >
                <input
                  id={id}
                  type="radio"
                  name="level"
                  value={lvl.id}
                  className="sr-only"
                  checked={selected}
                  onChange={() => setLevel(lvl.id)}
                />
                <div className="text-sm font-medium">{lvl.label}</div>
                <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {lvl.desc}
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div
        className="rounded-lg border p-3 text-xs leading-relaxed"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
      >
        <strong>Light</strong> and <strong>Balanced</strong> recompress embedded images and
        repack the PDF structure — text, fonts, form fields, and bookmarks all preserved.
        <br />
        <strong>Strong</strong> goes much further: pages are flattened to images with an
        invisible text layer for selection. Form fields, bookmarks, annotations, and
        accessibility tags are dropped — but you can typically expect 80–90% smaller files.
      </div>

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
          verb="compress"
          badge={levelLabel(level)}
          hint="Change the level above before confirming if you want a different setting."
          disabled={compressing}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {items.length > 0 && (
        <section aria-live="polite">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              Results
              <span
                className="ml-2 text-sm font-normal"
                style={{ color: 'var(--color-muted)' }}
              >
                {inProgress > 0
                  ? `· compressing ${inProgress}…`
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {it.status === 'done' ? it.newName : it.originalName}
                    </span>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                      style={{
                        background: 'var(--color-accent-soft)',
                        color: 'var(--color-accent)',
                      }}
                      title={`Compressed at ${levelLabel(it.level)} preset`}
                    >
                      {levelLabel(it.level)}
                    </span>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {it.status === 'pending' && 'Queued…'}
                    {it.status === 'compressing' &&
                      (it.level === 'high' ? 'Flattening pages…' : 'Recompressing images…')}
                    {it.status === 'done' && it.newSize !== undefined && (
                      <>
                        {formatBytes(it.originalSize)} → {formatBytes(it.newSize)} (
                        {sizeDelta(it.originalSize, it.newSize)})
                        {it.note && <span> · {it.note}</span>}
                      </>
                    )}
                    {it.status === 'error' && <span style={{ color: '#dc2626' }}>{it.error}</span>}
                  </div>
                </div>
                {it.status === 'done' && it.url && it.newName && (
                  <a
                    href={it.url}
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
