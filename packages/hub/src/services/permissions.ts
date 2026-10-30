import { randomUUID } from 'node:crypto';
import type {
  Actor,
  AutoApprove,
  PermissionOption,
  PermissionRequest,
  PermissionStatus,
  ToolContent,
  ToolKind,
} from '@agent-hub/shared';
import { audit, type Db } from '../db.js';
import type { HubBus } from '../bus.js';
import type { EventStore } from './events.js';
import type { SettingsStore } from './settings.js';
import type { PermissionAnswer } from '../adapters/types.js';

export interface PermissionInput {
  sessionId: string;
  agentId: string;
  type: 'tool' | 'delegation';
  title: string;
  toolKind?: ToolKind;
  detail?: string;
  content: ToolContent[];
  rawInput?: unknown;
  options: PermissionOption[];
  autoApprove?: AutoApprove;
  signal?: AbortSignal;
}

const READ_KINDS: ToolKind[] = ['read', 'search', 'think', 'fetch'];
const EDIT_KINDS: ToolKind[] = [...READ_KINDS, 'edit', 'delete', 'move'];

/** Whether an auto-approve level covers a tool kind. Unknown kinds only pass with "all". */
export function autoApproveCovers(level: AutoApprove | undefined, kind: ToolKind | undefined): boolean {
  switch (level) {
    case 'all':
      return true;
    case 'edits':
      return kind !== undefined && EDIT_KINDS.includes(kind);
    case 'read':
      return kind !== undefined && READ_KINDS.includes(kind);
    default:
      return false;
  }
}

interface Pending {
  request: PermissionRequest;
  resolve: (answer: PermissionAnswer) => void;
  timer?: NodeJS.Timeout;
}

const POLICY_ACTOR: Actor = { kind: 'policy', name: 'Auto-approve policy' };
const SYSTEM_ACTOR: Actor = { kind: 'system', name: 'Agent Hub' };

/**
 * Single queue for every permission decision (tool calls and delegations) across all sessions.
 * Requests are broadcast to every connected device; the first answer wins.
 */
export class PermissionBroker {
  private pending = new Map<string, Pending>();
  private statusListeners = new Set<(sessionId: string) => void>();

  constructor(
    private db: Db,
    private bus: HubBus,
    private events: EventStore,
    private settings: SettingsStore,
  ) {}

  /** Notified whenever the set of pending requests for a session changes. */
  onPendingChange(listener: (sessionId: string) => void): void {
    this.statusListeners.add(listener);
  }

  request(input: PermissionInput): Promise<PermissionAnswer> {
    const request: PermissionRequest = {
      id: randomUUID(),
      sessionId: input.sessionId,
      agentId: input.agentId,
      type: input.type,
      title: input.title,
      toolKind: input.toolKind,
      detail: input.detail,
      content: input.content,
      rawInput: input.rawInput,
      options: input.options,
      status: 'pending',
      createdAt: Date.now(),
    };

    if (input.type === 'tool' && autoApproveCovers(input.autoApprove, input.toolKind)) {
      const allow =
        input.options.find((o) => o.kind === 'allow_once') ?? input.options.find((o) => o.kind === 'allow_always');
      if (allow) {
        request.status = 'approved';
        request.selectedOptionId = allow.optionId;
        request.resolvedBy = POLICY_ACTOR;
        request.resolvedAt = Date.now();
        this.persist(request);
        this.events.append(request.sessionId, {
          kind: 'system',
          level: 'info',
          text: `Auto-approved (${input.autoApprove}): ${request.title}${request.detail ? ` — ${request.detail}` : ''}`,
        });
        audit(this.db, POLICY_ACTOR.name, 'permission.auto_approve', { id: request.id, title: request.title });
        return Promise.resolve({ outcome: 'selected', optionId: allow.optionId });
      }
    }

    return new Promise<PermissionAnswer>((resolve) => {
      const entry: Pending = { request, resolve };
      this.pending.set(request.id, entry);
      this.persist(request);
      this.events.append(request.sessionId, { kind: 'permission_request', requestId: request.id, title: request.title });
      this.bus.emit('permission', request);
      this.changed(request.sessionId);

      const timeoutSec = this.settings.get().permissions.timeoutSec;
      if (timeoutSec > 0) {
        entry.timer = setTimeout(() => this.expire(request.id), timeoutSec * 1000);
        entry.timer.unref?.();
      }
      input.signal?.addEventListener('abort', () => this.finish(request.id, null, SYSTEM_ACTOR, 'cancelled'), {
        once: true,
      });
    });
  }

