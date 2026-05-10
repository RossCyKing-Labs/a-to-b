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

export default function FormatPicker({
  value,
  onChange,
  quality,
  onQualityChange,
}: FormatPickerProps) {
  const showQuality = value === 'jpeg' || value === 'webp';

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Output format</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {FORMATS.map((fmt) => {
            const selected = value === fmt.id;
            return (
              <label
                key={fmt.id}
                className="cursor-pointer rounded-lg border p-3 transition"
                style={{
                  borderColor: selected ? 'var(--color-accent)' : 'var(--color-border)',
                  background: selected ? 'var(--color-accent-soft)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="format"
                  className="sr-only"
                  checked={selected}
                  onChange={() => onChange(fmt.id)}
                />
                <div className="font-medium">{fmt.label}</div>
                <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {fmt.desc}
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {showQuality && (
        <div>
          <label htmlFor="quality" className="flex items-center justify-between text-sm font-medium">
            <span>Quality</span>
            <span style={{ color: 'var(--color-muted)' }}>{Math.round(quality * 100)}%</span>
          </label>
          <input
            id="quality"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={quality}
            onChange={(e) => onQualityChange(parseFloat(e.target.value))}
            className="mt-2 w-full"
            style={{ accentColor: 'var(--color-accent)' }}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
            Higher quality = larger file. 85% is a good default for photos.
          </p>
        </div>
      )}
    </div>
  );
}
