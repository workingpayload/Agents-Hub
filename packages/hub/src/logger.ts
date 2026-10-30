import type { LogLevel } from './config.js';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
  child(scope: string): Logger;
}

export function createLogger(level: LogLevel = 'info', scope = 'hub'): Logger {
  const threshold = ORDER[level];
  const write = (lvl: LogLevel, msg: string, extra?: unknown) => {
    if (ORDER[lvl] < threshold) return;
    const ts = new Date().toISOString();
    const line = `${ts} ${lvl.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
    const stream = lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout;
    if (extra !== undefined) {
      const detail = extra instanceof Error ? (extra.stack ?? extra.message) : safeStringify(extra);
      stream.write(`${line} ${detail}\n`);
    } else {
      stream.write(`${line}\n`);
    }
  };
  return {
    debug: (m, e) => write('debug', m, e),
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    error: (m, e) => write('error', m, e),
    child: (s) => createLogger(level, `${scope}:${s}`),
  };
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}
