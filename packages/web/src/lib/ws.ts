import type { ClientMessage, ServerMessage } from '@agent-hub/shared/client';
import { lastSeq, useHub } from './store';

type PtyListener = (
  msg:
    | { kind: 'snapshot' | 'output'; data: string }
    | { kind: 'size'; cols: number; rows: number; driverDeviceId?: string; driverName?: string },
) => void;

/** Single reconnecting WebSocket to the hub with session subscriptions and terminal streams. */
class HubSocket {
  private ws?: WebSocket;
  private retry = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private subs = new Map<string, number>();
  private pty = new Map<string, Set<PtyListener>>();
  private stopped = true;

  start(): void {
    this.stopped = false;
    if (!this.ws) this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = undefined;
  }

  restart(): void {
    this.stop();
    this.retry = 0;
    this.start();
  }

  private connect(): void {
    const token = useHub.getState().token;
    if (!token || this.stopped) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    useHub.getState().setConnection('connecting');
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token } satisfies ClientMessage));
    };
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        this.retry = 0;
        useHub.getState().apply(msg);
        for (const id of this.subs.keys()) this.sendSubscribe(id);
        return;
      }
      if (msg.type === 'pty_output' || msg.type === 'pty_snapshot') {
        const listeners = this.pty.get(msg.sessionId);
        listeners?.forEach((l) => l({ kind: msg.type === 'pty_snapshot' ? 'snapshot' : 'output', data: msg.data }));
        return;
      }
      if (msg.type === 'pty_size') {
        const { sessionId, type: _t, ...size } = msg;
        this.pty.get(sessionId)?.forEach((l) => l({ kind: 'size', ...size }));
        return;
      }
      if (msg.type === 'auth_error') {
        useHub.getState().setUnauthorized();
        return;
      }
      useHub.getState().apply(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      if (e.code === 4401) {
        useHub.getState().setUnauthorized();
        return;
      }
      useHub.getState().setConnection('closed');
      if (this.stopped) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private sendSubscribe(sessionId: string): void {
    this.send({ type: 'subscribe', sessionId, sinceSeq: lastSeq(sessionId) });
  }

  /** Subscribes to a session's event stream (ref-counted). Returns an unsubscribe function. */
  subscribe(sessionId: string): () => void {
    const count = this.subs.get(sessionId) ?? 0;
    this.subs.set(sessionId, count + 1);
    if (count === 0) this.sendSubscribe(sessionId);
    return () => {
      const c = (this.subs.get(sessionId) ?? 1) - 1;
      if (c <= 0) {
        this.subs.delete(sessionId);
        this.send({ type: 'unsubscribe', sessionId });
      } else {
        this.subs.set(sessionId, c);
      }
    };
  }

  onPty(sessionId: string, listener: PtyListener): () => void {
    const set = this.pty.get(sessionId) ?? new Set();
    set.add(listener);
    this.pty.set(sessionId, set);
    // If already subscribed, re-subscribe so the hub sends this new listener a fresh size + snapshot.
    if ((this.subs.get(sessionId) ?? 0) > 0) this.sendSubscribe(sessionId);
    return () => set.delete(listener);
  }
}

export const hubSocket = new HubSocket();
