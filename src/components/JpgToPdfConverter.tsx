import { useEffect, useRef, useState } from 'react';
import FileDrop from './FileDrop';
import {
  imagesToPdf,
  isJpegOrPng,
  type PageOrientation,
  type PageSize,
} from '~/lib/pdfTools';
import { formatBytes } from '~/lib/format';

interface InputFile {
  id: string;
  file: File;
}

interface Result {
  name: string;
  size: number;
  url: string;
}

const PAGE_SIZES: { id: PageSize; label: string; desc: string }[] = [
  { id: 'A4', label: 'A4', desc: '210 × 297 mm' },
  { id: 'Letter', label: 'Letter', desc: '8.5 × 11 in' },
  { id: 'Auto', label: 'Fit image', desc: 'Page matches image size' },
];

const ORIENTATIONS: { id: PageOrientation; label: string }[] = [
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' },
];

/**
 * Combine JPG/PNG images into a single PDF, with selectable page size and
 * orientation. Images are scaled to fit, preserving aspect ratio.
 */
export default function JpgToPdfConverter() {
  const [inputs, setInputs] = useState<InputFile[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>('A4');
  const [orientation, setOrientation] = useState<PageOrientation>('portrait');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const clearResult = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setResult(null);
  };

  const addFiles = async (files: File[]) => {
    setError(null);
    const accepted: InputFile[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (await isJpegOrPng(file)) {
        accepted.push({ id: crypto.randomUUID(), file });
      } else {
        rejected.push(file.name);
      }
    }
    if (rejected.length) setError(`Skipped (need JPEG or PNG): ${rejected.join(', ')}`);
    setInputs((prev) => [...prev, ...accepted]);
    clearResult();
  };

  const remove = (id: string) => {
    setInputs((prev) => prev.filter((it) => it.id !== id));
    clearResult();
  };

  const move = (id: string, direction: -1 | 1) => {
    setInputs((prev) => {
      const idx = prev.findIndex((it) => it.id === id);
      const newIdx = idx + direction;
      if (idx === -1 || newIdx < 0 || newIdx >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
    clearResult();
  };

  const convert = async () => {
    if (inputs.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await imagesToPdf(
        inputs.map((it) => it.file),
        pageSize,
        orientation,
      );
      clearResult();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setResult({ name: 'images.pdf', size: blob.size, url });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setInputs([]);
    setError(null);
    clearResult();
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Page size</legend>
          <div className="space-y-1">
            {PAGE_SIZES.map((s) => {
              const selected = pageSize === s.id;
              const id = `size-${s.id}`;
              return (
                <label
                  key={s.id}
                  htmlFor={id}
                  className="block cursor-pointer rounded-lg border p-2 transition"
                  style={{
                    borderColor: selected ? 'var(--color-accent)' : 'var(--color-border)',
                    background: selected ? 'var(--color-accent-soft)' : 'transparent',
                  }}
                >
                  <input
                    id={id}
                    type="radio"
                    name="page-size"
                    value={s.id}
                    className="sr-only"
                    checked={selected}
                    onChange={() => {
                      setPageSize(s.id);
                      clearResult();
                    }}
                  />
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="ml-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    {s.desc}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Orientation</legend>
          <div className="space-y-1">
            {ORIENTATIONS.map((o) => {
              const selected = orientation === o.id;
              const disabled = pageSize === 'Auto';
              const id = `orient-${o.id}`;
              return (
                <label
                  key={o.id}
                  htmlFor={id}
                  className="block cursor-pointer rounded-lg border p-2 transition"
                  style={{
                    borderColor: selected ? 'var(--color-accent)' : 'var(--color-border)',
                    background: selected ? 'var(--color-accent-soft)' : 'transparent',
                    opacity: disabled ? 0.4 : 1,
                  }}
                >
                  <input
                    id={id}
                    type="radio"
                    name="orientation"
                    value={o.id}
                    className="sr-only"
                    checked={selected}
                    disabled={disabled}
                    onChange={() => {
                      setOrientation(o.id);
                      clearResult();
                    }}
                  />
                  <span className="text-sm font-medium">{o.label}</span>
                </label>
              );
            })}
          </div>
          {pageSize === 'Auto' && (
            <p className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
              Orientation is automatic when fitting to image size.
            </p>
          )}
        </fieldset>
      </div>

      <FileDrop accept="image/jpeg,image/png" multiple onFiles={addFiles}>
        <p className="mb-2 text-lg font-medium">Drop images here</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          or click to select · JPEG or PNG · drop again to add more
        </p>
      </FileDrop>

      {inputs.length > 0 && (
        <section aria-live="polite">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              {inputs.length} image{inputs.length === 1 ? '' : 's'} in order
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
            {inputs.map((it, idx) => (
              <li
                key={it.id}
                className="flex items-center gap-3 rounded-lg border p-3"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <span
                  className="w-6 text-center font-mono text-xs"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.file.name}</div>
                  <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {formatBytes(it.file.size)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(it.id, -1)}
                    disabled={idx === 0}
                    aria-label="Move up"
                    className="rounded border px-2 py-1 text-sm disabled:opacity-30"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(it.id, 1)}
                    disabled={idx === inputs.length - 1}
                    aria-label="Move down"
                    className="rounded border px-2 py-1 text-sm disabled:opacity-30"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(it.id)}
                    aria-label={`Remove ${it.file.name}`}
                    className="rounded border px-2 py-1 text-sm"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!result && (
            <button
              type="button"
              onClick={convert}
              disabled={busy}
              className="mt-4 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--color-accent)' }}
            >
              {busy
                ? 'Building PDF…'
                : `Build PDF from ${inputs.length} image${inputs.length === 1 ? '' : 's'}`}
            </button>
          )}
        </section>
      )}

      {error && (
        <p className="text-sm" style={{ color: '#dc2626' }}>
          {error}
        </p>
      )}

      {result && (
        <section>
          <h2 className="mb-2 font-semibold">Result</h2>
          <div
            className="flex items-center justify-between gap-4 rounded-lg border p-3"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{result.name}</div>
              <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {formatBytes(result.size)}
              </div>
            </div>
            <a
              href={result.url}
              download={result.name}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
              style={{ background: 'var(--color-accent)' }}
            >
              Download
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
