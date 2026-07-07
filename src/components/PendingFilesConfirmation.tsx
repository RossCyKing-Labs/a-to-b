import type { CSSProperties } from 'react';
import { formatBytes } from '~/lib/format';

interface PendingFilesConfirmationProps {
  files: File[];
  /** Verb for the heading ("Ready to {verb}") and button ("{Verb} N files"). */
  verb: string;
  /** Optional accent pill surfacing the relevant setting (level, rotation…). */
  badge?: string;
  /** Optional reminder text next to the buttons. */
  hint?: string;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * "You've staged some files — confirm or cancel" panel, in the polished design.
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
  const noun = files.length === 1 ? 'file' : `${files.length} files`;

  return (
    <section aria-live="polite" style={panel}>
      <div style={headRow}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
          Ready to {verb}
          <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
            · {files.length} file{files.length === 1 ? '' : 's'} · {formatBytes(totalSize)}
          </span>
        </h2>
        {badge && <span style={badgeStyle}>{badge}</span>}
      </div>

      <ul style={{ listStyle: 'none', margin: '0 0 4px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {files.map((file, idx) => (
          <li key={`${file.name}-${idx}`} style={fileLi}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            <span style={{ flexShrink: 0, fontSize: 12, color: 'var(--muted)' }}>{formatBytes(file.size)}</span>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="nudge" onClick={onConfirm} disabled={disabled} style={confirmBtn(disabled)}>
          <span>{Verb} {noun}</span>
          <span className="nudge-arrow">&#8594;</span>
        </button>
        <button type="button" onClick={onCancel} style={cancelBtn}>Cancel</button>
        {hint && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{hint}</span>}
      </div>
    </section>
  );
}

const panel: CSSProperties = {
  borderRadius: 16,
  border: '1px solid rgba(249,115,22,0.4)',
  background: 'var(--accent-wash)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const headRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
};
const badgeStyle: CSSProperties = {
  background: 'var(--accent)',
  color: '#fff',
  borderRadius: 999,
  padding: '3px 10px',
  fontSize: 12,
  fontWeight: 600,
};
const fileLi: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: 13.5,
  color: 'var(--ink-soft)',
};
function confirmBtn(disabled?: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    padding: '11px 18px',
    fontSize: 14.5,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    boxShadow: '0 2px 10px rgba(249,115,22,0.28)',
    fontFamily: 'inherit',
  };
}
const cancelBtn: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--hair-2)',
  borderRadius: 12,
  padding: '11px 18px',
  fontSize: 14.5,
  fontWeight: 600,
  color: 'var(--ink)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
