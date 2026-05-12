import { formatBytes } from '~/lib/format';

interface PendingFilesConfirmationProps {
  /** The files the user has staged but not yet processed. */
  files: File[];
  /**
   * Verb used in the heading ("Ready to {verb}") and primary button text
   * ("{Verb} N files"). Lowercase — we capitalize for the button.
   */
  verb: string;
  /**
   * Optional accent-color pill shown in the top-right of the panel — used
   * to surface the relevant setting (compression level, rotation amount,
   * target image format, etc.) so the user knows what they're confirming.
   */
  badge?: string;
  /**
   * Optional small reminder text shown next to the buttons. Use this to
   * point the user back to settings they can adjust before confirming.
   */
  hint?: string;
  /** Disable the buttons (e.g. while a previous batch is still processing). */
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable "you've staged some files — confirm or cancel" panel.
 *
 * Each converter that benefits from a deliberate confirmation step (instead
 * of starting work the moment files are dropped) wraps its FileDrop output
 * in this component. The pattern is:
 *
 *     {pendingFiles.length === 0
 *       ? <FileDrop onFiles={setPendingFiles}>...</FileDrop>
 *       : <PendingFilesConfirmation
 *           files={pendingFiles}
 *           verb="compress"
 *           badge={levelLabel}
 *           onConfirm={handleConfirm}
 *           onCancel={() => setPendingFiles([])}
 *         />
 *     }
 *
 * Keeping this as a single component means a future tweak (e.g. different
 * button color, additional info, a checkbox for "remember my choice") is
 * a one-file change across all six tools.
 */
export default function PendingFilesConfirmation({
  files,
  verb,
  badge,
  hint,
  disabled,
  onConfirm,
  onCancel,
}: PendingFilesConfirmationProps) {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const Verb = verb.charAt(0).toUpperCase() + verb.slice(1);
  const noun =
    files.length === 1 ? 'file' : `${files.length} files`;

  return (
    <section
      aria-live="polite"
      className="rounded-xl border p-4"
      style={{
        borderColor: 'var(--color-accent)',
        background: 'var(--color-accent-soft)',
      }}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          Ready to {verb}
          <span
            className="ml-2 text-sm font-normal"
            style={{ color: 'var(--color-muted)' }}
          >
            · {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
            {formatBytes(totalSize)}
          </span>
        </h2>
        {badge && (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ background: 'var(--color-accent)', color: 'white' }}
          >
            {badge}
          </span>
        )}
      </div>
      <ul className="mb-4 space-y-1">
        {files.map((file, idx) => (
          <li
            key={`${file.name}-${idx}`}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="truncate">{file.name}</span>
            <span
              className="shrink-0 text-xs"
              style={{ color: 'var(--color-muted)' }}
            >
              {formatBytes(file.size)}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: 'var(--color-accent)' }}
        >
          {Verb} {noun}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border px-4 py-2 text-sm font-medium transition hover:opacity-80"
          style={{ borderColor: 'var(--color-border)' }}
        >
          Cancel
        </button>
        {hint && (
          <p
            className="ml-1 text-xs"
            style={{ color: 'var(--color-muted)' }}
          >
            {hint}
          </p>
        )}
      </div>
    </section>
  );
}
