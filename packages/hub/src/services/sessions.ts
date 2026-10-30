import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Actor,
  AutoApprove,
  DelegationPolicy,
  IsolationMode,
  QueuedPrompt,
  SessionConfigBody,
  SessionInfo,
  SessionMode,
  SessionStatus,
  UpdateSessionBody,
  WorkspaceInfo,
} from '@agent-hub/shared';
import { isSessionActive } from '@agent-hub/shared';
import { audit, type Db } from '../db.js';
import type { HubBus } from '../bus.js';
import type { Logger } from '../logger.js';
import { AcpAdapter, type McpServerSpec } from '../adapters/acp.js';
import { PtyAdapter } from '../adapters/pty.js';
import type { AdapterCallbacks, AgentAdapter, SessionSettingsInfo } from '../adapters/types.js';
import type { AgentRegistry } from './agents.js';
import type { EventStore } from './events.js';
import type { PermissionBroker } from './permissions.js';
import type { SettingsStore } from './settings.js';
import type { WorktreeService } from './worktree.js';

export interface CreateSessionInput {
  agentId: string;
  mode?: SessionMode;
  cwd?: string;
  title?: string;
  prompt?: string;
  isolation?: IsolationMode;
  autoApprove?: AutoApprove;
  delegationPolicy?: DelegationPolicy;
  createdBy: Actor;
  parentSessionId?: string;
  taskId?: string;
  depth?: number;
}

/** Persisted session record: public info plus internal bookkeeping. */
interface SessionRecord extends SessionInfo {
  acpSessionId?: string;
  titleLocked?: boolean;
}

interface Runtime {
  adapter: AgentAdapter;
  ready: boolean;
  busy: boolean;
  mcpToken: string;
}

export type McpServersProvider = (sessionId: string, token: string) => McpServerSpec[];

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SessionManagerDeps {
  db: Db;
  bus: HubBus;
  events: EventStore;
  registry: AgentRegistry;
  settings: SettingsStore;
  broker: PermissionBroker;
  worktrees: WorktreeService;
  log: Logger;
}

export class SessionManager {
  private sessions = new Map<string, SessionRecord>();
  private runtimes = new Map<string, Runtime>();
  private mcpTokens = new Map<string, string>();
  private mcpProvider: McpServersProvider = () => [];

  constructor(private deps: SessionManagerDeps) {
    deps.broker.onPendingChange((sessionId) => this.syncPermissionStatus(sessionId));
    deps.registry.setActiveCounter((agentId) => this.activeCount(agentId));
  }

  setMcpProvider(provider: McpServersProvider): void {
    this.mcpProvider = provider;
  }

  /** Loads persisted sessions; anything that was live when the hub stopped is marked stopped. */
  load(): void {
    const rows = this.deps.db.prepare('SELECT data FROM sessions ORDER BY created_at ASC').all() as { data: string }[];
    for (const row of rows) {
      const s = JSON.parse(row.data) as SessionRecord;
      s.availableModels ??= [];
      s.configOptions ??= [];
      s.queue ??= [];
      if (isSessionActive(s.status)) {
        s.status = 'stopped';
        s.statusMessage = 'Hub restarted';
        s.queue = [];
      }
      this.sessions.set(s.id, s);
      this.persist(s);
    }
  }

  list(includeArchived = false): SessionInfo[] {
    return [...this.sessions.values()]
      .filter((s) => includeArchived || !s.archived)
      .map((s) => this.view(s))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): SessionInfo | undefined {
    const s = this.sessions.get(id);
    return s ? this.view(s) : undefined;
  }

  require(id: string): SessionInfo {
    const s = this.get(id);
    if (!s) throw new HttpError(404, 'Session not found');
    return s;
  }

  sessionForMcpToken(token: string): SessionInfo | undefined {
    const id = this.mcpTokens.get(token);
    return id ? this.get(id) : undefined;
  }

  activeCount(agentId?: string): number {
    let n = 0;
    for (const id of this.runtimes.keys()) {
      if (!agentId || this.sessions.get(id)?.agentId === agentId) n++;
    }
    return n;
  }

