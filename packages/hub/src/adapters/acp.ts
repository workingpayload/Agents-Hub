import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import type {
  AgentModeOption,
  PermissionOption,
  SessionConfigOptionInfo,
  ToolContent,
  ToolKind,
  ToolLocation,
  ToolStatus,
} from '@agent-hub/shared';
import { VERSION } from '../config.js';
import type { Logger } from '../logger.js';
import { killTree, type LaunchSpec } from './process.js';
import type { AdapterCallbacks, AgentAdapter, SessionSettingsInfo, StartResult } from './types.js';

export interface McpServerSpec {
  name: string;
  http?: { url: string; headers: Record<string, string> };
  stdio: { command: string; args: string[]; env: Record<string, string> };
}

export interface AcpAdapterOptions {
  spec: LaunchSpec;
  cwd: string;
  mcpServers: McpServerSpec[];
  /** ACP session id to resume via session/load when the agent supports it. */
  resumeSessionId?: string;
  callbacks: AdapterCallbacks;
  log: Logger;
  startupTimeoutMs?: number;
}

const TOOL_KINDS: ToolKind[] = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other'];

function mapToolKind(kind: unknown): ToolKind | undefined {
  return typeof kind === 'string' && (TOOL_KINDS as string[]).includes(kind) ? (kind as ToolKind) : kind ? 'other' : undefined;
}

function mapStatus(status: unknown): ToolStatus | undefined {
  return status === 'pending' || status === 'in_progress' || status === 'completed' || status === 'failed'
    ? status
    : undefined;
}

function contentBlockText(block: acp.ContentBlock | undefined): string {
  if (!block) return '';
  switch (block.type) {
    case 'text':
      return block.text;
    case 'image':
      return '[image]';
    case 'audio':
      return '[audio]';
    case 'resource_link':
      return `[${block.name ?? block.uri}](${block.uri})`;
    case 'resource':
      return 'text' in block.resource ? block.resource.text : `[resource ${block.resource.uri}]`;
    default:
      return '';
  }
}

export function mapToolContent(content: acp.ToolCallContent[] | null | undefined): ToolContent[] | undefined {
  if (!content) return undefined;
  const out: ToolContent[] = [];
  for (const c of content) {
    if (c.type === 'content') {
      const text = contentBlockText(c.content);
      if (text) out.push({ type: 'text', text });
    } else if (c.type === 'diff') {
      out.push({ type: 'diff', path: c.path, oldText: c.oldText ?? null, newText: c.newText });
    } else if (c.type === 'terminal') {
      out.push({ type: 'terminal', terminalId: c.terminalId });
    }
  }
  return out;
}

function mapLocations(locations: acp.ToolCallLocation[] | null | undefined): ToolLocation[] | undefined {
  return locations?.map((l) => ({ path: l.path, line: l.line ?? null }));
}

/** Produces a short human-readable description of what a tool call is about to do. */
export function describeToolInput(rawInput: unknown, locations?: ToolLocation[]): string | undefined {
  if (rawInput && typeof rawInput === 'object') {
    const r = rawInput as Record<string, unknown>;
    for (const key of ['command', 'cmd', 'commandLine', 'script']) {
      const v = r[key];
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return v.join(' ');
    }
    for (const key of ['file_path', 'path', 'filePath', 'url', 'pattern', 'query']) {
      const v = r[key];
      if (typeof v === 'string') return v;
    }
  }
  if (locations?.length) return locations.map((l) => l.path).join(', ');
  if (rawInput === undefined || rawInput === null) return undefined;
  const json = JSON.stringify(rawInput);
  return json.length > 500 ? `${json.slice(0, 500)}…` : json;
}

function mapConfigOptions(options: acp.SessionConfigOption[] | null | undefined): SessionConfigOptionInfo[] | undefined {
  if (!options) return undefined;
  const out: SessionConfigOptionInfo[] = [];
  for (const o of options) {
    if (o.type !== 'select') continue;
    const flat: { value: string; name: string; description?: string | null }[] = [];
    for (const entry of o.options) {
      if ('group' in entry) {
        for (const opt of entry.options) flat.push({ value: opt.value, name: opt.name, description: opt.description });
      } else {
        flat.push({ value: entry.value, name: entry.name, description: entry.description });
      }
    }
    out.push({
      id: o.id,
      name: o.name,
      description: o.description ?? null,
      category: (o.category as string | null | undefined) ?? null,
      currentValue: String(o.currentValue),
      options: flat,
    });
  }
  return out;
}

interface UnstableModels {
  availableModels?: { modelId: string; name: string; description?: string | null }[];
  currentModelId?: string;
}

