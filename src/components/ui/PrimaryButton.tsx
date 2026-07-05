import type { ButtonHTMLAttributes } from 'react';

/**
 * The accent-coloured primary action button (Merge, Compress, Confirm, …).
 * Was inline-styled `background: var(--color-accent)` markup repeated in
 * several components.
 */
export default function PrimaryButton({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      style={{ background: 'var(--color-accent)', ...props.style }}
    />
  );
}