  /** Answers a pending request. Throws if it was already answered (first response wins). */
  respond(id: string, response: { optionId?: string; cancel?: boolean }, by: Actor): PermissionRequest {
    const entry = this.pending.get(id);
    if (!entry) {
      const existing = this.get(id);
      if (!existing) throw Object.assign(new Error('Permission request not found'), { statusCode: 404 });
      throw Object.assign(new Error('Permission request was already resolved'), { statusCode: 409, existing });
    }
    if (response.cancel) return this.finish(id, null, by, 'cancelled')!;
    const option = entry.request.options.find((o) => o.optionId === response.optionId);
    if (!option) throw Object.assign(new Error('Unknown option'), { statusCode: 400 });
    return this.finish(id, option, by)!;
  }

  private expire(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    const reject = entry.request.options.find((o) => o.kind === 'reject_once');
    this.finish(id, reject ?? null, { kind: 'system', name: 'Timeout' }, 'expired');
  }

  private finish(
    id: string,
    option: PermissionOption | null,
    by: Actor,
    forcedStatus?: PermissionStatus,
  ): PermissionRequest | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    const req = entry.request;
    req.status =
      forcedStatus ?? (option && (option.kind === 'allow_once' || option.kind === 'allow_always') ? 'approved' : 'rejected');
    req.selectedOptionId = option?.optionId;
    req.resolvedBy = by;
    req.resolvedAt = Date.now();
    this.persist(req);
    this.events.append(req.sessionId, {
      kind: 'permission_resolved',
      requestId: id,
      outcome: option ? 'selected' : 'cancelled',
      optionId: option?.optionId,
      optionName: option?.name ?? (req.status === 'expired' ? 'Timed out' : 'Cancelled'),
      by,
    });
    this.bus.emit('permission', req);
    audit(this.db, by.name, 'permission.resolve', { id, status: req.status, option: option?.name, title: req.title });
    entry.resolve(option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' });
    this.changed(req.sessionId);
    return req;
  }

  /** Cancels every pending request of a session (used when a turn is cancelled or the session stops). */
  cancelForSession(sessionId: string, by: Actor = SYSTEM_ACTOR): void {
    for (const [id, entry] of [...this.pending]) {
      if (entry.request.sessionId === sessionId) this.finish(id, null, by, 'cancelled');
    }
  }

  cancelAll(by: Actor = SYSTEM_ACTOR): void {
    for (const id of [...this.pending.keys()]) this.finish(id, null, by, 'cancelled');
  }

  pendingCount(sessionId?: string): number {
    if (!sessionId) return this.pending.size;
    let n = 0;
    for (const e of this.pending.values()) if (e.request.sessionId === sessionId) n++;
    return n;
  }

  get(id: string): PermissionRequest | undefined {
    const live = this.pending.get(id);
    if (live) return live.request;
    const row = this.db.prepare('SELECT data FROM permissions WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as PermissionRequest) : undefined;
  }

  list(filter: { status?: PermissionStatus; sessionId?: string; limit?: number } = {}): PermissionRequest[] {
    if (filter.status === 'pending') {
      return [...this.pending.values()]
        .map((e) => e.request)
        .filter((r) => !filter.sessionId || r.sessionId === filter.sessionId)
        .sort((a, b) => a.createdAt - b.createdAt);
    }
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.sessionId) {
      where.push('session_id = ?');
      params.push(filter.sessionId);
    }
    params.push(filter.limit ?? 200);
    const rows = this.db
      .prepare(
        `SELECT data FROM permissions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as PermissionRequest);
  }

  /** Marks requests left pending by a previous hub process as cancelled. */
  recoverStale(): void {
    const rows = this.db.prepare("SELECT data FROM permissions WHERE status = 'pending'").all() as { data: string }[];
    for (const row of rows) {
      const req = JSON.parse(row.data) as PermissionRequest;
      req.status = 'cancelled';
      req.resolvedBy = { kind: 'system', name: 'Hub restart' };
      req.resolvedAt = Date.now();
      this.persist(req);
    }
  }

  private persist(req: PermissionRequest): void {
    this.db
      .prepare(
        `INSERT INTO permissions (id, session_id, status, data, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`,
      )
      .run(req.id, req.sessionId, req.status, JSON.stringify(req), req.createdAt);
  }

  private changed(sessionId: string): void {
    for (const l of this.statusListeners) l(sessionId);
  }
}
