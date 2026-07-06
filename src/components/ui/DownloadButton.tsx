/**
 * A download link styled as an accent button. Every converter renders the
 * same `<a href download>` with identical classes/inline accent background;
 * this is that anchor in one place.
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
    <a
      href={href}
      download={filename}
      className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
      style={{ background: 'var(--color-accent)' }}
    >
      {label}
    </a>
  );
}
