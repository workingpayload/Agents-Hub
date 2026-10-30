import type { FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { ClientMessage, DeviceInfo, ServerMessage } from '@agent-hub/shared';
import { isSessionActive, isTaskFinished } from '@agent-hub/shared';
import { clampPtySize } from '../adapters/pty.js';
import type { Hub } from '../hub.js';

const AUTH_TIMEOUT_MS = 10_000;
const MAX_BUFFERED = 8 * 1024 * 1024;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** A viewer's preferred terminal size (what fits its screen) and when it last interacted. */
interface PtyView {
  cols: number;
  rows: number;
  lastActive: number;
}

interface Client {
  socket: WebSocket;
  device?: DeviceInfo;
  subs: Set<string>;
  ptyViews: Map<string, PtyView>;
  alive: boolean;
}

/**
 * Realtime channel: broadcasts session/permission/task/agent updates to every authenticated
 * client and streams session events (with replay from a sequence number) to subscribers.
 *
 * Terminal sessions share one PTY, so it can only have one size. The most recently active viewer
 * (opened, focused or typed into the terminal) "drives" the size; every viewer is told the
 * authoritative size and renders at exactly that size, so nobody sees output drawn for another width.
 */
export class WsGateway {
  private clients = new Set<Client>();
  private heartbeat: NodeJS.Timeout;
  private ptyDrivers = new Map<string, Client>();
  private ptyAnnounced = new Map<string, string>();

  constructor(private hub: Hub) {
    const { bus } = hub;
    bus.on('event', (event) => this.toSubscribers(event.sessionId, { type: 'event', event }));
    bus.on('pty_output', (sessionId, data) => this.toSubscribers(sessionId, { type: 'pty_output', sessionId, data }));
    bus.on('session_removed', (sessionId) => this.forgetPty(sessionId));
    bus.on('session', (session) => {
      if (session.mode === 'terminal' && !isSessionActive(session.status)) this.forgetPty(session.id);
    });
    bus.on('session', (session) => this.broadcast({ type: 'session', session }));
    bus.on('session_removed', (sessionId) => this.broadcast({ type: 'session_removed', sessionId }));
    bus.on('permission', (permission) => this.broadcast({ type: 'permission', permission }));
    bus.on('task', (task) => this.broadcast({ type: 'task', task }));
    bus.on('agents', (agents) => this.broadcast({ type: 'agents', agents }));
    bus.on('notify', (notification) => this.broadcast({ type: 'notify', notification }));
    bus.on('device_revoked', (deviceId) => {
      for (const c of this.clients) {
        if (c.device?.id === deviceId) c.socket.close(4401, 'Device revoked');
      }
    });
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.socket.terminate();
          this.drop(c);
          continue;
        }
        c.alive = false;
        try {
          c.socket.ping();
        } catch {
          // ignore
        }
      }
    }, 30_000);
    this.heartbeat.unref?.();
  }

  handle(socket: WebSocket, req: FastifyRequest, secure: boolean): void {
    const origin = req.headers.origin;
    if (origin && !this.originAllowed(origin, req.headers.host, secure)) {
      socket.close(4403, 'Origin not allowed');
      return;
    }
    const client: Client = { socket, subs: new Set(), ptyViews: new Map(), alive: true };
    const authTimer = setTimeout(() => {
      if (!client.device) socket.close(4401, 'Authentication timeout');
    }, AUTH_TIMEOUT_MS);

    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      this.drop(client);
    });
    socket.on('error', () => this.drop(client));
    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }
      client.alive = true;
      if (!client.device) {
        if (msg.type !== 'auth') return;
        const device = this.hub.devices.authenticate(msg.token);
        if (!device) {
          this.send(client, { type: 'auth_error', message: 'Invalid or revoked token' });
          socket.close(4401, 'Unauthorized');
          return;
        }
        clearTimeout(authTimer);
        client.device = device;
        this.clients.add(client);
        this.sendSnapshot(client);
        return;
      }
      this.onMessage(client, msg);
    });
  }

  private originAllowed(origin: string, host: string | undefined, secure: boolean): boolean {
    try {
      if (new URL(origin).host === host) return true;
    } catch {
      return false;
    }
    return !secure && LOCAL_ORIGIN.test(origin);
  }

  private sendSnapshot(client: Client): void {
    const { hub } = this;
    this.send(client, { type: 'hello', server: hub.serverInfo(client.device!) });
    this.send(client, { type: 'agents', agents: hub.registry.list() });
    for (const session of hub.sessions.list(true)) this.send(client, { type: 'session', session });
    for (const permission of hub.broker.list({ status: 'pending' })) this.send(client, { type: 'permission', permission });
    const tasks = hub.orchestrator.list();
    const recent = tasks.filter((t, i) => i < 200 || !isTaskFinished(t.status));
    for (const task of recent) this.send(client, { type: 'task', task });
  }

  private onMessage(client: Client, msg: ClientMessage): void {
    const { sessions, events } = this.hub;
    switch (msg.type) {
      case 'subscribe': {
        if (!sessions.get(msg.sessionId)) return;
        let since = Math.max(0, Number(msg.sinceSeq) || 0);
        // Replay is synchronous (SQLite), so no live event can interleave before the subscription is added.
        for (;;) {
          const batch = events.list(msg.sessionId, since, 2000);
          for (const event of batch) this.send(client, { type: 'event', event });
          if (batch.length < 2000) break;
          since = batch[batch.length - 1].seq;
        }
        client.subs.add(msg.sessionId);
        this.send(client, { type: 'replay_done', sessionId: msg.sessionId, lastSeq: events.lastSeq(msg.sessionId) });
        const snapshot = sessions.ptySnapshot(msg.sessionId);
        if (snapshot !== undefined) {
          // Size first, so the viewer's terminal matches the snapshot it is about to render.
          const size = this.ptySizeMessage(msg.sessionId);
          if (size) this.send(client, { ...size, mine: this.ptyDrivers.get(msg.sessionId) === client });
          this.send(client, { type: 'pty_snapshot', sessionId: msg.sessionId, data: snapshot });
        }
        break;
      }
      case 'unsubscribe':
        client.subs.delete(msg.sessionId);
        this.releasePty(client, msg.sessionId);
        break;
      case 'pty_input':
        if (typeof msg.data === 'string' && msg.data.length <= 64 * 1024) {
          sessions.ptyInput(msg.sessionId, msg.data);
          this.touchPty(client, msg.sessionId);
        }
        break;
      case 'pty_resize':
        this.setPtyView(client, msg.sessionId, Number(msg.cols), Number(msg.rows), Boolean(msg.claim));
        break;
      case 'ping':
        this.send(client, { type: 'pong' });
        break;
      default:
        break;
    }
  }

  private toSubscribers(sessionId: string, msg: ServerMessage): void {
    let payload: string | undefined;
    for (const c of this.clients) {
      if (!c.subs.has(sessionId)) continue;
      payload ??= JSON.stringify(msg);
      this.sendRaw(c, payload);
    }
  }

  /** Records a viewer's preferred size; claiming (or being the current driver) applies it to the PTY. */
  private setPtyView(client: Client, sessionId: string, cols: number, rows: number, claim: boolean): void {
    if (!client.subs.has(sessionId) || !this.hub.sessions.ptySize(sessionId)) return;
    const size = clampPtySize(cols, rows);
    const prev = client.ptyViews.get(sessionId);
    client.ptyViews.set(sessionId, { ...size, lastActive: claim ? Date.now() : (prev?.lastActive ?? 0) });
    const driver = this.ptyDrivers.get(sessionId);
    if (claim || !driver || driver === client) this.drivePty(sessionId, client);
    else this.announcePty(sessionId);
  }

  /** Typing into a terminal makes this viewer the one whose screen size is used. */
  private touchPty(client: Client, sessionId: string): void {
    const view = client.ptyViews.get(sessionId);
    if (!view) return;
    view.lastActive = Date.now();
    if (this.ptyDrivers.get(sessionId) !== client) this.drivePty(sessionId, client);
  }

  private drivePty(sessionId: string, client: Client): void {
    const view = client.ptyViews.get(sessionId);
    if (!view) return;
    this.ptyDrivers.set(sessionId, client);
    this.hub.sessions.ptyResize(sessionId, view.cols, view.rows);
    this.announcePty(sessionId);
  }

  /** Hands control to the most recently active remaining viewer when the driver leaves. */
  private releasePty(client: Client, sessionId: string): void {
    client.ptyViews.delete(sessionId);
    if (this.ptyDrivers.get(sessionId) !== client) return;
    this.ptyDrivers.delete(sessionId);
    let next: Client | undefined;
    for (const c of this.clients) {
      const v = c.ptyViews.get(sessionId);
      if (c !== client && v && c.subs.has(sessionId) && (!next || v.lastActive > next.ptyViews.get(sessionId)!.lastActive)) {
        next = c;
      }
    }
    if (next) this.drivePty(sessionId, next);
    else this.announcePty(sessionId);
  }

  private ptySizeMessage(sessionId: string): Extract<ServerMessage, { type: 'pty_size' }> | undefined {
    const size = this.hub.sessions.ptySize(sessionId);
    if (!size) return undefined;
    const driver = this.ptyDrivers.get(sessionId)?.device;
    return { type: 'pty_size', sessionId, ...size, driverDeviceId: driver?.id, driverName: driver?.name };
  }

  private announcePty(sessionId: string): void {
    const msg = this.ptySizeMessage(sessionId);
    if (!msg) return;
    const driver = this.ptyDrivers.get(sessionId);
    const key = `${msg.cols}x${msg.rows}:${this.connectionKey(driver)}`;
    if (this.ptyAnnounced.get(sessionId) === key) return;
    this.ptyAnnounced.set(sessionId, key);
    for (const c of this.clients) {
      if (c.subs.has(sessionId)) this.send(c, { ...msg, mine: c === driver });
    }
  }

  private connectionIds = new WeakMap<Client, number>();
  private nextConnectionId = 1;
  private connectionKey(client: Client | undefined): string {
    if (!client) return '';
    let id = this.connectionIds.get(client);
    if (!id) this.connectionIds.set(client, (id = this.nextConnectionId++));
    return String(id);
  }

  private forgetPty(sessionId: string): void {
    this.ptyDrivers.delete(sessionId);
    this.ptyAnnounced.delete(sessionId);
    for (const c of this.clients) c.ptyViews.delete(sessionId);
  }

  private drop(client: Client): void {
    if (!this.clients.delete(client)) return;
    for (const sessionId of [...client.ptyViews.keys()]) this.releasePty(client, sessionId);
  }

  private broadcast(msg: ServerMessage): void {
    if (!this.clients.size) return;
    const payload = JSON.stringify(msg);
    for (const c of this.clients) this.sendRaw(c, payload);
  }

  private send(client: Client, msg: ServerMessage): void {
    this.sendRaw(client, JSON.stringify(msg));
  }

  private sendRaw(client: Client, payload: string): void {
    const s = client.socket;
    if (s.readyState !== s.OPEN) return;
    if (s.bufferedAmount > MAX_BUFFERED) {
      // Slow client: drop it; it will reconnect and replay from its last sequence number.
      s.terminate();
      this.drop(client);
      return;
    }
    s.send(payload);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.socket.close(1001, 'Hub shutting down');
    this.clients.clear();
  }
}
