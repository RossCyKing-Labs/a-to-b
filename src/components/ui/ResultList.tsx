import type { CSSProperties, ReactNode } from 'react';

/**
 * The results section shared by converters: an aria-live region with a heading,
 * an optional "Clear all" button, and a spaced list of rows.
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
    <section aria-live="polite" style={{ marginTop: 24 }}>
      <div style={head}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{heading}</h2>
        {onClear && (
          <button type="button" onClick={onClear} style={clearBtn}>
            {clearLabel}
          </button>
        )}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </ul>
    </section>
  );
}

const head: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
};
const clearBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 13,
  color: 'var(--muted)',
  cursor: 'pointer',
  textDecoration: 'underline',
  fontFamily: 'inherit',
  padding: 0,
};
