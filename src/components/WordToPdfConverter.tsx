import { useEffect, useRef, useState } from 'react';
import FileDrop from './FileDrop';
import { isDocx, renderDocx } from '~/lib/docxRender';
import { formatBytes } from '~/lib/format';

type Status = 'pending' | 'verifying' | 'ready' | 'error';

interface DocItem {
  id: string;
  file: File;
  originalName: string;
  originalSize: number;
  status: Status;
  error?: string;
}

/**
 * Word → PDF via docx-preview + browser print dialog.
 *
 * Flow:
 *   1. User drops .docx files. We magic-byte-validate each one.
 *   2. User clicks "Preview" on a file → we render it into a visible div
 *      using docx-preview (which preserves Word's styling).
 *   3. User clicks "Save as PDF" → we render the same file into a hidden
 *      iframe (with breakPages, headers, footers enabled) and trigger
 *      the browser's print dialog. User picks "Save as PDF" as destination.
 *
 * The browser's print engine produces a selectable-text PDF that visually
 * matches what docx-preview rendered.
 */
export default function WordToPdfConverter() {
  const [items, setItems] = useState<DocItem[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const printIframeRef = useRef<HTMLIFrameElement | null>(null);

  const reset = () => {
    setItems([]);
    setPreviewId(null);
  };

  const handleFiles = async (files: File[]) => {
    const initial: DocItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      originalName: file.name,
      originalSize: file.size,
      status: 'verifying',
    }));
    setItems((prev) => [...prev, ...initial]);

    for (const item of initial) {
      const ok = await isDocx(item.file);
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? ok
              ? { ...it, status: 'ready' }
              : {
                  ...it,
                  status: 'error',
                  error: 'Only .docx files are supported. (Older .doc format is not.)',
                }
            : it,
        ),
      );
      if (ok && !previewId) {
        // Auto-open preview for the first valid file
        setPreviewId(item.id);
      }
    }
  };

  const previewItem = items.find((it) => it.id === previewId);

  // Render the current preview item via docx-preview when it changes.
  useEffect(() => {
    const container = previewRef.current;
    if (!container || !previewItem || previewItem.status !== 'ready') return;

    // Clear previous content
    container.innerHTML = '';

    let cancelled = false;
    (async () => {
      try {
        await renderDocx(previewItem.file, container, undefined, { forPrint: false });
        if (cancelled) container.innerHTML = '';
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Render failed.';
        container.innerHTML = `<p style="color:#dc2626;padding:1rem;">Preview failed: ${msg}</p>`;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [previewItem]);

  /**
   * Render the file into a hidden iframe and trigger window.print().
   * The user picks "Save as PDF" as their destination in the browser's
   * native print dialog. The output is a real PDF with selectable text.
   */
  const handleSaveAsPdf = async (item: DocItem) => {
    let iframe = printIframeRef.current;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('title', 'Print preview');
      Object.assign(iframe.style, {
        position: 'fixed',
        right: '0',
        bottom: '0',
        width: '0',
        height: '0',
        border: '0',
        opacity: '0',
        pointerEvents: 'none',
      });
      document.body.appendChild(iframe);
      printIframeRef.current = iframe;
    }

    const doc = iframe.contentDocument;
    if (!doc) return;

    const docTitle = item.originalName.replace(/\.docx?$/i, '');
    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(docTitle)}</title>
</head>
<body></body>
</html>`);
    doc.close();

    // Let the iframe initialize before we start writing into it.
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      await renderDocx(item.file, doc.body, doc.head, { forPrint: true });
    } catch (err) {
      console.error('Render for print failed:', err);
      return;
    }

    const win = iframe.contentWindow;
    if (!win) return;
    win.focus();

    // Small delay so fonts/images settle before the print dialog snapshots.
    setTimeout(() => {
      try {
        win.print();
      } catch (err) {
        console.error('Print failed:', err);
      }
    }, 300);
  };

  // Cleanup hidden iframe on unmount.
  useEffect(() => {
    return () => {
      const iframe = printIframeRef.current;
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      printIframeRef.current = null;
    };
  }, []);

  return (
    <div className="space-y-8">
      <FileDrop
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        onFiles={handleFiles}
      >
        <p className="mb-2 text-lg font-medium">Drop .docx files here</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          or click to select · Word documents (.docx only)
        </p>
      </FileDrop>

      {items.length > 0 && (
        <section aria-live="polite">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Documents</h2>
            <button
              type="button"
              onClick={reset}
              className="text-sm underline hover:no-underline"
              style={{ color: 'var(--color-muted)' }}
            >
              Clear all
            </button>
          </div>

          <ul className="space-y-2">
            {items.map((it) => {
              const isPreviewing = it.id === previewId;
              return (
                <li
                  key={it.id}
                  className="rounded-lg border"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <div className="flex items-center justify-between gap-4 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{it.originalName}</div>
                      <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {it.status === 'verifying' && 'Checking…'}
                        {it.status === 'ready' && formatBytes(it.originalSize)}
                        {it.status === 'error' && (
                          <span style={{ color: '#dc2626' }}>{it.error}</span>
                        )}
                      </div>
                    </div>
                    {it.status === 'ready' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewId(isPreviewing ? null : it.id)}
                          className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:opacity-90"
                          style={{ borderColor: 'var(--color-border)' }}
                        >
                          {isPreviewing ? 'Hide preview' : 'Preview'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveAsPdf(it)}
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
                          style={{ background: 'var(--color-accent)' }}
                        >
                          Save as PDF
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {previewItem && previewItem.status === 'ready' && (
        <section
          aria-label="Document preview"
          className="rounded-xl border"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <header
            className="flex items-center justify-between border-b px-4 py-2 text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            <span>
              Preview — this is how the PDF will look. Click <strong>Save as PDF</strong> to
              produce the file.
            </span>
            <button
              type="button"
              onClick={() => setPreviewId(null)}
              className="underline hover:no-underline"
            >
              Close
            </button>
          </header>
          <div
            ref={previewRef}
            className="docx-preview-host overflow-auto bg-white p-4 text-black"
            style={{ maxHeight: '70vh' }}
          />
        </section>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
