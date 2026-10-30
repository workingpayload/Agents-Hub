import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AgentInfo, SessionMode } from '@agent-hub/shared';
import { resolveEntryCommand } from '../config.js';
import type { HubBus } from '../bus.js';
import type { Logger } from '../logger.js';
import { findExecutable, readVersion, type LaunchSpec } from '../adapters/process.js';
import type { SettingsStore } from './settings.js';

const require = createRequire(import.meta.url);

interface AgentProfile {
  id: string;
  name: string;
  description: string;
  /** CLI used for detection, version and terminal mode. */
  cli?: string;
  structured: () => LaunchSpec;
  terminal?: () => LaunchSpec;
  test?: boolean;
}

/** Resolves the JS entry of an npm package's bin so it can be run with the current Node runtime. */
function nodePackageBin(pkg: string, bin: string): LaunchSpec {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { bin?: string | Record<string, string> };
  const rel = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[bin];
  if (!rel) throw new Error(`${pkg} has no "${bin}" binary`);
  const env: Record<string, string> = {};
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  return { command: process.execPath, args: [path.join(path.dirname(pkgJsonPath), rel)], env };
}

function builtinProfiles(enableTestAgent: boolean): AgentProfile[] {
  const profiles: AgentProfile[] = [
    {
      id: 'copilot',
      name: 'GitHub Copilot CLI',
      description: 'GitHub Copilot coding agent (native ACP via `copilot --acp`).',
      cli: 'copilot',
      structured: () => ({ command: 'copilot', args: ['--acp'] }),
      terminal: () => ({ command: 'copilot', args: [] }),
    },
    {
      id: 'claude',
      name: 'Claude Code',
      description: 'Anthropic Claude Code (ACP via @agentclientprotocol/claude-agent-acp).',
      cli: 'claude',
      structured: () => nodePackageBin('@agentclientprotocol/claude-agent-acp', 'claude-agent-acp'),
      terminal: () => ({ command: 'claude', args: [] }),
    },
    {
      id: 'codex',
      name: 'OpenAI Codex CLI',
      description: 'OpenAI Codex (ACP via @agentclientprotocol/codex-acp).',
      cli: 'codex',
      structured: () => nodePackageBin('@agentclientprotocol/codex-acp', 'codex-acp'),
      terminal: () => ({ command: 'codex', args: [] }),
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      description: 'Google Gemini CLI (native ACP via `gemini --acp`).',
      cli: 'gemini',
      structured: () => ({ command: 'gemini', args: ['--acp'] }),
      terminal: () => ({ command: 'gemini', args: [] }),
    },
  ];
  if (enableTestAgent) {
    profiles.push({
      id: 'echo',
      name: 'Echo Agent (test)',
      description: 'Built-in scripted ACP agent for demos and tests. Echoes prompts and can ask for permissions.',
      structured: () => resolveEntryCommand('test-agent'),
      terminal: () => {
        const spec = resolveEntryCommand('test-agent');
        return { ...spec, args: [...spec.args, '--terminal'] };
      },
      test: true,
    });
  }
  return profiles;
}

interface Detection {
  installed: boolean;
  version?: string;
  cliPath?: string;
  structuredError?: string;
}

export class AgentRegistry {
  private profiles: AgentProfile[];
  private detections = new Map<string, Detection>();
  private activeCounter: (agentId: string) => number = () => 0;
  private refreshing?: Promise<AgentInfo[]>;
  private countsTimer?: NodeJS.Timeout;

  constructor(
    private settings: SettingsStore,
    private bus: HubBus,
    private log: Logger,
    opts: { enableTestAgent: boolean },
  ) {
    this.profiles = builtinProfiles(opts.enableTestAgent);
  }

  setActiveCounter(fn: (agentId: string) => number): void {
    this.activeCounter = fn;
  }

  /** Re-broadcasts agent info so clients see updated active session counts. */
  refreshCounts(): void {
    if (this.countsTimer) return;
    this.countsTimer = setTimeout(() => {
      this.countsTimer = undefined;
      this.bus.emit('agents', this.list());
    }, 100);
    this.countsTimer.unref?.();
  }

