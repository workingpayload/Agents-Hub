import type { SessionEvent, SessionEventPayload } from '@agent-hub/shared';
import type { Db } from '../db.js';
import type { HubBus } from '../bus.js';

const COALESCE_MS = 40;
type ChunkKind = 'agent_message_chunk' | 'agent_thought_chunk';

interface PendingChunk {
  kind: ChunkKind;
  text: string;
  ts: number;
}

/**
 * Append-only per-session event log. Every event gets a monotonically increasing `seq`
 * so clients can reconnect and replay from where they left off. Streaming text chunks are
 * coalesced briefly to keep the log and the WebSocket traffic compact.
 */
export class EventStore {
  private seqs = new Map<string, number>();
  private pending = new Map<string, PendingChunk>();
  private timers = new Map<string, NodeJS.Timeout>();
  private insert;

  constructor(
    private db: Db,
    private bus: HubBus,
  ) {
    this.insert = db.prepare('INSERT INTO events (session_id, seq, ts, kind, data) VALUES (?, ?, ?, ?, ?)');
  }

  append(sessionId: string, payload: SessionEventPayload): void {
    if (payload.kind === 'agent_message_chunk' || payload.kind === 'agent_thought_chunk') {
      if (!payload.text) return;
      const pending = this.pending.get(sessionId);
      if (pending && pending.kind === payload.kind) {
        pending.text += payload.text;
        return;
      }
      this.flush(sessionId);
      this.pending.set(sessionId, { kind: payload.kind, text: payload.text, ts: Date.now() });
      this.timers.set(
        sessionId,
        setTimeout(() => this.flush(sessionId), COALESCE_MS),
      );
      return;
    }
    this.flush(sessionId);
    this.write(sessionId, payload, Date.now());
  }

  /** Writes out any buffered chunk for the session (or all sessions). */
  flush(sessionId?: string): void {
    if (sessionId === undefined) {
      for (const id of [...this.pending.keys()]) this.flush(id);
      return;
    }
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
    const pending = this.pending.get(sessionId);
    if (!pending) return;
    this.pending.delete(sessionId);
    this.write(sessionId, { kind: pending.kind, text: pending.text }, pending.ts);
  }

  lastSeq(sessionId: string): number {
    this.flush(sessionId);
    return this.currentSeq(sessionId);
  }

  list(sessionId: string, sinceSeq = 0, limit = 10_000): SessionEvent[] {
    this.flush(sessionId);
    const rows = this.db
      .prepare('SELECT data FROM events WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
      .all(sessionId, sinceSeq, limit) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as SessionEvent);
  }

  deleteSession(sessionId: string): void {
    this.flush(sessionId);
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
    this.seqs.delete(sessionId);
  }

  private currentSeq(sessionId: string): number {
    let seq = this.seqs.get(sessionId);
    if (seq === undefined) {
      const row = this.db.prepare('SELECT MAX(seq) AS seq FROM events WHERE session_id = ?').get(sessionId) as
        | { seq: number | null }
        | undefined;
      seq = row?.seq ?? 0;
      this.seqs.set(sessionId, seq);
    }
    return seq;
  }

  private write(sessionId: string, payload: SessionEventPayload, ts: number): SessionEvent {
    const seq = this.currentSeq(sessionId) + 1;
    this.seqs.set(sessionId, seq);
    const event = { ...payload, sessionId, seq, ts } as SessionEvent;
    this.insert.run(sessionId, seq, ts, payload.kind, JSON.stringify(event));
    this.bus.emit('event', event);
    return event;
  }
}