  isLive(id: string): boolean {
    return this.runtimes.get(id)?.ready ?? false;
  }

  async create(input: CreateSessionInput): Promise<SessionInfo> {
    const { registry, settings, worktrees } = this.deps;
    const agent = registry.get(input.agentId);
    if (!agent) throw new HttpError(404, `Unknown agent: ${input.agentId}`);
    if (!agent.enabled) throw new HttpError(400, `${agent.name} is disabled in settings`);
    const mode = input.mode ?? agent.defaultMode;
    const capability = mode === 'structured' ? agent.structured : agent.terminal;
    if (!capability.available) {
      throw new HttpError(400, `${agent.name} cannot run in ${mode} mode: ${capability.reason ?? 'unavailable'}`);
    }
    const limits = settings.get().orchestration;
    if (this.activeCount() >= limits.maxConcurrentSessions) {
      throw new HttpError(429, `Concurrent session limit reached (${limits.maxConcurrentSessions}). Stop a session first.`);
    }
    const baseCwd = path.resolve(input.cwd || settings.get().defaultCwd);
    if (!fs.existsSync(baseCwd) || !fs.statSync(baseCwd).isDirectory()) {
      throw new HttpError(400, `Working directory does not exist: ${baseCwd}`);
    }

    const id = randomUUID();
    let cwd = baseCwd;
    let workspace: WorkspaceInfo = { type: 'shared', baseCwd };
    if (input.isolation === 'worktree') {
      try {
        const wt = await worktrees.create(baseCwd, id, agent.id);
        cwd = wt.cwd;
        workspace = { type: 'worktree', baseCwd, worktreePath: wt.worktreePath, branch: wt.branch };
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    }

    const now = Date.now();
    const prompt = input.prompt?.trim();
    const session: SessionRecord = {
      id,
      agentId: agent.id,
      title: input.title?.trim() || (prompt ? truncate(prompt, 70) : `${agent.name} session`),
      titleLocked: Boolean(input.title?.trim()),
      mode,
      cwd,
      workspace,
      status: 'starting',
      parentSessionId: input.parentSessionId,
      taskId: input.taskId,
      depth: input.depth ?? 0,
      delegationPolicy: input.delegationPolicy ?? limits.defaultDelegationPolicy,
      autoApprove: input.autoApprove ?? settings.agent(agent.id).autoApprove,
      availableModes: [],
      availableModels: [],
      configOptions: [],
      queue: [],
      lastSeq: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy.name,
    };
    this.sessions.set(id, session);
    if (prompt && mode === 'structured') session.queue.push({ id: randomUUID(), text: prompt, from: input.createdBy });
    this.persist(session);
    this.publish(session);
    audit(this.deps.db, input.createdBy.name, 'session.create', { id, agent: agent.id, mode, cwd });
    this.deps.events.append(id, {
      kind: 'system',
      level: 'info',
      text: `Session started by ${input.createdBy.name} in ${cwd}${workspace.type === 'worktree' ? ` (worktree ${workspace.branch})` : ''}`,
    });

    void this.startRuntime(session, false).then((ok) => {
      if (ok && prompt && mode === 'terminal') {
        setTimeout(() => void this.prompt(id, prompt, input.createdBy).catch(() => undefined), 2500);
      }
    });
    return this.view(session);
  }

  private async startRuntime(session: SessionRecord, resume: boolean): Promise<boolean> {
    const { registry, events, broker, log } = this.deps;
    const id = session.id;
    let adapter: AgentAdapter;
    const token = randomBytes(24).toString('base64url');
    const slog = log.child(`${session.agentId}:${id.slice(0, 8)}`);

    const callbacks: AdapterCallbacks = {
      emit: (payload) => events.append(id, payload),
      requestPermission: (ask) => {
        const s = this.sessions.get(id)!;
        return broker.request({
          sessionId: id,
          agentId: s.agentId,
          type: 'tool',
          title: ask.title,
          toolKind: ask.toolKind,
          detail: ask.detail,
          content: ask.content,
          rawInput: ask.rawInput,
          options: ask.options,
          autoApprove: s.autoApprove,
          signal: ask.signal,
        });
      },
      updateSettings: (info) => this.applySettingsInfo(id, info),
      onExit: ({ code, expected, stderrTail }) => {
        const rt = this.runtimes.get(id);
        if (!rt || rt.adapter !== adapter) return;
        this.runtimes.delete(id);
        this.mcpTokens.delete(rt.mcpToken);
        broker.cancelForSession(id);
        const s = this.sessions.get(id);
        if (s) s.queue = [];
        if (expected) {
          this.setStatus(id, 'stopped');
        } else if (session.mode === 'terminal' && code === 0) {
          this.setStatus(id, 'stopped', 'Terminal exited');
        } else {
          const tail = stderrTail ? `: ${truncate(stderrTail, 600)}` : '';
          this.setStatus(id, 'error', `Agent exited unexpectedly (code ${code})${tail}`);
        }
        this.deps.registry.refreshCounts();
      },
      onPtyData: (data) => this.deps.bus.emit('pty_output', id, data),
    };

    try {
      const spec = registry.launchSpec(session.agentId, session.mode);
      adapter =
        session.mode === 'structured'
          ? new AcpAdapter({
              spec,
              cwd: session.cwd,
              mcpServers: this.mcpProvider(id, token),
              resumeSessionId: resume ? session.acpSessionId : undefined,
              callbacks,
              log: slog,
            })
          : new PtyAdapter({ spec, cwd: session.cwd, callbacks, log: slog });
    } catch (err) {
      this.setStatus(id, 'error', (err as Error).message);
      return false;
    }

    const rt: Runtime = { adapter, ready: false, busy: false, mcpToken: token };
    this.runtimes.set(id, rt);
    this.mcpTokens.set(token, id);
    this.setStatus(id, 'starting');
    this.deps.registry.refreshCounts();

    try {
      const result = await adapter.start();
      if (this.runtimes.get(id) !== rt) return false;
      rt.ready = true;
      if (result.acpSessionId) session.acpSessionId = result.acpSessionId;
      if (resume) {
        events.append(id, {
          kind: 'system',
          level: 'info',
          text: result.resumed ? 'Agent restarted; previous conversation restored.' : 'Agent restarted with a fresh conversation.',
        });
      }
      this.setStatus(id, 'idle');
      void this.pump(id);
      return true;
    } catch (err) {
      slog.warn('failed to start agent', err);
      if (this.runtimes.get(id) === rt) {
        this.runtimes.delete(id);
        this.mcpTokens.delete(token);
      }
      session.queue = [];
      this.setStatus(id, 'error', (err as Error).message);
      this.deps.registry.refreshCounts();
      return false;
    }
  }

  /** Sends the next queued prompt if the agent is idle. Structured sessions process one turn at a time. */
  private async pump(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    const s = this.sessions.get(id);
    if (!rt || !s || !rt.ready || rt.busy || rt.adapter.kind !== 'structured') return;
    const next = s.queue.shift();
    if (!next) return;
    rt.busy = true;
    const { events, bus, broker } = this.deps;
    events.append(id, { kind: 'user_message', text: next.text, from: next.from });
    const startSeq = events.lastSeq(id);
    this.setStatus(id, 'running');
    let stopReason = 'end_turn';
    let error: string | undefined;
    try {
      ({ stopReason } = await rt.adapter.prompt(next.text));
    } catch (err) {
      error = (err as Error).message;
      stopReason = 'error';
      events.append(id, { kind: 'system', level: 'error', text: `Prompt failed: ${error}` });
    }
    rt.busy = false;
    broker.cancelForSession(id);
    events.append(id, { kind: 'turn_end', stopReason });
    if (this.runtimes.get(id) === rt) this.setStatus(id, 'idle');
    bus.emit('turn_end', { sessionId: id, stopReason, startSeq, error });
    void this.pump(id);
  }

  async prompt(id: string, text: string, from: Actor): Promise<{ queued: boolean }> {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, 'Session not found');
    const rt = this.runtimes.get(id);
    if (!rt) throw new HttpError(409, `Session is ${s.status}. Restart it to continue.`);
    if (rt.adapter.kind === 'terminal') {
      if (!rt.ready) throw new HttpError(409, 'Terminal is still starting');
      this.deps.events.append(id, { kind: 'user_message', text, from });
      await rt.adapter.prompt(text);
      return { queued: false };
    }
    const queued = rt.busy || !rt.ready || s.queue.length > 0;
    s.queue.push({ id: randomUUID(), text, from });
    this.touch(s);
    void this.pump(id);
    return { queued };
  }

