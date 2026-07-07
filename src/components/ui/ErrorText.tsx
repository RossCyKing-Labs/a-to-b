import type { ReactNode } from 'react';

/**
 * Danger-coloured text on the --danger token. Block (`<p>`) by default, or
 * inline (`<span>`) for embedding in a result row's meta line.
 */
export default function ErrorText({
  children,
  inline = false,
}: {
  children: ReactNode;
  inline?: boolean;
}) {
  if (inline) {
    return <span style={{ color: 'var(--danger)' }}>{children}</span>;
  }
  return <p style={{ fontSize: 13.5, color: 'var(--danger)' }}>{children}</p>;
}