function sessionSettingsFrom(resp: {
  modes?: acp.SessionModeState | null;
  configOptions?: acp.SessionConfigOption[] | null;
  models?: UnstableModels | null;
}): SessionSettingsInfo {
  const info: SessionSettingsInfo = {};
  if (resp.modes) {
    info.availableModes = resp.modes.availableModes.map(
      (m): AgentModeOption => ({ id: m.id, name: m.name, description: m.description ?? null }),
    );
    info.currentModeId = resp.modes.currentModeId;
  }
  const models = resp.models;
  if (models?.availableModels?.length) {
    const seen = new Set<string>();
    info.availableModels = models.availableModels
      .filter((m) => (seen.has(m.modelId) ? false : (seen.add(m.modelId), true)))
      .map((m) => ({ id: m.modelId, name: m.name, description: m.description ?? null }));
    info.currentModelId = models.currentModelId;
  }
  const config = mapConfigOptions(resp.configOptions);
  if (config) info.configOptions = config;
  return info;
}

/**
 * Drives an agent over the Agent Client Protocol (JSON-RPC over stdio) and translates its
 * session updates and permission requests into hub events.
 */
export class AcpAdapter implements AgentAdapter {
  readonly kind = 'structured' as const;
  private child?: ChildProcess;
  private conn?: acp.ClientConnection;
  private sessionId?: string;
  private stderrTail = '';
  private stopping = false;
  private exited = false;
  private replaying = false;
  private capabilities?: acp.AgentCapabilities;

  constructor(private opts: AcpAdapterOptions) {}

