import type { ReactNode } from 'react';

/**
 * The results section shared by every converter: an `aria-live` region with a
 * heading, an optional "Clear all" button, and a spaced list of rows
 * (typically <DownloadRow>s).
 */
export default function ResultList({
  heading,
  onClear,
  clearLabel = 'Clear all',
  children,
}: {
  heading: ReactNode;
  onClear?: () => void;
  clearLabel?: string;
  children: ReactNode;
}) {
  return (
    <section aria-live="polite">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{heading}</h2>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-sm underline hover:no-underline"
            style={{ color: 'var(--color-muted)' }}
          >
            {clearLabel}
          </button>
        )}
      </div>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}
