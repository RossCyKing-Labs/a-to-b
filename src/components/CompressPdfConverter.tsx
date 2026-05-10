import { useEffect, useRef, useState } from 'react';
import FileDrop from './FileDrop';
import { compressPdf, isPdf, type CompressLevel } from '~/lib/pdfTools';
import { formatBytes, sizeDelta } from '~/lib/format';

type Status = 'pending' | 'compressing' | 'done' | 'error';

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

const LEVELS: { id: CompressLevel; label: string; desc: string }[] = [
  { id: 'low', label: 'Light', desc: 'Best quality, modest reduction' },
  { id: 'medium', label: 'Balanced', desc: 'Recommended for most files' },
  { id: 'high', label: 'Strong', desc: 'Smallest file, more visible loss' },
];

/**
 * Compress PDFs by rendering each page to a JPEG and assembling a new PDF.
 * Effective for image-heavy PDFs; modest gains on text-only files.
 *
 * IMPORTANT trade-off (surfaced in the UI): the output's text is rasterized,
 * so it won't be selectable or searchable.
 */
export default function CompressPdfConverter() {
  const [level, setLevel] = useState<CompressLevel>('medium');
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

  const handleFiles = async (files: File[]) => {
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
            it.id === id ? { ...it, status: 'error', error: 'Not a PDF.' } : it,
          ),
        );
        continue;
      }

      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'compressing' } : it)));

      try {
        const blob = await compressPdf(file, level);
        const stem = file.name.replace(/\.pdf$/i, '');
        const newName = `${stem}-compressed.pdf`;
        const url = URL.createObjectURL(blob);
        urlsRef.current.add(url);
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
        Heads up: this converter renders each page to an image, then rebuilds the PDF. That makes
        files significantly smaller for image-heavy PDFs, but <strong>text in the output won't be
        selectable or searchable</strong>. If you need selectable text, skip Compress and use the
        original PDF.
      </div>

      <FileDrop accept="application/pdf,.pdf" multiple onFiles={handleFiles}>
        <p className="mb-2 text-lg font-medium">Drop PDFs here</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          or click to select · multiple files OK
        </p>
      </FileDrop>

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
                  <div className="truncate text-sm font-medium">
                    {it.status === 'done' ? it.newName : it.originalName}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {it.status === 'pending' && 'Queued…'}
                    {it.status === 'compressing' && 'Compressing…'}
                    {it.status === 'done' &&
                      it.newSize !== undefined &&
                      `${formatBytes(it.originalSize)} → ${formatBytes(it.newSize)} (${sizeDelta(it.originalSize, it.newSize)})`}
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