  async start(): Promise<StartResult> {
    const { spec, cwd, callbacks, log } = this.opts;
    log.info(`launching ${spec.command} ${spec.args.join(' ')}`);
    const child = spawn(spec.command, spec.args, {
      cwd,
      env: { ...process.env, ...(spec.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    const spawnError = new Promise<never>((_, reject) => {
      child.once('error', (err) => reject(new Error(`Failed to launch ${spec.command}: ${err.message}`)));
    });
    child.stderr?.on('data', (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-4000);
    });
    child.once('exit', (code, signal) => {
      this.exited = true;
      log.info(`agent process exited code=${code} signal=${signal}`);
      this.conn?.close();
      callbacks.onExit({ code, signal, expected: this.stopping, stderrTail: this.stderrTail.trim() });
    });

    const app = acp
      .client({ name: 'agent-hub' })
      .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
        const p = ctx.params;
        const tc = p.toolCall;
        const locations = mapLocations(tc.locations) ?? [];
        const answer = await callbacks.requestPermission({
          toolCallId: tc.toolCallId,
          title: tc.title ?? 'Permission requested',
          toolKind: mapToolKind(tc.kind),
          detail: describeToolInput(tc.rawInput, locations),
          content: mapToolContent(tc.content) ?? [],
          rawInput: tc.rawInput,
          options: p.options.map(
            (o): PermissionOption => ({ optionId: o.optionId, name: o.name, kind: o.kind }),
          ),
          signal: ctx.signal,
        });
        return {
          outcome: answer.outcome === 'selected' ? { outcome: 'selected', optionId: answer.optionId } : { outcome: 'cancelled' },
        };
      })
      .onNotification(acp.methods.client.session.update, async (ctx) => {
        if (this.replaying) return;
        this.handleUpdate(ctx.params.update);
      });

    this.conn = app.connect(
      acp.ndJsonStream(
        Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
      ),
    );

    const timeoutMs = this.opts.startupTimeoutMs ?? 90_000;
    const timeout = new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`Agent did not respond within ${timeoutMs / 1000}s`)), timeoutMs);
      t.unref?.();
    });
    const exitedEarly = new Promise<never>((_, reject) => {
      child.once('exit', (code) =>
        reject(new Error(`Agent exited during startup (code ${code}). ${this.stderrTail.trim().slice(-800)}`)),
      );
    });

    try {
      return await Promise.race([this.handshake(), spawnError, timeout, exitedEarly]);
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  private async handshake(): Promise<StartResult> {
    const conn = this.conn!;
    const { cwd, callbacks, log } = this.opts;
    const init = await conn.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'agent-hub', title: 'Agent Hub', version: VERSION },
    });
    this.capabilities = init.agentCapabilities;
    const mcpServers = this.buildMcpServers();

    if (this.opts.resumeSessionId && init.agentCapabilities?.loadSession) {
      try {
        this.replaying = true;
        const resp = await conn.agent.request(acp.methods.agent.session.load, {
          sessionId: this.opts.resumeSessionId,
          cwd,
          mcpServers,
        });
        this.sessionId = this.opts.resumeSessionId;
        callbacks.updateSettings(sessionSettingsFrom(resp as never));
        return { acpSessionId: this.sessionId, resumed: true };
      } catch (err) {
        log.warn('session/load failed; starting a new session', err);
      } finally {
        this.replaying = false;
      }
    }

    try {
      const resp = await conn.agent.request(acp.methods.agent.session.new, { cwd, mcpServers });
      this.sessionId = resp.sessionId;
      callbacks.updateSettings(sessionSettingsFrom(resp as never));
      return { acpSessionId: resp.sessionId, resumed: false };
    } catch (err) {
      throw this.explainError(err, init.authMethods ?? []);
    }
  }

  private explainError(err: unknown, authMethods: acp.AuthMethod[]): Error {
    const e = err as { code?: number; message?: string };
    const message = e?.message ?? String(err);
    if (e?.code === -32000 || /auth/i.test(message)) {
      const methods = authMethods.map((m) => m.name).join(', ');
      return new Error(
        `Agent needs authentication: ${message}${methods ? ` (supported: ${methods})` : ''}. ` +
          'Log in once using the agent CLI in a terminal session, then retry.',
      );
    }
    return new Error(message);
  }

  private buildMcpServers(): acp.McpServer[] {
    const httpOk = Boolean(this.capabilities?.mcpCapabilities?.http);
    return this.opts.mcpServers.map((s): acp.McpServer => {
      if (httpOk && s.http) {
        return {
          type: 'http',
          name: s.name,
          url: s.http.url,
          headers: Object.entries(s.http.headers).map(([name, value]) => ({ name, value })),
        };
      }
      return {
        name: s.name,
        command: s.stdio.command,
        args: s.stdio.args,
        env: Object.entries(s.stdio.env).map(([name, value]) => ({ name, value })),
      };
    });
  }

  private handleUpdate(update: acp.SessionUpdate): void {
    const { emit, updateSettings } = this.opts.callbacks;
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        emit({ kind: 'agent_message_chunk', text: contentBlockText(update.content) });
        break;
      case 'agent_thought_chunk':
        emit({ kind: 'agent_thought_chunk', text: contentBlockText(update.content) });
        break;
      case 'tool_call':
        emit({
          kind: 'tool_call',
          toolCallId: update.toolCallId,
          title: update.title,
          toolKind: mapToolKind(update.kind) ?? 'other',
          status: mapStatus(update.status) ?? 'pending',
          content: mapToolContent(update.content) ?? [],
          locations: mapLocations(update.locations) ?? [],
          rawInput: update.rawInput,
        });
        break;
      case 'tool_call_update':
        emit({
          kind: 'tool_call_update',
          toolCallId: update.toolCallId,
          title: update.title ?? undefined,
          toolKind: mapToolKind(update.kind),
          status: mapStatus(update.status),
          content: mapToolContent(update.content),
          locations: mapLocations(update.locations),
          rawOutput: update.rawOutput,
        });
        break;
      case 'plan':
        emit({
          kind: 'plan',
          entries: update.entries.map((e) => ({ content: e.content, status: e.status, priority: e.priority })),
        });
        break;
      case 'current_mode_update':
        updateSettings({ currentModeId: update.currentModeId });
        emit({ kind: 'mode_changed', modeId: update.currentModeId });
        break;
      case 'config_option_update': {
        const configOptions = mapConfigOptions(update.configOptions);
        if (configOptions) updateSettings({ configOptions });
        break;
      }
      case 'session_info_update':
        if (update.title) updateSettings({ title: update.title });
        break;
      case 'notice':
        emit({
          kind: 'system',
          level: update.severity === 'error' ? 'error' : update.severity === 'warning' ? 'warn' : 'info',
          text: update.description ? `${update.title}: ${update.description}` : update.title,
        });
        break;
      default:
        break;
    }
  }

  async prompt(text: string): Promise<{ stopReason: string }> {
    if (!this.conn || !this.sessionId || this.exited) throw new Error('Agent is not running');
    const resp = await this.conn.agent.request(acp.methods.agent.session.prompt, {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });
    return { stopReason: resp.stopReason };
  }

  async cancel(): Promise<void> {
    if (!this.conn || !this.sessionId || this.exited) return;
    await this.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId });
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.conn || !this.sessionId) throw new Error('Agent is not running');
    await this.conn.agent.request(acp.methods.agent.session.setMode, { sessionId: this.sessionId, modeId });
    this.opts.callbacks.updateSettings({ currentModeId: modeId });
  }

  async setModel(modelId: string): Promise<void> {
    if (!this.conn || !this.sessionId) throw new Error('Agent is not running');
    // session/set_model is still an unstable ACP method, so it is sent by name.
    await this.conn.agent.request('session/set_model', { sessionId: this.sessionId, modelId });
    this.opts.callbacks.updateSettings({ currentModelId: modelId });
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    if (!this.conn || !this.sessionId) throw new Error('Agent is not running');
    const resp = await this.conn.agent.request(acp.methods.agent.session.setConfigOption, {
      sessionId: this.sessionId,
      configId,
      value,
    });
    const configOptions = mapConfigOptions((resp as { configOptions?: acp.SessionConfigOption[] })?.configOptions);
    if (configOptions) this.opts.callbacks.updateSettings({ configOptions });
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const child = this.child;
    try {
      this.conn?.close();
    } catch {
      // ignore
    }
    if (!child || this.exited) return;
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        killTree(child.pid);
        resolve();
      }, 1500);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
