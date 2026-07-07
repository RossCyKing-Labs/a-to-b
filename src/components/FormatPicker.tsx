import type { CSSProperties } from 'react';
import type { ImageFormat } from '~/lib/imageConvert';

interface FormatPickerProps {
  value: ImageFormat;
  onChange: (format: ImageFormat) => void;
  quality: number;
  onQualityChange: (q: number) => void;
}

const FORMATS: { id: ImageFormat; label: string; desc: string }[] = [
  { id: 'jpeg', label: 'JPEG', desc: 'Smaller, lossy. Best for photos.' },
  { id: 'png', label: 'PNG', desc: 'Lossless. Best for graphics & screenshots.' },
  { id: 'webp', label: 'WebP', desc: 'Modern, ~30% smaller than JPEG.' },
];

export default function FormatPicker({ value, onChange, quality, onQualityChange }: FormatPickerProps) {
  const showQuality = value === 'jpeg' || value === 'webp';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={label}>Output format</legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {FORMATS.map((fmt) => {
            const selected = value === fmt.id;
            const inputId = `fmt-${fmt.id}`;
            return (
              <label key={fmt.id} htmlFor={inputId} style={card(selected)}>
                <input
                  id={inputId}
                  type="radio"
                  name="format"
                  value={fmt.id}
                  className="sr-only"
                  checked={selected}
                  onChange={() => onChange(fmt.id)}
                />
                <div style={{ fontSize: 14, fontWeight: 600, color: selected ? 'var(--accent-soft-text)' : 'var(--ink)' }}>{fmt.label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>{fmt.desc}</div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {showQuality && (
        <div>
          <label htmlFor="quality" style={{ ...label, display: 'flex', justifyContent: 'space-between', textTransform: 'none', letterSpacing: 'normal', fontSize: 13.5 }}>
            <span>Quality</span>
            <span style={{ color: 'var(--muted)' }}>{Math.round(quality * 100)}%</span>
          </label>
          <input
            id="quality"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={quality}
            onChange={(e) => onQualityChange(parseFloat(e.target.value))}
            style={{ marginTop: 8, width: '100%', accentColor: 'var(--accent)' }}
          />
          <p style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)' }}>Higher quality = larger file. 85% is a good default for photos.</p>
        </div>
      )}
    </div>
  );
}

const label: CSSProperties = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  marginBottom: 10,
};
function card(selected: boolean): CSSProperties {
  return {
    display: 'block',
    cursor: 'pointer',
    borderRadius: 10,
    padding: '11px 13px',
    border: selected ? '1px solid var(--accent)' : '1px solid var(--hair-2)',
    background: selected ? 'var(--accent-soft-bg)' : 'var(--card)',
    transition: 'border-color 160ms, background 160ms',
  };
}
