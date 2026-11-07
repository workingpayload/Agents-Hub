import { ArrowsOutIcon, DevicesIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { hubSocket } from '../lib/ws';
import { pressable } from './ui';

const FALLBACK_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const GEIST_MONO = `"Geist Mono Variable", ${FALLBACK_MONO}`;

const KEYS: { label: string; data: string }[] = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: 'Enter', data: '\r' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'y', data: 'y' },
  { label: 'n', data: 'n' },
  { label: '1', data: '1' },
  { label: '2', data: '2' },
  { label: '3', data: '3' },
];

const MIN_FONT = 6;

// Replies xterm.js generates automatically to terminal queries (cursor position, device attributes,
// colour/mode reports, focus events). The hub answers queries once itself, so viewers must not echo them.
// eslint-disable-next-line no-control-regex
const AUTO_REPLY = /^(?:\x1b\[\d+;\d+R|\x1b\[[?>][\d;]*c|\x1b\]\d+;[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[\?[\d;]*\$y|\x1b\[[IO]|\x1bP[^\x1b]*\x1b\\)+$/;

interface SizeInfo {
  cols: number;
  rows: number;
  driverName?: string;
  mine?: boolean;
}

/**
 * Live mirror of a terminal-mode agent, shared by every connected device.
 * The PTY has one size, set by whichever device was used last. Every viewer renders at exactly
 * that size (shrinking the font when its screen is smaller), so output is never garbled.
 */
export function TerminalView({ sessionId, live }: { sessionId: string; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const claimRef = useRef<() => void>(() => undefined);
  const [size, setSize] = useState<SizeInfo | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const baseFont = () => (window.innerWidth < 640 ? 11 : 13);
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: FALLBACK_MONO,
      fontSize: baseFont(),
      allowTransparency: true,
      theme: { background: 'rgba(0,0,0,0)', foreground: '#e5e5e5', cursor: '#ffffff', selectionBackground: 'rgba(255,255,255,0.25)' },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // Inset text from the rounded corners. Padding goes on the terminal element, which the fit addon accounts for.
    if (term.element) term.element.style.padding = '8px 6px 6px 10px';

    let ptySize: { cols: number; rows: number } | null = null;
    let sentPref = '';
    let snapshots = 0;

    const setFont = (size: number) => {
      if (term.options.fontSize !== size) term.options.fontSize = size;
    };

    /** Columns/rows that fit this viewer's screen at the normal font size. */
    const measure = (): { cols: number; rows: number } | null => {
      const current = term.options.fontSize ?? baseFont();
      setFont(baseFont());
      const dims = fit.proposeDimensions();
      setFont(current);
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols < 1) return null;
      return { cols: Math.max(20, dims.cols), rows: Math.max(5, dims.rows) };
    };

    /**
     * Renders at the PTY's size. When this screen is smaller than the driving device's, the font is
     * shrunk step by step until the whole grid fits (cell sizes do not scale perfectly linearly).
     */
    const applySize = () => {
      if (!ptySize) return;
      let font = baseFont();
      setFont(font);
      for (let i = 0; i < 24; i++) {
        const dims = fit.proposeDimensions();
        if (!dims || (dims.cols >= ptySize.cols && dims.rows >= ptySize.rows) || font <= MIN_FONT) break;
        const factor = Math.min(dims.cols / ptySize.cols, dims.rows / ptySize.rows);
        font = Math.max(MIN_FONT, Math.min(font - 0.5, Math.floor(font * factor * 2) / 2));
        setFont(font);
      }
      if (term.cols !== ptySize.cols || term.rows !== ptySize.rows) term.resize(ptySize.cols, ptySize.rows);
      // Even the smallest font can't fit a much larger screen's grid: scroll instead, keeping the prompt in view.
      const dims = fit.proposeDimensions();
      const tooBig = Boolean(dims && (dims.cols < ptySize.cols || dims.rows < ptySize.rows));
      el.style.overflow = tooBig ? 'auto' : 'hidden';
      if (tooBig) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    };

    const sendPreference = (claim: boolean) => {
      const fits = measure();
      if (!fits) return;
      const key = `${fits.cols}x${fits.rows}`;
      if (!claim && key === sentPref) return;
      sentPref = key;
      hubSocket.send({ type: 'pty_resize', sessionId, ...fits, claim });
    };
    claimRef.current = () => sendPreference(true);

    const off = hubSocket.onPty(sessionId, (msg) => {
      if (msg.kind === 'size') {
        ptySize = { cols: msg.cols, rows: msg.rows };
        setSize(msg);
        applySize();
      } else if (msg.kind === 'snapshot') {
        term.reset();
        applySize();
        term.write(msg.data);
        // Opening the terminal on this device takes over the size; after a reconnect just re-register.
        sendPreference(snapshots++ === 0);
      } else {
        term.write(msg.data);
      }
    });
    const unsubscribe = hubSocket.subscribe(sessionId);
    const input = term.onData((data) => {
      if (!AUTO_REPLY.test(data)) hubSocket.send({ type: 'pty_input', sessionId, data });
    });
    const onFocus = () => sendPreference(true);
    term.textarea?.addEventListener('focus', onFocus);
    const ro = new ResizeObserver(() => {
      sendPreference(false);
      applySize();
    });
    ro.observe(el);
    // Swap in Geist Mono once loaded; cell metrics change, so re-apply the grid size.
    let disposed = false;
    void document.fonts
      ?.load(`13px "Geist Mono Variable"`)
      .then(() => {
        if (disposed) return;
        term.options.fontFamily = GEIST_MONO;
        applySize();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      ro.disconnect();
      term.textarea?.removeEventListener('focus', onFocus);
      input.dispose();
      off();
      unsubscribe();
      term.dispose();
    };
  }, [sessionId]);

  // A restarted terminal starts at a default size; size it for this device again.
  useEffect(() => {
    if (live) claimRef.current();
  }, [live]);

  const mine = Boolean(size?.mine);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* The fit addon measures the host's computed size, so padding/border live on the wrapper. */}
      <div className="surface flex min-h-80 flex-1 rounded-2xl p-2">
        <div ref={ref} className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-black" />
      </div>
      {size && (
        <div className="caption-3 flex items-center gap-2 px-1 text-neutral-400">
          <DevicesIcon className="h-4 w-4" />
          <span data-testid="pty-size" className="min-w-0 truncate font-mono tabular-nums">
            {size.cols}×{size.rows} · sized for {mine ? 'this screen' : (size.driverName ?? 'another device')}
          </span>
          {!mine && (
            <button
              className={clsx(
                'button-xsm ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-3 px-3 py-2 text-neutral-100 hover:bg-surface-4 pointer-coarse:min-h-11',
                pressable,
              )}
              onClick={() => claimRef.current()}
            >
              <ArrowsOutIcon className="h-3 w-3" /> Fit to this screen
            </button>
          )}
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {KEYS.map((k) => (
          <button
            key={k.label}
            disabled={!live}
            onClick={() => hubSocket.send({ type: 'pty_input', sessionId, data: k.data })}
            className={clsx(
              'caption-3 shrink-0 rounded-xl border border-surface-4 bg-surface-3 px-3 py-2 font-mono text-neutral-100 hover:bg-surface-4 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
              pressable,
            )}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
