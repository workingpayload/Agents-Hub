import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSION = '0.1.0';
export const APP_NAME = 'Agent Hub';

export interface HubOptions {
  /** Directory for the database, certificates, tokens and worktrees. */
  dataDir?: string;
  /** HTTPS port for LAN devices. */
  port?: number;
  /** HTTP port bound to 127.0.0.1 for the desktop shell, local browser and agent MCP calls. */
  localPort?: number;
  /** Address the LAN listener binds to. */
  host?: string;
  /** Disable the LAN listener entirely (local-only mode). */
  lan?: boolean;
  /** Directory containing the built web UI. */
  webDir?: string;
  /** Register the built-in "Echo" test agent. */
  enableTestAgent?: boolean;
  logLevel?: LogLevel;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface ResolvedOptions {
  dataDir: string;
  port: number;
  localPort: number;
  host: string;
  lan: boolean;
  webDir?: string;
  enableTestAgent: boolean;
  logLevel: LogLevel;
}

export function defaultDataDir(): string {
  if (process.env.AGENT_HUB_DATA_DIR) return process.env.AGENT_HUB_DATA_DIR;
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'AgentHub');
  return path.join(os.homedir(), '.agent-hub');
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Directory of the running hub module (dist/ when built, src/ when run from source). */
export function hubModuleDir(): string {
  return moduleDir;
}

export function defaultWebDir(): string | undefined {
  const candidates = [
    process.env.AGENT_HUB_WEB_DIR,
    path.resolve(moduleDir, '../../web/dist'),
    path.resolve(moduleDir, '../web'),
  ].filter(Boolean) as string[];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));
}

export function resolveOptions(opts: HubOptions = {}): ResolvedOptions {
  const envPort = process.env.AGENT_HUB_PORT ? Number(process.env.AGENT_HUB_PORT) : undefined;
  const envLocalPort = process.env.AGENT_HUB_LOCAL_PORT ? Number(process.env.AGENT_HUB_LOCAL_PORT) : undefined;
  return {
    dataDir: path.resolve(opts.dataDir ?? defaultDataDir()),
    port: opts.port ?? envPort ?? 7443,
    localPort: opts.localPort ?? envLocalPort ?? 7780,
    host: opts.host ?? '0.0.0.0',
    lan: opts.lan ?? true,
    webDir: opts.webDir ?? defaultWebDir(),
    enableTestAgent: opts.enableTestAgent ?? process.env.AGENT_HUB_TEST_AGENT === '1',
    logLevel: opts.logLevel ?? ((process.env.AGENT_HUB_LOG_LEVEL as LogLevel) || 'info'),
  };
}

/**
 * Resolves a sibling entry script (e.g. the MCP bridge or test agent) to a node command line.
 * Works both from the bundled dist/ (plain .js) and from source via tsx (.ts).
 */
export function resolveEntryCommand(name: string): { command: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {};
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  const js = path.join(moduleDir, `${name}.js`);
  if (fs.existsSync(js)) return { command: process.execPath, args: [js], env };
  const ts = path.join(moduleDir, `${name}.ts`);
  if (fs.existsSync(ts)) {
    // Resolve tsx from here: the child runs in the session's working directory where tsx is not installed.
    const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    return { command: process.execPath, args: ['--import', loader, ts], env };
  }
  throw new Error(`Cannot locate entry script "${name}" next to ${moduleDir}`);
}
