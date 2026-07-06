import type { ReactNode } from 'react';

/**
 * Danger-coloured text. Centralises the error colour (previously the literal
 * `#dc2626` hardcoded in nine components) onto the `--color-danger` design
 * token.
 *
 * Two shapes, matching how the converters surface errors:
 *  - block  (default): a standalone `<p>` beneath the drop zone.
 *  - inline (`inline`): a `<span>` embedded in a result row's meta line.
 */
export default function ErrorText({
  children,
  inline = false,
}: {
  children: ReactNode;
  inline?: boolean;
}) {
  if (inline) {
    return <span style={{ color: 'var(--color-danger)' }}>{children}</span>;
  }
  return (
    <p className="text-sm" style={{ color: 'var(--color-danger)' }}>
      {children}
    </p>
  );
}
