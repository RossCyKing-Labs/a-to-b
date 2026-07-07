import type { CSSProperties } from 'react';

/**
 * A download link styled as the ink (near-black / near-white) action button,
 * matching the compress tool's Download.
 */
export default function DownloadButton({
  href,
  filename,
  label = 'Download',
}: {
  href: string;
  filename: string;
  label?: string;
}) {
  return (
    <a href={href} download={filename} style={style}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 11l5 4 5-4" /><path d="M5 20h14" /></svg>
      {label}
    </a>
  );
}

const style: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  flexShrink: 0,
  background: 'var(--ink-btn-bg)',
  color: 'var(--ink-btn-text)',
  textDecoration: 'none',
  borderRadius: 10,
  padding: '9px 14px',
  fontSize: 13.5,
  fontWeight: 600,
  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
};
