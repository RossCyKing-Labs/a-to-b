import { useState } from 'react';
import FileDrop from './FileDrop';
import PendingFilesConfirmation from './PendingFilesConfirmation';
import ResultList from './ui/ResultList';
import DownloadRow from './ui/DownloadRow';
import ErrorText from './ui/ErrorText';
import { isPdf, pdfToJpgs } from '~/lib/pdfTools';
import { formatBytes } from '~/lib/format';
import { useObjectUrls } from '~/lib/useObjectUrls';
import { useAsyncTask } from '~/lib/useAsyncTask';

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
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [quality, setQuality] = useState(0.85);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const urls = useObjectUrls();
  const task = useAsyncTask();

  const reset = () => {
    urls.revokeAll();
    setOutputs([]);
    setSourceName(null);
    task.reset();
  };

  // Files chosen go into a "pending" queue first — they're not rendered
  // until the user clicks Confirm. Lets the user tweak the quality slider
  // after picking the file.
  const handleSelect = (files: File[]) => {
    if (files.length === 0) return;
    setPendingFiles([files[0]]);
    task.reset();
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
      task.fail(`${file.name} is not a PDF.`);
      return;
    }
    setSourceName(file.name);
    const pages = await task.run(() => pdfToJpgs(file, { quality: qualityToUse }));
    if (!pages) return;
    setOutputs(
      pages.map((p) => ({
        id: crypto.randomUUID(),
        name: p.name,
        size: p.blob.size,
        url: urls.track(p.blob),
      })),
    );
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
          disabled={task.status === 'working'}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {task.status === 'working' && sourceName && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Rendering pages from {sourceName}…
        </p>
      )}

      {task.error && <ErrorText>{task.error}</ErrorText>}

      {outputs.length > 0 && (
        <ResultList
          heading={
            <>
              {outputs.length} image{outputs.length === 1 ? '' : 's'} ready
            </>
          }
          onClear={reset}
        >
          {outputs.map((it) => (
            <DownloadRow
              key={it.id}
              name={it.name}
              meta={formatBytes(it.size)}
              href={it.url}
              filename={it.name}
            />
          ))}
        </ResultList>
      )}
    </div>
  );
}
