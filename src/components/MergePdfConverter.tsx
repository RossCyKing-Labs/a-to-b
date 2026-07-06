import { useState } from 'react';
import FileDrop from './FileDrop';
import ResultList from './ui/ResultList';
import DownloadRow from './ui/DownloadRow';
import ErrorText from './ui/ErrorText';
import PrimaryButton from './ui/PrimaryButton';
import { isPdf, mergePdfs } from '~/lib/pdfTools';
import { formatBytes } from '~/lib/format';
import { useObjectUrls } from '~/lib/useObjectUrls';
import { useAsyncTask } from '~/lib/useAsyncTask';

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
  const urls = useObjectUrls();
  const task = useAsyncTask();

  // Any edit to the input set invalidates a previously-merged result.
  const clearResult = () => {
    if (result) {
      urls.revokeAll();
      setResult(null);
    }
  };

  const addFiles = async (files: File[]) => {
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
      task.fail(`Skipped (not PDFs): ${rejected.join(', ')}`);
    } else {
      task.reset();
    }
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

  const merge = async () => {
    if (inputs.length < 2) return;
    const blob = await task.run(() => mergePdfs(inputs.map((it) => it.file)));
    if (!blob) return;
    urls.revokeAll();
    setResult({ name: 'merged.pdf', size: blob.size, url: urls.track(blob) });
  };

  const reset = () => {
    setInputs([]);
    urls.revokeAll();
    setResult(null);
    task.reset();
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
            <PrimaryButton onClick={merge} disabled={task.status === 'working'} className="mt-4">
              {task.status === 'working' ? 'Merging…' : `Merge ${inputs.length} PDFs`}
            </PrimaryButton>
          )}
        </section>
      )}

      {task.error && <ErrorText>{task.error}</ErrorText>}

      {result && (
        <ResultList heading="Result">
          <DownloadRow
            name={result.name}
            meta={formatBytes(result.size)}
            href={result.url}
            filename={result.name}
          />
        </ResultList>
      )}
    </div>
  );
}
