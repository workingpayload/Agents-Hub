import type { IPty } from '@lydell/node-pty';
import headlessPkg from '@xterm/headless';
import serializePkg from '@xterm/addon-serialize';
import type { Logger } from '../logger.js';
import { findExecutable, killTree, ptyCommandLine, type LaunchSpec } from './process.js';
import type { AdapterCallbacks, AgentAdapter, StartResult } from './types.js';

const { Terminal: HeadlessTerminal } = headlessPkg;
const { SerializeAddon } = serializePkg;

const TAIL_LIMIT = 4096;
const SNAPSHOT_SCROLLBACK = 1000;

export const PTY_MIN = { cols: 20, rows: 5 };
export const PTY_MAX = { cols: 500, rows: 200 };

export function clampPtySize(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: Math.max(PTY_MIN.cols, Math.min(Math.floor(cols) || 80, PTY_MAX.cols)),
    rows: Math.max(PTY_MIN.rows, Math.min(Math.floor(rows) || 24, PTY_MAX.rows)),
  };
}

export interface PtyAdapterOptions {
  spec: LaunchSpec;
  cwd: string;
  callbacks: AdapterCallbacks;
  log: Logger;
  cols?: number;
  rows?: number;
}

/**
 * Runs an agent CLI interactively inside a pseudo-terminal and mirrors it to clients (xterm.js).
 * A headless terminal emulator tracks the screen so late joiners get an accurate snapshot at the
 * current size instead of a raw replay of output that was drawn for other sizes.
 */
export class PtyAdapter implements AgentAdapter {
  readonly kind = 'terminal' as const;
  private pty?: IPty;
  private screen: InstanceType<typeof HeadlessTerminal>;
  private serializer: InstanceType<typeof SerializeAddon>;
  /** Output handed to the emulator but not parsed yet; appended to snapshots so nothing is lost. */
  private unparsed: string[] = [];
  private tail = '';
  private cols: number;
  private rows: number;
  private bracketedPaste = false;
  private stopping = false;
  private exited = false;
  private lastBell = 0;

  constructor(private opts: PtyAdapterOptions) {
    ({ cols: this.cols, rows: this.rows } = clampPtySize(opts.cols ?? 120, opts.rows ?? 32));
    this.screen = new HeadlessTerminal({
      cols: this.cols,
      rows: this.rows,
      scrollback: SNAPSHOT_SCROLLBACK,
      allowProposedApi: true,
    });
    this.serializer = new SerializeAddon();
    this.screen.loadAddon(this.serializer);
  }

  async start(): Promise<StartResult> {
    const { spec, cwd, callbacks, log } = this.opts;
    const resolved = await findExecutable(spec.command);
    if (!resolved) throw new Error(`Command not found on PATH: ${spec.command}`);
    const { file, args } = ptyCommandLine(resolved, spec.args);
    const { spawn } = await import('@lydell/node-pty');
    log.info(`launching terminal ${file} ${args.join(' ')}`);
    const env = { ...process.env, ...(spec.env ?? {}), TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<
      string,
      string
    >;
    const pty = spawn(file, args, { name: 'xterm-256color', cols: this.cols, rows: this.rows, cwd, env });
    this.pty = pty;
    // On Windows, ConPTY answers terminal queries (cursor position, device attributes) itself. Elsewhere the
    // queries reach us raw: let the hub's emulator answer exactly once, whether zero or many viewers are open
    // (viewers drop their own automatic replies).
    if (process.platform !== 'win32') {
      this.screen.onData((reply) => {
        if (!this.exited) pty.write(reply);
      });
    }
    pty.onData((data) => {
      this.tail = (this.tail + data).slice(-TAIL_LIMIT);
      if (!this.exited) {
        this.unparsed.push(data);
        this.screen.write(data, () => this.unparsed.shift());
      }
      if (data.includes('\x1b[?2004h')) this.bracketedPaste = true;
      if (data.includes('\x1b[?2004l')) this.bracketedPaste = false;
      callbacks.onPtyData?.(data);
      if (data.includes('\x07') && Date.now() - this.lastBell > 30_000) {
        this.lastBell = Date.now();
        callbacks.emit({ kind: 'system', level: 'info', text: 'Terminal agent is requesting attention' });
      }
    });
    pty.onExit(({ exitCode, signal }) => {
      this.exited = true;
      callbacks.onExit({
        code: exitCode,
        signal: signal ? String(signal) : null,
        expected: this.stopping,
        stderrTail: stripAnsi(this.tail.slice(-1500)).trim(),
      });
      this.screen.dispose();
    });
    return {};
  }

  write(data: string): void {
    if (!this.exited) this.pty?.write(data);
  }

  resize(cols: number, rows: number): { cols: number; rows: number } | undefined {
    const next = clampPtySize(cols, rows);
    if (next.cols === this.cols && next.rows === this.rows) return next;
    if (this.pty && !this.exited) {
      try {
        this.pty.resize(next.cols, next.rows);
      } catch {
        return undefined; // the pty may have just exited
      }
    }
    this.cols = next.cols;
    this.rows = next.rows;
    this.screen.resize(next.cols, next.rows);
    return next;
  }

  size(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  /** Current screen + scrollback as escape sequences, to be written into a terminal of the current size. */
  snapshot(): string {
    return this.serializer.serialize({ scrollback: SNAPSHOT_SCROLLBACK }) + this.unparsed.join('');
  }

  /** Types the prompt into the terminal and presses Enter. */
  async prompt(text: string): Promise<{ stopReason: string }> {
    if (this.exited || !this.pty) throw new Error('Terminal is not running');
    const body = this.bracketedPaste ? `\x1b[200~${text}\x1b[201~` : text.replace(/\r?\n/g, ' ');
    this.pty.write(body);
    await new Promise((r) => setTimeout(r, 120));
    this.pty.write('\r');
    return { stopReason: 'sent' };
  }

  async cancel(): Promise<void> {
    this.write('\x1b');
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (!this.pty || this.exited) return;
    const pid = this.pty.pid;
    try {
      this.pty.kill();
    } catch {
      // ignore
    }
    killTree(pid);
  }
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g, '');
}
