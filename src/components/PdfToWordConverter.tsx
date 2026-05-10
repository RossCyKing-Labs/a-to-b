import { useEffect, useRef, useState } from 'react';
import FileDrop from './FileDrop';
import { pdfToDocx, type PdfConversionResult } from '~/lib/pdfToDocx';
import { formatBytes } from '~/lib/format';

type Status = 'pending' | 'converting' | 'done' | 'error';

interface PdfItem {
  id: string;
  originalName: string;
  originalSize: number;
  status: Status;
  newName?: string;
  newSize?: number;
  blobUrl?: string;
  pageCount?: number;
  linkCount?: number;
  warnings?: string[];
  error?: string;
}

export default function PdfToWordConverter() {
  const [items, setItems] = useState<PdfItem[]>([]);
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
    const initial: PdfItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      originalName: file.name,
      originalSize: file.size,
      status: 'pending',
    }));
    setItems((prev) => [...prev, ...initial]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = initial[i].id;

      if (!isPdf(file)) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, status: 'error', error: 'Only .pdf files are supported.' }
              : it,
          ),
        );
        continue;
      }

      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'converting' } : it)));

      try {
        const result: PdfConversionResult = await pdfToDocx(file);
        const newName = file.name.replace(/\.pdf$/i, '.docx');
        const blobUrl = URL.createObjectURL(result.blob);
        blobUrlsRef.current.add(blobUrl);

        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? {
                  ...it,
                  status: 'done',
                  newName,
                  newSize: result.blob.size,
                  blobUrl,
                  pageCount: result.pageCount,
                  linkCount: result.linkCount,
                  warnings: result.warnings,
                }
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
      <FileDrop accept="application/pdf,.pdf" multiple onFiles={handleFiles}>
        <p className="mb-2 text-lg font-medium">Drop .pdf files here</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          or click to select · multiple files OK
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
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {it.status === 'done' ? it.newName : it.originalName}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {it.status === 'pending' && 'Queued…'}
                      {it.status === 'converting' && 'Reading PDF…'}
                      {it.status === 'done' && it.newSize !== undefined && (
                        <>
                          {it.pageCount} page{it.pageCount === 1 ? '' : 's'} ·{' '}
                          {formatBytes(it.originalSize)} → {formatBytes(it.newSize)}
                          {it.linkCount && it.linkCount > 0
                            ? ` · ${it.linkCount} link${it.linkCount === 1 ? '' : 's'} preserved`
                            : ''}
                        </>
                      )}
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
                </div>

                {it.warnings && it.warnings.length > 0 && (
                  <div
                    className="mt-2 rounded p-2 text-xs"
                    style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
                  >
                    {it.warnings.map((w, idx) => (
                      <div key={idx}>⚠ {w}</div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function isPdf(file: File): boolean {
  return /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
}
