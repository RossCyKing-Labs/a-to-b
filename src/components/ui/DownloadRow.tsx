import type { ReactNode } from 'react';
import DownloadButton from './DownloadButton';

/**
 * One row in a results list: a truncating filename, a muted meta line
 * (size, status, or an inline error), and a right-hand action.
 *
 * By default the action is a Download button when `href` + `filename` are
 * supplied; pass `action` to override (or omit both for a status-only row,
 * e.g. a file that is still converting or errored).
 */
export default function DownloadRow({
  name,
  header,
  meta,
  href,
  filename,
  action,
}: {
  /** Filename shown as the (truncating) title line. Ignored when `header` is set. */
  name?: string;
  /** Custom title-line node (e.g. filename + a badge). Overrides `name`. */
  header?: ReactNode;
  meta?: ReactNode;
  href?: string;
  filename?: string;
  action?: ReactNode;
}) {
  const rightSlot =
    action ?? (href && filename ? <DownloadButton href={href} filename={filename} /> : null);

  return (
    <li
      className="flex items-center justify-between gap-4 rounded-lg border p-3"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="min-w-0 flex-1">
        {header ?? <div className="truncate text-sm font-medium">{name}</div>}
        {meta !== undefined && meta !== null && (
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {meta}
          </div>
        )}
      </div>
      {rightSlot}
    </li>
  );
}
