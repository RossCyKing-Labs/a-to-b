import { useEffect, useRef, useState } from 'react';
import FileDrop from './FileDrop';
import { docxToHtml, PRINT_STYLESHEET } from '~/lib/docxToHtml';
import { formatBytes } from '~/lib/format';

type Status = 'pending' | 'converting' | 'ready' | 'error';

interface DocItem {
  id: string;
  originalName: string;
  originalSize: number;
  status: Status;
  html?: string;
  warnings?: string[];
  error?: string;
}

export default function WordToPdfConverter() {
  const [items, setItems] = useState<DocItem[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const printIframeRef = useRef<HTMLIFrameElement | null>(null);

  const reset = () => {
    setItems([]);
    setPreviewId(null);
  };

  const handleFiles = async (files: File[]) => {
    const initial: DocItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      originalName: file.name,
      originalSize: file.size,
      status: 'pending',
    }));
    setItems((prev) => [...prev, ...initial]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = initial[i].id;

      if (!isDocx(file)) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? {
                  ...it,
                  status: 'error',
                  error: 'Only .docx files are supported. (Older .doc format is not.)',
                }
              : it,
          ),
        );
        continue;
      }

      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'converting' } : it)));

      try {
        const { html, warnings } = await docxToHtml(file);
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, status: 'ready', html, warnings } : it)),
        );
        // Auto-open preview for the first newly converted file
        setPreviewId((current) => current ?? id);
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id
              ? {
                  ...it,
                  status: 'error',
                  error: err instanceof Error ? err.message : 'Conversion failed.',
                }
              : it,
          ),
        );
      }
    }
  };

  /**
   * Open the browser's native print dialog with the converted HTML.
   * The user picks "Save as PDF" as the destination — the browser produces
   * a real PDF with selectable text from its rendering engine.
   */
  const handleSaveAsPdf = (item: DocItem) => {
    if (!item.html) return;

    // Reuse a single hidden iframe across prints
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
<style>${PRINT_STYLESHEET}</style>
</head>
<body>${item.html}</body>
</html>`);
    doc.close();

    // Wait for layout/fonts before triggering print
    const win = iframe.contentWindow;
    if (!win) return;

    win.focus();
    setTimeout(() => {
      try {
        win.print();
      } catch (err) {
        console.error('Print failed:', err);
      }
    }, 250);
  };

  // Cleanup the print iframe on unmount
  useEffect(() => {
    return () => {
      const iframe = printIframeRef.current;
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      printIframeRef.current = null;
    };
  }, []);

  const previewItem = items.find((it) => it.id === previewId);

  return (
    <div className="space-y-8">
      <FileDrop accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onFiles={handleFiles}>
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
                        {it.status === 'pending' && 'Queued…'}
                        {it.status === 'converting' && 'Reading document…'}
                        {it.status === 'ready' && (
                          <>
                            {formatBytes(it.originalSize)}
                            {it.warnings && it.warnings.length > 0 && (
                              <>
                                {' · '}
                                <span title={it.warnings.join('\n')}>
                                  {it.warnings.length} formatting note
                                  {it.warnings.length === 1 ? '' : 's'}
                                </span>
                              </>
                            )}
                          </>
                        )}
                        {it.status === 'error' && <span style={{ color: '#dc2626' }}>{it.error}</span>}
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

      {previewItem && previewItem.html && (
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
              Preview — this is roughly how the PDF will look. Click <strong>Save as PDF</strong> to
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
            className="docx-preview bg-white p-8 text-black"
            dangerouslySetInnerHTML={{ __html: previewItem.html }}
          />
          <style>{`
            .docx-preview { font-family: Georgia, 'Times New Roman', serif; line-height: 1.5; }
            .docx-preview h1, .docx-preview h2, .docx-preview h3, .docx-preview h4 {
              font-family: -apple-system, sans-serif;
              margin-top: 1.2em;
            }
            .docx-preview h1 { font-size: 1.7rem; }
            .docx-preview h2 { font-size: 1.3rem; }
            .docx-preview h3 { font-size: 1.1rem; }
            .docx-preview p { margin: 0 0 0.8em; }
            .docx-preview table { border-collapse: collapse; margin: 1em 0; width: 100%; }
            .docx-preview td, .docx-preview th { border: 1px solid #aaa; padding: 6px 10px; text-align: left; }
            .docx-preview img { max-width: 100%; height: auto; }
            .docx-preview blockquote { margin: 1em 1.5em; padding-left: 0.8em; border-left: 3px solid #888; color: #444; font-style: italic; }
            .docx-preview ul, .docx-preview ol { padding-left: 1.5em; }
            .docx-preview a { color: #0a58ca; }
          `}</style>
        </section>
      )}
    </div>
  );
}

function isDocx(file: File): boolean {
  return /\.docx$/i.test(file.name) || file.type ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
