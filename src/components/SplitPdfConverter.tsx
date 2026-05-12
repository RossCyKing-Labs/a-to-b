import { useEffect, useRef, useState } from 'react';
import FileDrop from './FileDrop';
import PendingFilesConfirmation from './PendingFilesConfirmation';
import { isPdf, splitPdfPerPage } from '~/lib/pdfTools';
import { formatBytes } from '~/lib/format';

type Status = 'idle' | 'splitting' | 'done' | 'error';

interface OutputItem {
  id: string;
  name: string;
  size: number;
  url: string;
}

/**
 * Split one PDF into individual single-page PDFs. Each page becomes its
 * own downloadable file.
 */
export default function SplitPdfConverter() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const urlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const reset = () => {
    outputs.forEach((o) => {
      URL.revokeObjectURL(o.url);
      urlsRef.current.delete(o.url);
    });
    setOutputs([]);
    setStatus('idle');
    setError(null);
    setSourceName(null);
  };

  // Files chosen go into a "pending" queue first — they're not split
  // until the user clicks Confirm. Matches the UX of the other tools.
  const handleSelect = (files: File[]) => {
    if (files.length === 0) return;
    // Split is single-file; if the user dropped multiple, only stage the first.
    setPendingFiles([files[0]]);
    setError(null);
  };

  const handleCancel = () => {
    setPendingFiles([]);
  };

  const handleConfirm = async () => {
    if (pendingFiles.length === 0) return;
    const file = pendingFiles[0];
    setPendingFiles([]);
    reset();
    if (!(await isPdf(file))) {
      setError(`${file.name} is not a PDF.`);
      setStatus('error');
      return;
    }
    setSourceName(file.name);
    setStatus('splitting');
    try {
      const pages = await splitPdfPerPage(file);
      const items: OutputItem[] = pages.map((p) => {
        const url = URL.createObjectURL(p.blob);
        urlsRef.current.add(url);
        return { id: crypto.randomUUID(), name: p.name, size: p.blob.size, url };
      });
      setOutputs(items);
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Split failed.');
      setStatus('error');
    }
  };

  return (
    <div className="space-y-8">
      {pendingFiles.length === 0 ? (
        <FileDrop accept="application/pdf,.pdf" multiple={false} onFiles={handleSelect}>
          <p className="mb-2 text-lg font-medium">Drop one PDF here</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            or click to select · each page becomes its own PDF
          </p>
        </FileDrop>
      ) : (
        <PendingFilesConfirmation
          files={pendingFiles}
          verb="split"
          disabled={status === 'splitting'}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {status === 'splitting' && sourceName && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Splitting {sourceName}…
        </p>
      )}

      {error && (
        <p className="text-sm" style={{ color: '#dc2626' }}>
          {error}
        </p>
      )}

      {outputs.length > 0 && (
        <section aria-live="polite">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              {outputs.length} page{outputs.length === 1 ? '' : 's'} ready
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
            {outputs.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-4 rounded-lg border p-3"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.name}</div>
                  <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {formatBytes(it.size)}
                  </div>
                </div>
                <a
                  href={it.url}
                  download={it.name}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
                  style={{ background: 'var(--color-accent)' }}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
