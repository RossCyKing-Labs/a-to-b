import { useState } from 'react';
import FileDrop from './FileDrop';
import PendingFilesConfirmation from './PendingFilesConfirmation';
import ResultList from './ui/ResultList';
import DownloadRow from './ui/DownloadRow';
import ErrorText from './ui/ErrorText';
import { isPdf, type CompressLevel } from '~/lib/pdfTools';
import { compressToTargetSmart, compressByLevelSmart } from '~/lib/compressClient';
import { formatBytes, sizeDelta } from '~/lib/format';
import { useObjectUrls } from '~/lib/useObjectUrls';

type Mode = 'target' | 'level';
type Status = 'pending' | 'compressing' | 'done' | 'error';

interface Item {
  id: string;
  originalName: string;
  originalSize: number;
  /** Short label of the setting used, shown as a pill (e.g. "≤ 2 MB", "Balanced"). */
  badge: string;
  status: Status;
  /** Live progress message while status is 'compressing'. */
  progress?: string;
  newName?: string;
  newSize?: number;
  url?: string;
  note?: string;
  /** Target mode only: did the output land under the requested size? */
  metTarget?: boolean;
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

// Common upload limits people run into (job-application forms, email, portals).
const TARGET_PRESETS: { id: string; mb: number; label: string }[] = [
  { id: '1', mb: 1, label: '1 MB' },
  { id: '2', mb: 2, label: '2 MB' },
  { id: '5', mb: 5, label: '5 MB' },
];

function levelLabel(level: CompressLevel): string {
  return LEVELS.find((l) => l.id === level)?.label ?? level;
}

/**
 * Compress PDFs. Two modes:
 *
 *  - Target size (default): "get this under 2 MB" — the tool searches DPI ×
 *    JPEG quality for the sharpest page-rasterized output that fits the size
 *    limit. This is the demand-shaped path: most people are trying to clear an
 *    upload limit (job applications, forms, email attachments).
 *
 *  - By level: the classic Light / Balanced / Strong presets, for when the
 *    user wants to trade quality directly rather than name a size.
 *
 * UX flow in both: drop/pick → review queued files in a confirmation panel →
 * confirm to start (or cancel). Settings are snapshotted at confirm time.
 */
export default function CompressPdfConverter() {
  const [mode, setMode] = useState<Mode>('target');
  const [level, setLevel] = useState<CompressLevel>('medium');
  const [targetChoice, setTargetChoice] = useState<string>('2');
  const [customMb, setCustomMb] = useState<number>(2);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const urls = useObjectUrls();

  const targetMb = targetChoice === 'custom' ? customMb : Number(targetChoice);
  const targetBytes = Math.round(targetMb * 1024 * 1024);
  const targetLabel = `${targetMb} MB`;
  const targetValid = mode !== 'target' || (targetMb > 0 && Number.isFinite(targetMb));

  const reset = () => {
    urls.revokeAll();
    setItems([]);
  };

  const handleSelect = (files: File[]) => {
    if (files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...files]);
  };

  const handleCancel = () => {
    setPendingFiles([]);
  };

  const handleConfirm = async () => {
    if (pendingFiles.length === 0 || !targetValid) return;
    // Snapshot settings at confirm time so changing controls afterwards
    // doesn't affect already-queued files.
    const files = pendingFiles;
    setPendingFiles([]);
    if (mode === 'target') {
      await compressFilesToTarget(files, targetBytes, targetLabel);
    } else {
      await compressFilesByLevel(files, level);
    }
  };

  const seedItems = (files: File[], badge: string): Item[] => {
    const initial: Item[] = files.map((file) => ({
      id: crypto.randomUUID(),
      originalName: file.name,
      originalSize: file.size,
      badge,
      status: 'pending',
    }));
    setItems((prev) => [...prev, ...initial]);
    return initial;
  };

