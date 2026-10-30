import { randomUUID } from 'node:crypto';
import type { Actor, AgentInfo, DelegateTaskBody, SessionInfo, TaskInfo, TaskStatus } from '@agent-hub/shared';
import { collectAgentText, isTaskFinished } from '@agent-hub/shared';
import { audit, type Db } from '../db.js';
import type { HubBus, TurnEndInfo } from '../bus.js';
import type { Logger } from '../logger.js';
import type { AgentRegistry } from './agents.js';
import type { EventStore } from './events.js';
import type { PermissionBroker } from './permissions.js';
import { HttpError, type SessionManager } from './sessions.js';
import type { SettingsStore } from './settings.js';

export interface OrchestratorDeps {
  db: Db;
  bus: HubBus;
  sessions: SessionManager;
  broker: PermissionBroker;
  settings: SettingsStore;
  events: EventStore;
  registry: AgentRegistry;
  log: Logger;
}

const MAX_RESULT_CHARS = 60_000;

function normalizePrompt(p: string): string {
  return p.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Lets agents delegate work to other agents (via the hub MCP tools). Each delegation becomes a
 * task backed by a child session; guardrails cap depth, concurrency and duration and detect loops.
 */
export class Orchestrator {
  private tasks = new Map<string, TaskInfo>();
  private waiters = new Map<string, Set<() => void>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private approvals = new Map<string, AbortController>();

  constructor(private deps: OrchestratorDeps) {
    deps.bus.on('turn_end', (info) => this.onTurnEnd(info));
    deps.bus.on('session', (s) => this.onSessionUpdate(s));
  }

  load(): void {
    const rows = this.deps.db.prepare('SELECT data FROM tasks ORDER BY created_at DESC LIMIT 1000').all() as {
      data: string;
    }[];
    for (const row of rows.reverse()) {
      const t = JSON.parse(row.data) as TaskInfo;
      if (!isTaskFinished(t.status)) {
        t.status = 'failed';
        t.error = 'Hub restarted while the task was running';
        t.updatedAt = Date.now();
        this.persist(t);
      }
      this.tasks.set(t.id, t);
    }
  }

  list(filter: { parentSessionId?: string } = {}): TaskInfo[] {
    return [...this.tasks.values()]
      .filter((t) => !filter.parentSessionId || t.parentSessionId === filter.parentSessionId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): TaskInfo | undefined {
    return this.tasks.get(id);
  }

  /** Agents that can be delegated to (structured mode only, since results must be machine-readable). */
  delegatableAgents(): AgentInfo[] {
    return this.deps.registry.list().filter((a) => a.enabled && a.structured.available);
  }

  async delegate(parentSessionId: string, body: DelegateTaskBody): Promise<TaskInfo> {
    const { sessions, settings, registry, db } = this.deps;
    const parent = sessions.require(parentSessionId);
    const limits = settings.get().orchestration;
    if (parent.delegationPolicy === 'deny') throw new HttpError(403, 'Delegation is disabled for this session');
    const depth = parent.depth + 1;
    if (depth > limits.maxDepth) {
      throw new HttpError(403, `Delegation depth limit reached (max ${limits.maxDepth}). Do the work yourself instead.`);
    }
    const agent = registry.get(body.agentId);
    if (!agent) throw new HttpError(404, `Unknown agent "${body.agentId}". Call list_agents to see available agents.`);
    if (!agent.enabled || !agent.structured.available) {
      throw new HttpError(400, `${agent.name} is not available: ${agent.structured.reason ?? 'disabled'}`);
    }
    if (limits.loopDetection && this.isLoop(parent, body.agentId, body.prompt)) {
      throw new HttpError(409, 'Delegation loop detected: an ancestor task already sent this prompt to this agent.');
    }
    if (sessions.activeCount() >= limits.maxConcurrentSessions) {
      throw new HttpError(429, `Concurrent session limit reached (${limits.maxConcurrentSessions}). Try again later.`);
    }

    const now = Date.now();
    const task: TaskInfo = {
      id: randomUUID(),
      parentSessionId,
      agentId: agent.id,
      prompt: body.prompt,
      status: parent.delegationPolicy === 'ask' ? 'pending_approval' : 'running',
      depth,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.save(task);
    const parentAgentName = registry.get(parent.agentId)?.name ?? parent.agentId;
    audit(db, parentAgentName, 'task.delegate', { id: task.id, parent: parentSessionId, agent: agent.id });
    // Approval and child start-up continue in the background so MCP tool calls never block on a human.
    void this.launch(task, parent, parentAgentName, agent, body).catch((err) => {
      this.deps.log.error('delegation failed', err);
      if (!isTaskFinished(task.status)) this.update(task, { status: 'failed', error: (err as Error).message });
    });
    return task;
  }

  private async launch(
    task: TaskInfo,
    parent: SessionInfo,
    parentAgentName: string,
    agent: AgentInfo,
    body: DelegateTaskBody,
  ): Promise<void> {
    const { sessions, broker } = this.deps;
    if (parent.delegationPolicy === 'ask') {
      const controller = new AbortController();
      this.approvals.set(task.id, controller);
      const answer = await broker
        .request({
          sessionId: parent.id,
          agentId: parent.agentId,
          type: 'delegation',
          title: `${parentAgentName} wants to delegate a task to ${agent.name}`,
          detail: body.prompt,
          content: [{ type: 'text', text: body.prompt }],
          options: [
            { optionId: 'allow', name: 'Allow delegation', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
          signal: controller.signal,
        })
        .finally(() => this.approvals.delete(task.id));
      if (isTaskFinished(task.status)) return;
      if (answer.outcome !== 'selected' || answer.optionId !== 'allow') {
        this.update(task, { status: 'denied', error: 'The user denied this delegation' });
        return;
      }
    }

    let child: SessionInfo;
    try {
      child = await sessions.create({
        agentId: agent.id,
        mode: 'structured',
        cwd: body.cwd || parent.cwd,
        isolation: body.isolation,
        title: `↳ ${body.prompt.replace(/\s+/g, ' ').slice(0, 70)}`,
        prompt: this.wrapPrompt(parentAgentName, task, body.prompt),
        createdBy: { kind: 'agent', id: parent.id, name: `${parentAgentName} (delegation)` },
        parentSessionId: parent.id,
        taskId: task.id,
        depth: task.depth,
        delegationPolicy: parent.delegationPolicy,
      });
    } catch (err) {
      this.update(task, { status: 'failed', error: (err as Error).message });
      return;
    }
    this.update(task, { status: 'running', childSessionId: child.id });
    this.armTimeout(task);
  }

  /** Sends a follow-up message to the agent working on a task. */
  async message(parentSessionId: string | null, taskId: string, text: string, from: Actor): Promise<TaskInfo> {
    const task = this.requireTask(taskId, parentSessionId);
    if (!task.childSessionId || !this.deps.sessions.isLive(task.childSessionId)) {
      throw new HttpError(409, 'The agent for this task is no longer running');
    }
    if (task.status === 'running') throw new HttpError(409, 'The task is still running; wait for it to finish first');
    this.update(task, { status: 'running', result: undefined, error: undefined });
    await this.deps.sessions.prompt(task.childSessionId, text, from);
    this.armTimeout(task);
    return task;
  }

  async wait(taskId: string, seconds: number, parentSessionId: string | null = null): Promise<TaskInfo> {
    const task = this.requireTask(taskId, parentSessionId);
    if (isTaskFinished(task.status) || seconds <= 0) return task;
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(taskId) ?? new Set();
      this.waiters.set(taskId, set);
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        resolve();
      };
      const timer = setTimeout(done, seconds * 1000);
      set.add(done);
    });
    return this.tasks.get(taskId)!;
  }

  async cancel(taskId: string, by: Actor, parentSessionId: string | null = null): Promise<TaskInfo> {
    const task = this.requireTask(taskId, parentSessionId);
    if (isTaskFinished(task.status)) return task;
    this.update(task, { status: 'cancelled', error: `Cancelled by ${by.name}` });
    if (task.childSessionId) await this.deps.sessions.stop(task.childSessionId, by, 'task cancelled').catch(() => undefined);
    return task;
  }

  cancelAll(by: Actor): void {
    for (const t of this.tasks.values()) {
      if (!isTaskFinished(t.status)) this.update(t, { status: 'cancelled', error: `Cancelled by ${by.name}` });
    }
  }

  private requireTask(taskId: string, parentSessionId: string | null): TaskInfo {
    const task = this.tasks.get(taskId);
    if (!task || (parentSessionId && task.parentSessionId !== parentSessionId)) {
      throw new HttpError(404, 'Task not found');
    }
    return task;
  }

  private wrapPrompt(parentAgentName: string, task: TaskInfo, prompt: string): string {
    return [
      `[Task delegated to you by ${parentAgentName} via Agent Hub (task ${task.id.slice(0, 8)})]`,
      '',
      prompt,
      '',
      'When you are finished, reply with a concise summary of what you did and the outcome. ' +
        'Your final reply is returned to the delegating agent.',
    ].join('\n');
  }

  private isLoop(parent: SessionInfo, agentId: string, prompt: string): boolean {
    const target = normalizePrompt(prompt);
    for (const t of this.tasks.values()) {
      if (
        t.parentSessionId === parent.id &&
        t.agentId === agentId &&
        !isTaskFinished(t.status) &&
        normalizePrompt(t.prompt) === target
      ) {
        return true;
      }
    }
    let current: SessionInfo | undefined = parent;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.taskId) {
        const t = this.tasks.get(current.taskId);
        if (t && t.agentId === agentId && normalizePrompt(t.prompt) === target) return true;
      }
      current = current.parentSessionId ? this.deps.sessions.get(current.parentSessionId) : undefined;
    }
    return false;
  }

  private armTimeout(task: TaskInfo): void {
    const prev = this.timers.get(task.id);
    if (prev) clearTimeout(prev);
    const seconds = this.deps.settings.get().orchestration.taskTimeoutSec;
    const timer = setTimeout(() => {
      this.timers.delete(task.id);
      const t = this.tasks.get(task.id);
      if (!t || t.status !== 'running') return;
      this.update(t, { status: 'timeout', error: `Task exceeded the ${seconds}s time limit` });
      if (t.childSessionId) {
        void this.deps.sessions.cancel(t.childSessionId, { kind: 'system', name: 'Task timeout' }).catch(() => undefined);
      }
    }, seconds * 1000);
    timer.unref?.();
    this.timers.set(task.id, timer);
  }

  private onTurnEnd(info: TurnEndInfo): void {
    const task = [...this.tasks.values()].find((t) => t.childSessionId === info.sessionId && t.status === 'running');
    if (!task) return;
    const text = collectAgentText(this.deps.events.list(info.sessionId, info.startSeq));
    const result = text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n…(truncated)` : text;
    let status: TaskStatus = 'completed';
    if (info.stopReason === 'cancelled') status = 'cancelled';
    else if (info.stopReason === 'error' || info.stopReason === 'refusal') status = 'failed';
    this.update(task, {
      status,
      result: result || '(The agent finished without a text reply.)',
      error: status === 'failed' ? (info.error ?? `Agent stopped: ${info.stopReason}`) : undefined,
    });
  }

  private onSessionUpdate(s: SessionInfo): void {
    if (!s.taskId) return;
    const task = this.tasks.get(s.taskId);
    if (!task || isTaskFinished(task.status)) return;
    if (s.status === 'error') this.update(task, { status: 'failed', error: s.statusMessage ?? 'Agent failed' });
    else if (s.status === 'stopped') this.update(task, { status: 'cancelled', error: s.statusMessage ?? 'Agent stopped' });
  }

  private update(task: TaskInfo, patch: Partial<TaskInfo>): void {
    Object.assign(task, patch, { updatedAt: Date.now() });
    if (isTaskFinished(task.status)) {
      const timer = this.timers.get(task.id);
      if (timer) clearTimeout(timer);
      this.timers.delete(task.id);
      this.approvals.get(task.id)?.abort();
    }
    this.save(task);
    const waiters = this.waiters.get(task.id);
    if (waiters && (isTaskFinished(task.status) || task.status === 'denied')) {
      for (const w of [...waiters]) w();
      this.waiters.delete(task.id);
    }
  }

  private save(task: TaskInfo): void {
    this.persist(task);
    this.deps.bus.emit('task', { ...task });
    if (this.deps.sessions.get(task.parentSessionId)) {
      this.deps.events.append(task.parentSessionId, {
        kind: 'delegation',
        taskId: task.id,
        childSessionId: task.childSessionId,
        agentId: task.agentId,
        prompt: task.prompt,
        status: task.status,
      });
    }
  }

  private persist(task: TaskInfo): void {
    this.deps.db
      .prepare(
        `INSERT INTO tasks (id, parent_session_id, child_session_id, status, data, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET child_session_id = excluded.child_session_id, status = excluded.status, data = excluded.data`,
      )
      .run(task.id, task.parentSessionId, task.childSessionId ?? null, task.status, JSON.stringify(task), task.createdAt);
  }
}
