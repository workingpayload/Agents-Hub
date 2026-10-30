import { execFile, spawnSync } from 'node:child_process';
import path from 'node:path';
import which from 'which';

export interface LaunchSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Locates a command on PATH (same PATH/PATHEXT order the shell and cross-spawn use). */
export async function findExecutable(command: string): Promise<string | null> {
  if (path.isAbsolute(command)) return command;
  return (await which(command, { nothrow: true })) ?? null;
}

/**
 * node-pty needs a real executable on Windows; wrap batch shims (npm .cmd files) with cmd.exe.
 */
export function ptyCommandLine(resolved: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', resolved, ...args] };
  }
  return { file: resolved, args };
}

/** Kills a process and all of its children (agents are often launched through shell shims). */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }
    }
  } catch {
    // already gone
  }
}

/** Runs `<command> --version` (or custom args) and returns the first output line. */
export function readVersion(resolved: string, args: string[] = ['--version'], timeoutMs = 20_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    const isBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
    const file = isBatch ? (process.env.ComSpec ?? 'cmd.exe') : resolved;
    const fileArgs = isBatch ? ['/d', '/s', '/c', `"${resolved}"`, ...args] : args;
    execFile(
      file,
      fileArgs,
      { timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: isBatch, env: process.env },
      (err, stdout, stderr) => {
        const text = `${stdout ?? ''}\n${stderr ?? ''}`
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => /\d+\.\d+/.test(l));
        if (err && !text) return resolve(undefined);
        resolve(text?.slice(0, 120));
      },
    );
  });
}
