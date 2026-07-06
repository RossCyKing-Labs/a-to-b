import { useState } from 'react';
import FileDrop from './FileDrop';
import PendingFilesConfirmation from './PendingFilesConfirmation';
import ResultList from './ui/ResultList';
import DownloadRow from './ui/DownloadRow';
import ErrorText from './ui/ErrorText';
import { isPdf, splitPdfPerPage } from '~/lib/pdfTools';
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
 * Split one PDF into individual single-page PDFs. Each page becomes its
 * own downloadable file.
 */
export default function SplitPdfConverter() {
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const urls = useObjectUrls();
  const task = useAsyncTask();

  const reset = () => {
    urls.revokeAll();
    setOutputs([]);
    setSourceName(null);
    task.reset();
  };

  // Files chosen go into a "pending" queue first — they're not split
  // until the user clicks Confirm. Matches the UX of the other tools.
  const handleSelect = (files: File[]) => {
    if (files.length === 0) return;
    // Split is single-file; if the user dropped multiple, only stage the first.
    setPendingFiles([files[0]]);
    task.reset();
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
      task.fail(`${file.name} is not a PDF.`);
      return;
    }
    setSourceName(file.name);
    const pages = await task.run(() => splitPdfPerPage(file));
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
          disabled={task.status === 'working'}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {task.status === 'working' && sourceName && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Splitting {sourceName}…
        </p>
      )}

      {task.error && <ErrorText>{task.error}</ErrorText>}

      {outputs.length > 0 && (
        <ResultList
          heading={
            <>
              {outputs.length} page{outputs.length === 1 ? '' : 's'} ready
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