  has(id: string): boolean {
    return this.profiles.some((p) => p.id === id);
  }

  refresh(): Promise<AgentInfo[]> {
    if (!this.refreshing) {
      this.refreshing = Promise.all(this.profiles.map((p) => this.detect(p)))
        .then(() => {
          const list = this.list();
          this.bus.emit('agents', list);
          return list;
        })
        .finally(() => {
          this.refreshing = undefined;
        });
    }
    return this.refreshing;
  }

  private async detect(profile: AgentProfile): Promise<void> {
    const detection: Detection = { installed: Boolean(profile.test) };
    const overrides = this.settings.agent(profile.id);
    try {
      this.structuredSpec(profile, overrides.command, overrides.args);
    } catch (err) {
      detection.structuredError = (err as Error).message;
    }
    if (profile.cli) {
      const cliPath = await findExecutable(overrides.terminalCommand || profile.cli);
      if (cliPath) {
        detection.installed = true;
        detection.cliPath = cliPath;
        detection.version = await readVersion(cliPath).catch(() => undefined);
      }
    } else if (profile.test) {
      detection.version = 'built-in';
    }
    this.detections.set(profile.id, detection);
    this.log.debug(`detected ${profile.id}`, detection);
  }

  list(): AgentInfo[] {
    return this.profiles.map((p) => this.info(p));
  }

  get(id: string): AgentInfo | undefined {
    const p = this.profiles.find((x) => x.id === id);
    return p ? this.info(p) : undefined;
  }

  private info(p: AgentProfile): AgentInfo {
    const d = this.detections.get(p.id);
    const s = this.settings.agent(p.id);
    const nativeAcp = p.id === 'copilot' || p.id === 'gemini';
    const structuredAvailable = Boolean(d) && !d?.structuredError && (nativeAcp ? Boolean(d?.installed) : true);
    const terminalAvailable = Boolean(p.terminal) && Boolean(d?.installed);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      installed: d?.installed ?? false,
      version: d?.version,
      structured: {
        available: structuredAvailable,
        reason: !d
          ? 'Detecting…'
          : d.structuredError ?? (nativeAcp && !d.installed ? `${p.cli} CLI not found on PATH` : undefined),
        command: s.command,
      },
      terminal: {
        available: terminalAvailable,
        reason: !d ? 'Detecting…' : !d.installed ? `${p.cli ?? p.id} CLI not found on PATH` : undefined,
        command: d?.cliPath,
      },
      enabled: s.enabled,
      defaultMode: s.defaultMode,
      autoApprove: s.autoApprove,
      activeSessions: this.activeCounter(p.id),
      test: p.test,
    };
  }

  private structuredSpec(p: AgentProfile, command?: string, args?: string[]): LaunchSpec {
    if (command) return { command, args: args ?? [] };
    const spec = p.structured();
    if (!args?.length) return spec;
    // Keep the script path when the launcher is "node <script>", replace the remaining arguments.
    return { ...spec, args: [...spec.args.slice(0, spec.command === process.execPath ? 1 : 0), ...args] };
  }

  /** Builds the launch command for an agent in the requested mode, applying user overrides. */
  launchSpec(agentId: string, mode: SessionMode): LaunchSpec {
    const p = this.profiles.find((x) => x.id === agentId);
    if (!p) throw new Error(`Unknown agent: ${agentId}`);
    const s = this.settings.agent(agentId);
    let spec: LaunchSpec;
    if (mode === 'structured') {
      spec = this.structuredSpec(p, s.command, s.args);
    } else {
      if (!p.terminal && !s.terminalCommand) throw new Error(`${p.name} has no terminal mode`);
      const base = p.terminal ? p.terminal() : { command: s.terminalCommand!, args: [] };
      spec = {
        ...base,
        command: s.terminalCommand || base.command,
        args: s.terminalArgs?.length ? s.terminalArgs : base.args,
      };
    }
    return { ...spec, env: { ...(spec.env ?? {}), ...(s.env ?? {}) } };
  }
}