  const markError = (id: string, message: string) =>
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, status: 'error', error: message } : it)),
    );

  const markCompressing = (id: string) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'compressing' } : it)));

  const markProgress = (id: string, message: string) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, progress: message } : it)));

  const markDone = (id: string, patch: Partial<Item>) =>
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, status: 'done', ...patch } : it)),
    );

  const compressFilesToTarget = async (
    files: File[],
    bytes: number,
    label: string,
  ) => {
    const initial = seedItems(files, `≤ ${label}`);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = initial[i].id;
      if (!(await isPdf(file))) {
        markError(id, 'Not a PDF.');
        continue;
      }
      markCompressing(id);
      try {
        const result = await compressToTargetSmart(file, bytes, (p) => markProgress(id, p.message));
        const stem = file.name.replace(/\.pdf$/i, '');
        const newName =
          result.finalSize < result.originalSize ? `${stem}-compressed.pdf` : `${stem}.pdf`;

        let note: string;
        if (result.strategy === 'already-small') {
          note = `Already under ${label}`;
        } else if (!result.metTarget) {
          note = `Smallest we could reach — still over ${label}`;
        } else if (result.strategy === 'image-recompress') {
          // The good case: fit the target without flattening, so text stays crisp.
          note = 'Text kept sharp · images recompressed';
        } else {
          note = `${result.pagesRasterized} page${result.pagesRasterized === 1 ? '' : 's'} flattened`;
          if (result.qpdfHelped) note += ' · qpdf saved more';
        }

        markDone(id, {
          newName,
          newSize: result.blob.size,
          url: urls.track(result.blob),
          note,
          metTarget: result.metTarget,
        });
      } catch (e) {
        markError(id, e instanceof Error ? e.message : 'Compression failed.');
      }
    }
  };

  const compressFilesByLevel = async (files: File[], levelToUse: CompressLevel) => {
    const initial = seedItems(files, levelLabel(levelToUse));
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = initial[i].id;
      if (!(await isPdf(file))) {
        markError(id, 'Not a PDF.');
        continue;
      }
      markCompressing(id);
      try {
        const result = await compressByLevelSmart(file, levelToUse, (p) => markProgress(id, p.message));
        const stem = file.name.replace(/\.pdf$/i, '');
        const newName = result.smallerThanOriginal
          ? `${stem}-compressed.pdf`
          : `${stem}.pdf`;

        const noteParts: string[] = [];
        if (result.smallerThanOriginal) {
          if (result.strategy === 'rasterize') {
            noteParts.push(
              `${result.pagesRasterized} page${result.pagesRasterized === 1 ? '' : 's'} flattened`,
            );
            if (result.qpdfPassRan && result.qpdfHelped) noteParts.push('qpdf saved more');
          } else {
            if (result.imagesRecompressed > 0) {
              noteParts.push(
                `${result.imagesRecompressed} image${result.imagesRecompressed === 1 ? '' : 's'} recompressed`,
              );
            }
            if (result.qpdfPassRan) {
              noteParts.push(result.qpdfHelped ? 'qpdf saved more' : 'qpdf ran');
            } else if (noteParts.length === 0) {
              noteParts.push('repacked');
            }
          }
        } else {
          noteParts.push('Already optimal — original returned');
        }

        markDone(id, {
          newName,
          newSize: result.blob.size,
          url: urls.track(result.blob),
          note: noteParts.join(' · '),
        });
      } catch (e) {
        markError(id, e instanceof Error ? e.message : 'Compression failed.');
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
      {/* Mode toggle */}
      <div
        className="inline-flex rounded-lg border p-1"
        role="tablist"
        aria-label="Compression mode"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {(
          [
            { id: 'target', label: 'Fit under a size' },
            { id: 'level', label: 'By quality level' },
          ] as { id: Mode; label: string }[]
        ).map((m) => {
          const selected = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setMode(m.id)}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition"
              style={{
                background: selected ? 'var(--color-accent)' : 'transparent',
                color: selected ? 'white' : 'var(--color-muted)',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {mode === 'target' ? (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Target size</legend>
          <div className="flex flex-wrap gap-2">
            {TARGET_PRESETS.map((t) => {
              const selected = targetChoice === t.id;
              const id = `target-${t.id}`;
              return (
                <label
                  key={t.id}
                  htmlFor={id}
                  className="cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition"
                  style={{
                    borderColor: selected ? 'var(--color-accent)' : 'var(--color-border)',
                    background: selected ? 'var(--color-accent-soft)' : 'transparent',
                  }}
                >
                  <input
                    id={id}
                    type="radio"
                    name="target"
                    className="sr-only"
                    checked={selected}
                    onChange={() => setTargetChoice(t.id)}
                  />
                  Under {t.label}
                </label>
              );
            })}
            <label
              htmlFor="target-custom"
              className="flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition"
              style={{
                borderColor: targetChoice === 'custom' ? 'var(--color-accent)' : 'var(--color-border)',
                background: targetChoice === 'custom' ? 'var(--color-accent-soft)' : 'transparent',
              }}
            >
              <input
                id="target-custom"
                type="radio"
                name="target"
                className="sr-only"
                checked={targetChoice === 'custom'}
                onChange={() => setTargetChoice('custom')}
              />
              <span>Custom</span>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={customMb}
                onFocus={() => setTargetChoice('custom')}
                onChange={(e) => setCustomMb(parseFloat(e.target.value))}
                className="w-16 rounded border px-1 py-0.5 text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                aria-label="Custom target size in megabytes"
              />
              <span style={{ color: 'var(--color-muted)' }}>MB</span>
            </label>
          </div>
          <p className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
            We find the sharpest version of your PDF that fits under this size. Pages become
            images with an invisible, still-selectable text layer.
          </p>
        </fieldset>
      ) : (
        <>
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
        </>
      )}

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
          badge={mode === 'target' ? `≤ ${targetLabel}` : levelLabel(level)}
          hint={
            mode === 'target'
              ? 'Change the target size above before confirming if you want a different limit.'
              : 'Change the level above before confirming if you want a different setting.'
          }
          disabled={compressing || !targetValid}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {items.length > 0 && (
        <ResultList
          heading={
            <>
              Results
              <span
                className="ml-2 text-sm font-normal"
                style={{ color: 'var(--color-muted)' }}
              >
                {inProgress > 0
                  ? `· compressing ${inProgress}…`
                  : `· ${doneCount} of ${items.length} ready`}
              </span>
            </>
          }
          onClear={reset}
        >
          {items.map((it) => (
            <DownloadRow
              key={it.id}
              header={
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {it.status === 'done' ? it.newName : it.originalName}
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                    style={{
                      background:
                        it.metTarget === false ? 'var(--color-danger)' : 'var(--color-accent-soft)',
                      color: it.metTarget === false ? 'white' : 'var(--color-accent)',
                    }}
                  >
                    {it.badge}
                  </span>
                </div>
              }
              meta={
                <>
                  {it.status === 'pending' && 'Queued…'}
                  {it.status === 'compressing' && (it.progress ?? 'Shrinking…')}
                  {it.status === 'done' && it.newSize !== undefined && (
                    <>
                      {formatBytes(it.originalSize)} → {formatBytes(it.newSize)} (
                      {sizeDelta(it.originalSize, it.newSize)})
                      {it.note && <span> · {it.note}</span>}
                    </>
                  )}
                  {it.status === 'error' && <ErrorText inline>{it.error}</ErrorText>}
                </>
              }
              href={it.status === 'done' ? it.url : undefined}
              filename={it.status === 'done' ? it.newName : undefined}
            />
          ))}
        </ResultList>
      )}
    </div>
  );
}
