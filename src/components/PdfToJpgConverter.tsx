import { useEffect, useRef, useState } from 'react';
import FileDrop from './FileDrop';
import PendingFilesConfirmation from './PendingFilesConfirmation';
import { isPdf, pdfToJpgs } from '~/lib/pdfTools';
import { formatBytes } from '~/lib/format';

type Status = 'idle' | 'rendering' | 'done' | 'error';

interface OutputItem {
  id: string;
  name: string;
  size: number;
  url: string;
}

/**
 * Render each page of a PDF as a JPG. Quality slider tunes output size /
 * fidelity. Each rendered page is downloadable individually.
 */
export default function PdfToJpgConverter() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [quality, setQuality] = useState(0.85);
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

  // Files chosen go into a "pending" queue first — they're not rendered
  // until the user clicks Confirm. Lets the user tweak the quality slider
  // after picking the file.
  const handleSelect = (files: File[]) => {
    if (files.length === 0) return;
    setPendingFiles([files[0]]);
    setError(null);
  };

  const handleCancel = () => {
    setPendingFiles([]);
  };

  const handleConfirm = async () => {
    if (pendingFiles.length === 0) return;
    const file = pendingFiles[0];
    // Snapshot quality at confirm time
    const qualityToUse = quality;
    setPendingFiles([]);
    reset();
    if (!(await isPdf(file))) {
      setError(`${file.name} is not a PDF.`);
      setStatus('error');
      return;
    }
    setSourceName(file.name);
    setStatus('rendering');
    try {
      const pages = await pdfToJpgs(file, { quality: qualityToUse });
      const items: OutputItem[] = pages.map((p) => {
        const url = URL.createObjectURL(p.blob);
        urlsRef.current.add(url);
        return { id: crypto.randomUUID(), name: p.name, size: p.blob.size, url };
      });
      setOutputs(items);
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Render failed.');
      setStatus('error');
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <label
          htmlFor="quality"
          className="flex items-center justify-between text-sm font-medium"
        >
          <span>JPEG quality</span>
          <span style={{ color: 'var(--color-muted)' }}>{Math.round(quality * 100)}%</span>
        </label>
        <input
          id="quality"
          type="range"
          min="0.3"
          max="1"
          step="0.05"
          value={quality}
          onChange={(e) => setQuality(parseFloat(e.target.value))}
          className="mt-2 w-full"
          style={{ accentColor: 'var(--color-accent)' }}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
          Higher = larger files, sharper images. 85% is a good default.
        </p>
      </div>

      {pendingFiles.length === 0 ? (
        <FileDrop accept="application/pdf,.pdf" multiple={false} onFiles={handleSelect}>
          <p className="mb-2 text-lg font-medium">Drop one PDF here</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            or click to select · each page renders as a separate JPG
          </p>
        </FileDrop>
      ) : (
        <PendingFilesConfirmation
          files={pendingFiles}
          verb="convert"
          badge={`${Math.round(quality * 100)}% quality`}
          hint="Adjust the quality slider above before confirming if you want a different output."
          disabled={status === 'rendering'}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {status === 'rendering' && sourceName && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Rendering pages from {sourceName}…
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
              {outputs.length} image{outputs.length === 1 ? '' : 's'} ready
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