  removeQueued(id: string, queueId: string): SessionInfo {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, 'Session not found');
    s.queue = s.queue.filter((q) => q.id !== queueId);
    this.touch(s);
    return this.view(s);
  }

  async cancel(id: string, by: Actor): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, 'Session not found');
    s.queue = [];
    this.touch(s);
    this.deps.broker.cancelForSession(id, by);
    await this.runtimes.get(id)?.adapter.cancel();
    this.deps.events.append(id, { kind: 'system', level: 'warn', text: `Turn cancelled by ${by.name}` });
  }

  async stop(id: string, by: Actor, reason?: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, 'Session not found');
    const rt = this.runtimes.get(id);
    this.runtimes.delete(id);
    if (rt) this.mcpTokens.delete(rt.mcpToken);
    s.queue = [];
    this.deps.broker.cancelForSession(id, by);
    if (rt) await rt.adapter.stop().catch(() => undefined);
    if (isSessionActive(s.status)) {
      this.deps.events.append(id, { kind: 'system', level: 'info', text: `Stopped by ${by.name}${reason ? ` (${reason})` : ''}` });
      this.setStatus(id, 'stopped', reason);
    }
    this.deps.registry.refreshCounts();
    audit(this.deps.db, by.name, 'session.stop', { id, reason });
    // Stopping a parent also stops the sub-agents it delegated to.
    for (const child of this.sessions.values()) {
      if (child.parentSessionId === id && this.runtimes.has(child.id)) {
        await this.stop(child.id, by, 'parent session stopped');
      }
    }
  }

  async restart(id: string, by: Actor): Promise<SessionInfo> {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, 'Session not found');
    if (this.runtimes.has(id)) await this.stop(id, by, 'restarting');
    const limits = this.deps.settings.get().orchestration;
    if (this.activeCount() >= limits.maxConcurrentSessions) {
      throw new HttpError(429, `Concurrent session limit reached (${limits.maxConcurrentSessions}).`);
    }
    if (s.workspace.worktreePath && !fs.existsSync(s.workspace.worktreePath)) {
      throw new HttpError(409, 'The worktree for this session was removed');
    }
    s.archived = false;
    void this.startRuntime(s, true);
    return this.view(s);
  }

  async update(id: string, patch: UpdateSessionBody, by: Actor): Promise<SessionInfo> {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, 'Session not found');
    if (patch.title) {
      s.title = patch.title;
      s.titleLocked = true;
    }
    if (patch.delegationPolicy) s.delegationPolicy = patch.delegationPolicy;
    if (patch.autoApprove) s.autoApprove = patch.autoApprove;
    if (patch.archived !== undefined) s.archived = patch.archived;
    if (patch.modeId) await this.configure(id, { modeId: patch.modeId });
    audit(this.deps.db, by.name, 'session.update', { id, patch });
    this.touch(s);
    return this.view(s);
  }

  async configure(id: string, body: SessionConfigBody): Promise<SessionInfo> {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, 'Session not found');
    const rt = this.runtimes.get(id);
    if (!rt?.ready) throw new HttpError(409, 'Session is not running');
    const a = rt.adapter;
    try {
      if (body.modeId) {
        if (!a.setMode) throw new Error('This session does not support modes');
        await a.setMode(body.modeId);
      }
      if (body.modelId) {
        if (!a.setModel) throw new Error('This session does not support model selection');
        await a.setModel(body.modelId);
      }
      if (body.configId && body.value) {
        if (!a.setConfigOption) throw new Error('This session does not support configuration options');
        await a.setConfigOption(body.configId, body.value);
      }
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    return this.view(s);
  }

  async remove(id: string, by: Actor): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, 'Session not found');
    if (this.runtimes.has(id)) await this.stop(id, by, 'deleted');
    if (s.workspace.type === 'worktree' && s.workspace.worktreePath) {
      await this.deps.worktrees
        .remove(s.workspace.baseCwd, s.workspace.worktreePath, s.workspace.branch, false)
        .catch((err) => this.deps.log.warn('failed to remove worktree', err));
    }
    this.sessions.delete(id);
    this.deps.events.deleteSession(id);
    this.deps.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    audit(this.deps.db, by.name, 'session.delete', { id });
    this.deps.bus.emit('session_removed', id);
  }

  /** Marks the worktree as gone after the user removed it. */
  markWorktreeRemoved(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.deps.events.append(id, { kind: 'system', level: 'info', text: 'Worktree removed' });
    this.touch(s);
  }

  ptyInput(id: string, data: string): void {
    const rt = this.runtimes.get(id);
    if (rt?.adapter.kind === 'terminal') rt.adapter.write?.(data);
  }

  ptyResize(id: string, cols: number, rows: number): { cols: number; rows: number } | undefined {
    const rt = this.runtimes.get(id);
    return rt?.adapter.kind === 'terminal' ? rt.adapter.resize?.(cols, rows) : undefined;
  }

  ptySize(id: string): { cols: number; rows: number } | undefined {
    const rt = this.runtimes.get(id);
    return rt?.adapter.kind === 'terminal' ? rt.adapter.size?.() : undefined;
  }

  ptySnapshot(id: string): string | undefined {
    const rt = this.runtimes.get(id);
    return rt?.adapter.kind === 'terminal' ? rt.adapter.snapshot?.() : undefined;
  }

  async stopAll(by: Actor, reason = 'stop all'): Promise<number> {
    const ids = [...this.runtimes.keys()];
    await Promise.all(ids.map((id) => this.stop(id, by, reason).catch(() => undefined)));
    return ids.length;
  }

  private applySettingsInfo(id: string, info: SessionSettingsInfo): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (info.availableModes) s.availableModes = info.availableModes;
    if (info.currentModeId) s.currentModeId = info.currentModeId;
    if (info.availableModels) s.availableModels = info.availableModels;
    if (info.currentModelId) s.currentModelId = info.currentModelId;
    if (info.configOptions) s.configOptions = info.configOptions;
    if (info.title && !s.titleLocked) s.title = truncate(info.title, 120);
    this.touch(s);
  }

  private syncPermissionStatus(id: string): void {
    const s = this.sessions.get(id);
    const rt = this.runtimes.get(id);
    if (!s || !rt?.ready) return;
    const pending = this.deps.broker.pendingCount(id) > 0;
    if (pending && s.status !== 'awaiting_permission') this.setStatus(id, 'awaiting_permission');
    else if (!pending && s.status === 'awaiting_permission') this.setStatus(id, rt.busy ? 'running' : 'idle');
  }

  private setStatus(id: string, status: SessionStatus, message?: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.status === status && s.statusMessage === message) return;
    s.status = status;
    s.statusMessage = message;
    if (status === 'error' || status === 'stopped' || status === 'starting') {
      this.deps.events.append(id, { kind: 'status', status, message });
    }
    this.touch(s);
  }

  private touch(s: SessionRecord): void {
    s.updatedAt = Date.now();
    this.persist(s);
    this.publish(s);
  }

  private persist(s: SessionRecord): void {
    this.deps.db
      .prepare(
        `INSERT INTO sessions (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(s.id, JSON.stringify(s), s.createdAt, s.updatedAt);
  }

  private publish(s: SessionRecord): void {
    this.deps.bus.emit('session', this.view(s));
  }

  private view(s: SessionRecord): SessionInfo {
    const { acpSessionId: _a, titleLocked: _t, ...info } = s;
    return { ...info, queue: s.queue.map((q): QueuedPrompt => ({ ...q })), lastSeq: this.deps.events.lastSeq(s.id) };
  }
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
