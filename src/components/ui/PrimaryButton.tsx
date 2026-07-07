import type { ButtonHTMLAttributes, CSSProperties } from 'react';

/**
 * The accent-coloured primary action button (Merge, Build PDF, …).
 */
export default function PrimaryButton({
  className = '',
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`nudge ${className}`}
      style={{
        ...base,
        opacity: props.disabled ? 0.5 : 1,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    />
  );
}

const base: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 12,
  padding: '13px 20px',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 2px 10px rgba(249,115,22,0.28)',
  fontFamily: 'inherit',
};
