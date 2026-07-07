import type { CSSProperties, ReactNode } from 'react';
import DownloadButton from './DownloadButton';

/**
 * One row in a results list: a truncating title, a muted meta line (size,
 * status, or an inline error), and a right-hand action (a Download button by
 * default when href + filename are given).
 */
export default function DownloadRow({
  name,
  header,
  meta,
  href,
  filename,
  action,
}: {
  name?: string;
  header?: ReactNode;
  meta?: ReactNode;
  href?: string;
  filename?: string;
  action?: ReactNode;
}) {
  const rightSlot =
    action ?? (href && filename ? <DownloadButton href={href} filename={filename} /> : null);

  return (
    <li style={row}>
      <div style={{ minWidth: 0, flex: 1 }}>
        {header ?? <div style={title}>{name}</div>}
        {meta !== undefined && meta !== null && <div style={metaStyle}>{meta}</div>}
      </div>
      {rightSlot}
    </li>
  );
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  background: 'var(--card)',
  border: '1px solid var(--hair)',
  borderRadius: 12,
  padding: '12px 14px',
};
const title: CSSProperties = {
  fontSize: 14.5,
  fontWeight: 600,
  color: 'var(--ink)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const metaStyle: CSSProperties = {
  fontSize: 12.5,
  color: 'var(--muted)',
  marginTop: 2,
};
