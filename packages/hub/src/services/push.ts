import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import type { NotifyPayload, PushSubscribeBody, SessionInfo, TaskInfo } from '@agent-hub/shared';
import type { Db } from '../db.js';
import type { HubBus, TurnEndInfo } from '../bus.js';
import type { Logger } from '../logger.js';
import type { AgentRegistry } from './agents.js';
import type { SessionManager } from './sessions.js';
import type { SettingsStore } from './settings.js';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Web Push (VAPID) delivery to paired devices that enabled notifications. */
export class PushService {
  readonly publicKey: string;

  constructor(
    private db: Db,
    dataDir: string,
    private log: Logger,
  ) {
    const file = path.join(dataDir, 'vapid.json');
    let keys: VapidKeys;
    if (fs.existsSync(file)) {
      keys = JSON.parse(fs.readFileSync(file, 'utf8')) as VapidKeys;
    } else {
      keys = webpush.generateVAPIDKeys();
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    }
    this.publicKey = keys.publicKey;
    webpush.setVapidDetails('mailto:agent-hub@localhost.localdomain', keys.publicKey, keys.privateKey);
  }

  subscribe(deviceId: string, body: PushSubscribeBody): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, device_id, data, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET device_id = excluded.device_id, data = excluded.data`,
      )
      .run(body.subscription.endpoint, deviceId, JSON.stringify(body.subscription), Date.now());
  }

  unsubscribe(deviceId: string, endpoint?: string): void {
    if (endpoint) {
      this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND device_id = ?').run(endpoint, deviceId);
    } else {
      this.db.prepare('DELETE FROM push_subscriptions WHERE device_id = ?').run(deviceId);
    }
  }

  hasSubscription(deviceId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM push_subscriptions WHERE device_id = ? LIMIT 1').get(deviceId));
  }

  async send(payload: NotifyPayload, onlyDeviceId?: string): Promise<number> {
    const rows = (
      onlyDeviceId
        ? this.db.prepare('SELECT endpoint, data FROM push_subscriptions WHERE device_id = ?').all(onlyDeviceId)
        : this.db.prepare('SELECT endpoint, data FROM push_subscriptions').all()
    ) as { endpoint: string; data: string }[];
    let delivered = 0;
    await Promise.all(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(JSON.parse(row.data), JSON.stringify(payload), { TTL: 600, urgency: 'high' });
          delivered++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
          } else {
            this.log.warn(`push delivery failed (${status ?? 'network'})`, (err as Error).message);
          }
        }
      }),
    );
    return delivered;
  }
}

/** Turns hub activity into user notifications (in-app via WebSocket + Web Push). */
export class Notifier {
  constructor(
    private bus: HubBus,
    private push: PushService,
    private settings: SettingsStore,
    private sessions: SessionManager,
    private registry: AgentRegistry,
  ) {
    const notifiedErrors = new Set<string>();
    bus.on('permission', (p) => {
      if (p.status !== 'pending' || !this.settings.get().notifications.permission) return;
      const session = sessions.get(p.sessionId);
      this.notify({
        kind: 'permission',
        title: `${this.agentName(p.agentId)} needs your approval`,
        body: p.detail ? `${p.title}\n${p.detail.slice(0, 200)}` : p.title,
        url: session ? `/sessions/${session.id}` : '/approvals',
        tag: `perm-${p.id}`,
      });
    });
    bus.on('turn_end', (info: TurnEndInfo) => {
      if (!this.settings.get().notifications.turnEnd) return;
      const s = sessions.get(info.sessionId);
      if (!s || s.depth > 0 || s.mode !== 'structured') return;
      this.notify({
        kind: 'turn_end',
        title: `${this.agentName(s.agentId)} ${info.stopReason === 'end_turn' ? 'finished' : `stopped (${info.stopReason})`}`,
        body: s.title,
        url: `/sessions/${s.id}`,
        tag: `turn-${s.id}`,
      });
    });
    bus.on('task', (t: TaskInfo) => {
      if (!this.settings.get().notifications.task) return;
      if (!['completed', 'failed', 'timeout'].includes(t.status)) return;
      this.notify({
        kind: 'task',
        title: `Delegated task ${t.status}: ${this.agentName(t.agentId)}`,
        body: t.prompt.slice(0, 160),
        url: t.childSessionId ? `/sessions/${t.childSessionId}` : '/tasks',
        tag: `task-${t.id}-${t.status}`,
      });
    });
    bus.on('session', (s: SessionInfo) => {
      if (s.status !== 'error') {
        notifiedErrors.delete(s.id);
        return;
      }
      if (!this.settings.get().notifications.error || notifiedErrors.has(s.id)) return;
      notifiedErrors.add(s.id);
      this.notify({
        kind: 'error',
        title: `${this.agentName(s.agentId)} stopped with an error`,
        body: (s.statusMessage ?? s.title).slice(0, 200),
        url: `/sessions/${s.id}`,
        tag: `err-${s.id}`,
      });
    });
  }

  notify(payload: NotifyPayload): void {
    this.bus.emit('notify', payload);
    void this.push.send(payload);
  }

  private agentName(id: string): string {
    return this.registry.get(id)?.name ?? id;
  }
}
