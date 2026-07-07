import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Generic, accessible file-drop zone in the polished design language.
 *
 * - Click or keyboard (Enter/Space) opens the file picker.
 * - Drag-and-drop adds files; the zone reacts magnetically on dragover.
 * - Mobile falls back to tap-to-select.
 *
 * Callers pass their own title/subtitle as children; a file icon and a
 * "Choose files" button frame them.
 */
interface FileDropProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  children?: ReactNode;
}

export default function FileDrop({
  accept = '*/*',
  multiple = true,
  onFiles,
  children,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      onFiles(Array.from(fileList));
    },
    [onFiles],
  );

  const openPicker = () => inputRef.current?.click();

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop files here, or click to select"
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!drag) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handleFiles(e.dataTransfer.files);
      }}
      style={dropStyle(drag)}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: 'var(--faint)' }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
      </div>
      {children ?? (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Drop files here</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>it’s processed right here, on your device</div>
        </>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openPicker();
        }}
        style={chooseBtn}
      >
        Choose file{multiple ? 's' : ''}
      </button>
    </div>
  );
}

function dropStyle(drag: boolean): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    border: drag ? '1.5px dashed var(--accent)' : '1.5px dashed var(--hair-3)',
    borderRadius: 14,
    padding: '40px 24px',
    textAlign: 'center',
    cursor: 'pointer',
    outline: 'none',
    background: drag ? 'var(--accent-wash)' : 'var(--card)',
    boxShadow: drag ? 'inset 0 0 0 2px rgba(249,115,22,0.22)' : 'inset 0 0 0 2px rgba(249,115,22,0)',
    transform: drag ? 'scale(1.01)' : 'scale(1)',
    transition:
      'transform 160ms var(--ease-out-quad), border-color 160ms, background 160ms, box-shadow 160ms',
  };
}

const chooseBtn: CSSProperties = {
  marginTop: 18,
  padding: '9px 16px',
  borderRadius: 10,
  border: '1px solid var(--hair-2)',
  background: 'var(--card)',
  color: 'var(--ink)',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
