import { useCallback, useRef, useState, type ReactNode } from 'react';

/**
 * Generic, accessible file-drop zone.
 *
 * - Click or keyboard (Enter/Space) opens the file picker.
 * - Drag-and-drop adds files when supported.
 * - On mobile (no drag-drop), it falls back gracefully to tap-to-select.
 *
 * Reused across every converter we ship.
 */
interface FileDropProps {
  /** MIME types or extensions to accept (e.g. "image/png,image/jpeg") */
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
  const [isDragging, setIsDragging] = useState(false);

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
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition focus:outline-none focus-visible:ring-2"
      style={{
        borderColor: isDragging ? 'var(--color-accent)' : 'var(--color-border)',
        background: isDragging ? 'var(--color-accent-soft)' : 'transparent',
        // @ts-expect-error -- CSS custom property
        '--tw-ring-color': 'var(--color-accent)',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {children ?? (
        <>
          <p className="mb-2 text-lg font-medium">Drop files here</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            or click to select · multiple files OK
          </p>
        </>
      )}
    </div>
  );
}
