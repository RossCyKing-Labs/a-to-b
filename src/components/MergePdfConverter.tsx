import { useEffect, useRef, useState } from 'react';
import FileDrop from './FileDrop';
import { isPdf, mergePdfs } from '~/lib/pdfTools';
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

/**
 * Merge N PDFs into one. Supports drag-add, reorder via up/down arrows,
 * remove, and clear. The merge button activates once there are ≥2 inputs.
 */
export default function MergePdfConverter() {
  const [inputs, setInputs] = useState<InputFile[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const addFiles = async (files: File[]) => {
    setError(null);
    const accepted: InputFile[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (await isPdf(file)) {
        accepted.push({ id: crypto.randomUUID(), file });
      } else {
        rejected.push(file.name);
      }
    }
    if (rejected.length) {
      setError(`Skipped (not PDFs): ${rejected.join(', ')}`);
    }
    setInputs((prev) => [...prev, ...accepted]);
    if (result) {
      URL.revokeObjectURL(result.url);
      setResult(null);
    }
  };

  const remove = (id: string) => {
    setInputs((prev) => prev.filter((it) => it.id !== id));
    if (result) {
      URL.revokeObjectURL(result.url);
      setResult(null);
    }
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
    if (result) {
      URL.revokeObjectURL(result.url);
      setResult(null);
    }
  };

  const merge = async () => {
    if (inputs.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await mergePdfs(inputs.map((it) => it.file));
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setResult({ name: 'merged.pdf', size: blob.size, url });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setInputs([]);
    setError(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setResult(null);
  };

  return (
    <div className="space-y-8">
      <FileDrop accept="application/pdf,.pdf" multiple onFiles={addFiles}>
        <p className="mb-2 text-lg font-medium">Drop PDFs here</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          or click to select · drop again to add more files
        </p>
      </FileDrop>

      {inputs.length > 0 && (
        <section aria-live="polite">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              {inputs.length} file{inputs.length === 1 ? '' : 's'} in order
              {inputs.length < 2 && (
                <span
                  className="ml-2 text-sm font-normal"
                  style={{ color: 'var(--color-muted)' }}
                >
                  · add one more to merge
                </span>
              )}
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
                    title="Move up"
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
                    title="Move down"
                    className="rounded border px-2 py-1 text-sm disabled:opacity-30"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(it.id)}
                    aria-label={`Remove ${it.file.name}`}
                    title="Remove"
                    className="rounded border px-2 py-1 text-sm"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {inputs.length >= 2 && !result && (
            <button
              type="button"
              onClick={merge}
              disabled={busy}
              className="mt-4 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--color-accent)' }}
            >
              {busy ? 'Merging…' : `Merge ${inputs.length} PDFs`}
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
