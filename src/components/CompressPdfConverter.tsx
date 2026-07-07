import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { isPdf, type CompressLevel } from '~/lib/pdfTools';
import { compressToTargetSmart, compressByLevelSmart } from '~/lib/compressClient';
import { formatBytes } from '~/lib/format';

/**
 * Compress PDF — the hero tool, single file at a time.
 *
 * UX: drop → confirm (target size / quality) → processing (live phases) →
 * done (the "shrink reveal": the size counts down, delta pops, download slides
 * in). All wired to the real off-thread engine (compressClient); the reveal
 * uses the real original/final byte sizes.
 */

type Phase = 'idle' | 'confirm' | 'processing' | 'done' | 'error';
type Mode = 'size' | 'quality';

const SIZE_TARGETS = [
  { label: '≤ 1 MB', bytes: 1 * 1024 * 1024 },
  { label: '≤ 2 MB', bytes: 2 * 1024 * 1024 },
  { label: '≤ 5 MB', bytes: 5 * 1024 * 1024 },
];
const QUALITY_LEVELS: { label: string; level: CompressLevel }[] = [
  { label: 'Light', level: 'low' },
  { label: 'Balanced', level: 'medium' },
  { label: 'Strong', level: 'high' },
];
const PIP_COUNT = 5;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function CompressPdfConverter() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState<Mode>('size');
  const [sizeIdx, setSizeIdx] = useState(1); // default ≤ 2 MB
  const [levelIdx, setLevelIdx] = useState(1); // default Balanced
  const [procMsg, setProcMsg] = useState('Working…');
  const [procStep, setProcStep] = useState(0);
  const [errorText, setErrorText] = useState('');
  // done / reveal
  const [origBytes, setOrigBytes] = useState(0);
  const [finalBytes, setFinalBytes] = useState(0);
  const [displayBytes, setDisplayBytes] = useState(0);
  const [showDelta, setShowDelta] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [metTarget, setMetTarget] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
  const nameRef = useRef<string>('compressed.pdf');
  const rafRef = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const revokeUrl = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };
  useEffect(
    () => () => {
      clearTimers();
      revokeUrl();
    },
    [],
  );

  const reset = () => {
    clearTimers();
    revokeUrl();
    setPhase('idle');
    setFile(null);
    setDrag(false);
    setProcStep(0);
    setShowDelta(false);
    setShowDownload(false);
  };

  const stage = (f: File) => {
    revokeUrl();
    setFile(f);
    setPhase('confirm');
    setProcStep(0);
    setShowDelta(false);
    setShowDownload(false);
  };

  const onPick = (files: FileList | null) => {
    if (files && files[0]) stage(files[0]);
  };

  const targetBytes = SIZE_TARGETS[sizeIdx].bytes;

  const start = async () => {
    if (!file) return;
    if (!(await isPdf(file))) {
      setErrorText(`${file.name} isn’t a PDF.`);
      setPhase('error');
      return;
    }
    // "Already under target": nothing to shrink.
    if (mode === 'size' && targetBytes >= file.size) {
      setErrorText(
        `This PDF is ${formatBytes(file.size)} — it already fits your ${SIZE_TARGETS[sizeIdx].label.replace('≤ ', '')} limit. Pick a smaller target to shrink it further.`,
      );
      setPhase('error');
      return;
    }

    clearTimers();
    setProcStep(0);
    setProcMsg('Reading document…');
    setPhase('processing');

    const onProgress = (message: string) => {
      setProcMsg(message);
      setProcStep((s) => Math.min(s + 1, PIP_COUNT - 1));
    };

    try {
      const stem = file.name.replace(/\.pdf$/i, '');
      let oBytes: number;
      let fBytes: number;
      let blob: Blob;
      let met = true;

      if (mode === 'size') {
        const r = await compressToTargetSmart(file, targetBytes, (p) => onProgress(p.message));
        oBytes = r.originalSize;
        fBytes = r.finalSize;
        blob = r.blob;
        met = r.metTarget;
      } else {
        const r = await compressByLevelSmart(file, QUALITY_LEVELS[levelIdx].level, (p) =>
          onProgress(p.message),
        );
        oBytes = r.originalSize;
        fBytes = r.finalSize;
        blob = r.blob;
        met = true;
      }

      revokeUrl();
      urlRef.current = URL.createObjectURL(blob);
      nameRef.current = fBytes < oBytes ? `${stem}-compressed.pdf` : `${stem}.pdf`;
      setOrigBytes(oBytes);
      setFinalBytes(fBytes);
      setMetTarget(met);
      setPhase('done');
      revealShrink(oBytes, fBytes);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'Compression failed.');
      setPhase('error');
    }
  };

  const revealShrink = (o: number, f: number) => {
    if (prefersReduced()) {
      setDisplayBytes(f);
      setShowDelta(true);
      setShowDownload(true);
      return;
    }
    setDisplayBytes(o);
    setShowDelta(false);
    setShowDownload(false);
    const dur = 720;
    const startT = performance.now();
    let done = false;
    const complete = () => {
      if (done) return;
      done = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setDisplayBytes(f);
      setShowDelta(true);
      timers.current.push(setTimeout(() => setShowDownload(true), 160));
    };
    const tick = (now: number) => {
      const p = Math.min(1, (now - startT) / dur);
      setDisplayBytes(o + (f - o) * ease(p));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else complete();
    };
    rafRef.current = requestAnimationFrame(tick);
    timers.current.push(setTimeout(complete, dur + 400)); // fallback for a throttled tab
  };

  const download = () => {
    if (!urlRef.current) return;
    const a = document.createElement('a');
    a.href = urlRef.current;
    a.download = nameRef.current;
    a.click();
  };

  const deltaPct = origBytes > 0 ? Math.round((1 - finalBytes / origBytes) * 100) : 0;

  return (
    <div style={cardStyle}>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => onPick(e.target.files)}
      />

      {phase === 'idle' && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop a PDF here, or click to choose a file"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!drag) setDrag(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDrag(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onPick(e.dataTransfer.files);
          }}
          style={dropStyle(drag)}
        >
          <div
            style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: 'var(--faint)' }}
          >
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Drop a PDF here</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 18 }}>it’s processed right here, on your device</div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
            style={secondaryBtn}
          >
            Choose a file
          </button>
        </div>
      )}

      {phase === 'confirm' && file && (
        <div style={{ animation: 'rise 240ms var(--ease-out-quad) both', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={fileRow}>
            <div style={fileIcon}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{formatBytes(file.size)} · PDF</div>
            </div>
            <button type="button" onClick={reset} aria-label="Remove file" style={removeBtn}>×</button>
          </div>

          <div>
            <div style={optLabel}>Target</div>
            <div style={segTrack}>
              <div style={segIndicator(mode)} />
              <button type="button" onClick={() => setMode('size')} style={segBtn(mode === 'size')}>Fit under a size</button>
              <button type="button" onClick={() => setMode('quality')} style={segBtn(mode === 'quality')}>By quality level</button>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {mode === 'size'
                ? SIZE_TARGETS.map((t, i) => (
                    <button key={t.label} type="button" onClick={() => setSizeIdx(i)} style={chip(i === sizeIdx)}>{t.label}</button>
                  ))
                : QUALITY_LEVELS.map((l, i) => (
                    <button key={l.label} type="button" onClick={() => setLevelIdx(i)} style={chip(i === levelIdx)}>{l.label}</button>
                  ))}
            </div>
          </div>

          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
            {mode === 'size'
              ? 'We’ll aim just under your limit and keep text selectable.'
              : 'Light/Balanced keep everything; Strong flattens pages to images for the biggest savings (text stays selectable).'}
          </div>

          <button type="button" className="nudge" onClick={start} style={primaryBtn}>
            <span>Compress PDF</span>
            <span className="nudge-arrow">&#8594;</span>
          </button>
        </div>
      )}

      {phase === 'processing' && (
        <div style={{ animation: 'rise 240ms var(--ease-out-quad) both', padding: '10px 2px 6px' }}>
          <div style={{ ...eyebrow, marginBottom: 16 }}>Working locally</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16, color: 'var(--ink)', minHeight: 26 }}>
            <span key={`hb${procStep}`} style={{ display: 'inline-block', color: 'var(--accent)', fontWeight: 700, fontSize: 17, animation: 'tick 420ms var(--ease-out-quad)' }}>&#8594;</span>
            <span key={`m${procStep}`} style={{ display: 'inline-block', fontWeight: 500, animation: 'fadeup 260ms var(--ease-out-quad) both' }}>{procMsg}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 20 }}>
            {Array.from({ length: PIP_COUNT }).map((_, i) => (
              <div key={i} style={pip(i, procStep)} />
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 18 }}>No data leaves your device — check the Network tab.</div>
        </div>
      )}

      {phase === 'error' && (
        <div style={{ animation: 'rise 260ms var(--ease-out-quad) both' }}>
          <div style={dangerPanel}>
            <div style={{ flexShrink: 0, marginTop: 1, color: 'var(--danger)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--danger-title)', marginBottom: 4 }}>Already under your target</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{errorText}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 20 }}>
            <button type="button" className="nudge" onClick={() => setPhase('confirm')} style={{ ...primaryBtn, width: 'auto', padding: '12px 18px', fontSize: 14.5, whiteSpace: 'nowrap' }}>
              <span>Pick a smaller target</span><span className="nudge-arrow">&#8594;</span>
            </button>
            <button type="button" onClick={reset} style={linkBtn}>Start over</button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div style={{ animation: 'rise 240ms var(--ease-out-quad) both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-soft)', marginBottom: 18 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            Done — and it never left your device.
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18, color: 'var(--faint)', fontWeight: 500 }}>{formatBytes(origBytes)}</span>
            <span style={{ fontSize: 20, color: 'var(--accent)', fontWeight: 700 }}>&#8594;</span>
            <span style={{ fontSize: 42, letterSpacing: '-0.02em', color: 'var(--ink)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatBytes(displayBytes)}</span>
            {showDelta && deltaPct > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--accent-soft-bg)', color: 'var(--accent-soft-text)', padding: '5px 11px', borderRadius: 999, fontSize: 13, fontWeight: 700, animation: 'pulse 460ms var(--ease-out-quad)' }}>&minus;{deltaPct}% smaller</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>
            {metTarget ? `${file?.name ?? 'Your PDF'} · ready to save` : 'Smallest we could reach — a bit over your target'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 26 }}>
            <button type="button" onClick={download} style={downloadStyle(showDownload)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 11l5 4 5-4" /><path d="M5 20h14" /></svg>
              Download
            </button>
            <button type="button" onClick={reset} style={linkBtn}>Compress another &#8594;</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ──
const cardStyle: CSSProperties = {
  margin: '22px 0 8px',
  borderRadius: 16,
  padding: 22,
  background: 'var(--card)',
  border: '1px solid var(--hair)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
};
const eyebrow: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
};
const optLabel: CSSProperties = { ...eyebrow, letterSpacing: '0.06em', marginBottom: 10 };
const secondaryBtn: CSSProperties = {
  padding: '9px 16px',
  borderRadius: 10,
  border: '1px solid var(--hair-2)',
  background: 'var(--card)',
  color: 'var(--ink)',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};
const primaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: '100%',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 12,
  padding: '13px 18px',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 2px 10px rgba(249,115,22,0.28)',
  fontFamily: 'inherit',
};
const linkBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 14,
  color: 'var(--muted)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  padding: 0,
};
const fileRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  background: 'var(--field)',
  border: '1px solid var(--hair-soft)',
  borderRadius: 12,
  padding: '12px 14px',
};
const fileIcon: CSSProperties = {
  width: 38,
  height: 38,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--accent-soft-bg)',
  borderRadius: 9,
  color: 'var(--accent-soft-text)',
};
const removeBtn: CSSProperties = {
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: 'var(--faint)',
  fontSize: 20,
  lineHeight: 1,
  cursor: 'pointer',
};
const segTrack: CSSProperties = {
  position: 'relative',
  display: 'flex',
  background: 'var(--field)',
  borderRadius: 12,
  padding: 4,
  marginBottom: 14,
};
const dangerPanel: CSSProperties = {
  display: 'flex',
  gap: 12,
  background: 'var(--danger-bg)',
  border: '1px solid var(--danger-border)',
  borderRadius: 12,
  padding: 16,
};
function segIndicator(mode: Mode): CSSProperties {
  return {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    width: 'calc(50% - 4px)',
    background: 'var(--card)',
    borderRadius: 9,
    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
    transform: mode === 'size' ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform 240ms var(--ease-in-out)',
  };
}
function segBtn(active: boolean): CSSProperties {
  return {
    position: 'relative',
    zIndex: 1,
    flex: 1,
    background: 'transparent',
    border: 'none',
    padding: '9px 8px',
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: active ? 'var(--ink)' : 'var(--muted)',
    transition: 'color 240ms',
  };
}
function chip(sel: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    textAlign: 'center',
    padding: '10px 14px',
    borderRadius: 10,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    background: sel ? 'var(--accent-soft-bg)' : 'var(--card)',
    border: sel ? '1px solid var(--accent)' : '1px solid var(--hair-2)',
    color: sel ? 'var(--accent-soft-text)' : 'var(--ink-soft)',
    fontFamily: 'inherit',
    transition: 'background 160ms, border-color 160ms, color 160ms',
    animation: sel ? 'overshoot 240ms var(--ease-out-quad)' : 'none',
  };
}
function pip(i: number, step: number): CSSProperties {
  const cur = i === step;
  const done = i < step;
  return {
    width: cur ? 22 : 6,
    height: 6,
    borderRadius: 999,
    background: done || cur ? 'var(--accent)' : 'var(--line-strong)',
    transition: 'width 240ms var(--ease-in-out), background 240ms',
  };
}
function dropStyle(drag: boolean): CSSProperties {
  return {
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
function downloadStyle(show: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--ink-btn-bg)',
    color: 'var(--ink-btn-text)',
    border: 'none',
    borderRadius: 12,
    padding: '12px 18px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 2px 8px rgba(0,0,0,0.14)',
    transition: 'transform 420ms var(--ease-out-quad), opacity 420ms var(--ease-out-quad)',
    transform: show ? 'translateX(0)' : 'translateX(28px)',
    opacity: show ? 1 : 0,
    pointerEvents: show ? 'auto' : 'none',
  };
}
