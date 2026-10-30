import './suppress-warnings.js';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { DeviceInfo, ServerInfo } from '@agent-hub/shared';
import { resolveEntryCommand, resolveOptions, VERSION, type HubOptions, type ResolvedOptions } from './config.js';
import { openDatabase, type Db } from './db.js';
import { HubBus } from './bus.js';
import { createLogger, type Logger } from './logger.js';
import { EventStore } from './services/events.js';
import { SettingsStore } from './services/settings.js';
import { AgentRegistry } from './services/agents.js';
import { PermissionBroker } from './services/permissions.js';
import { WorktreeService } from './services/worktree.js';
import { SessionManager } from './services/sessions.js';
import { Orchestrator } from './services/orchestrator.js';
import { DeviceStore, PairingService } from './services/devices.js';
import { ensureTls, type TlsMaterial } from './services/certs.js';
import { lanAddresses } from './services/network.js';
import { Notifier, PushService } from './services/push.js';
import { buildApp } from './http/app.js';
import { WsGateway } from './http/ws.js';

/** The hub daemon: owns all services and the HTTP(S) listeners. */
export class Hub {
  readonly opts: ResolvedOptions;
  readonly log: Logger;
  readonly db: Db;
  readonly bus = new HubBus();
  readonly settings: SettingsStore;
  readonly events: EventStore;
  readonly registry: AgentRegistry;
  readonly broker: PermissionBroker;
  readonly worktrees: WorktreeService;
  readonly sessions: SessionManager;
  readonly orchestrator: Orchestrator;
  readonly devices: DeviceStore;
  readonly pairing: PairingService;
  readonly push: PushService;
  readonly notifier: Notifier;
  readonly gateway: WsGateway;
  readonly localToken: string;
  tls?: TlsMaterial;
  private apps: FastifyInstance[] = [];
  private lanIps: string[] = [];
  private boundLocalPort = 0;
  private boundLanPort = 0;

  constructor(options: HubOptions = {}) {
    this.opts = resolveOptions(options);
    this.log = createLogger(this.opts.logLevel);
    this.db = openDatabase(this.opts.dataDir);
    this.settings = new SettingsStore(this.db);
    this.events = new EventStore(this.db, this.bus);
    this.registry = new AgentRegistry(this.settings, this.bus, this.log.child('agents'), {
      enableTestAgent: this.opts.enableTestAgent,
    });
    this.broker = new PermissionBroker(this.db, this.bus, this.events, this.settings);
    this.worktrees = new WorktreeService(this.opts.dataDir);
    this.sessions = new SessionManager({
      db: this.db,
      bus: this.bus,
      events: this.events,
      registry: this.registry,
      settings: this.settings,
      broker: this.broker,
      worktrees: this.worktrees,
      log: this.log.child('sessions'),
    });
    this.orchestrator = new Orchestrator({
      db: this.db,
      bus: this.bus,
      sessions: this.sessions,
      broker: this.broker,
      settings: this.settings,
      events: this.events,
      registry: this.registry,
      log: this.log.child('orchestrator'),
    });
    this.devices = new DeviceStore(this.db, this.bus);
    this.push = new PushService(this.db, this.opts.dataDir, this.log.child('push'));
    this.devices.setPushChecker((id) => this.push.hasSubscription(id));
    this.pairing = new PairingService(this.devices, () => this.lanUrls());
    this.notifier = new Notifier(this.bus, this.push, this.settings, this.sessions, this.registry);
    this.gateway = new WsGateway(this);
    this.localToken = this.devices.ensureLocalToken(this.opts.dataDir);

    this.sessions.setMcpProvider((sessionId, token) => {
      const bridge = resolveEntryCommand('mcp-bridge');
      const base = `http://127.0.0.1:${this.boundLocalPort || this.opts.localPort}`;
      return [
        {
          name: 'agent-hub',
          http: { url: `${base}/mcp`, headers: { Authorization: `Bearer ${token}` } },
          stdio: {
            command: bridge.command,
            args: bridge.args,
            env: { ...bridge.env, AGENT_HUB_URL: base, AGENT_HUB_MCP_TOKEN: token },
          },
        },
      ];
    });
  }

  get localUrl(): string {
    return `http://127.0.0.1:${this.boundLocalPort || this.opts.localPort}`;
  }

  get lanPort(): number {
    return this.boundLanPort || this.opts.port;
  }

  /** Login URL for this machine (desktop shell / local browser). */
  get localLoginUrl(): string {
    return `${this.localUrl}/login#token=${encodeURIComponent(this.localToken)}`;
  }

  lanUrls(): string[] {
    if (!this.opts.lan || !this.boundLanPort) return [];
    const port = this.boundLanPort;
    const hosts = this.opts.host === '0.0.0.0' ? this.lanIps : [this.opts.host];
    return hosts.map((h) => `https://${h}:${port}`);
  }

  serverInfo(device: DeviceInfo): ServerInfo {
    return {
      version: VERSION,
      hostname: os.hostname(),
      lanUrls: this.lanUrls(),
      localUrl: this.localUrl,
      caFingerprint: this.tls?.caFingerprint ?? '',
      vapidPublicKey: this.push.publicKey,
      device: { ...device, current: true },
    };
  }

  async start(): Promise<void> {
    this.sessions.load();
    this.orchestrator.load();
    this.broker.recoverStale();
    void this.registry.refresh().catch((err) => this.log.warn('agent detection failed', err));

    const local = await buildApp(this, { secure: false });
    await local.listen({ host: '127.0.0.1', port: this.opts.localPort });
    this.boundLocalPort = (local.server.address() as { port: number }).port;
    this.apps.push(local);

    if (this.opts.lan) {
      this.lanIps = lanAddresses();
      this.tls = ensureTls(this.opts.dataDir, this.lanIps);
      const lan = await buildApp(this, { secure: true, https: { key: this.tls.key, cert: this.tls.cert } });
      await lan.listen({ host: this.opts.host, port: this.opts.port });
      this.boundLanPort = (lan.server.address() as { port: number }).port;
      this.apps.push(lan);
    } else {
      this.tls = ensureTls(this.opts.dataDir, []);
    }
    this.log.info(`Agent Hub ${VERSION} listening: ${[this.localUrl, ...this.lanUrls()].join(', ')}`);
  }

  async close(): Promise<void> {
    await this.sessions.stopAll({ kind: 'system', name: 'Hub shutdown' }, 'hub shutdown').catch(() => undefined);
    this.gateway.close();
    await Promise.all(this.apps.map((a) => a.close().catch(() => undefined)));
    this.events.flush();
    this.db.close();
  }
}

export async function startHub(options: HubOptions = {}): Promise<Hub> {
  const hub = new Hub(options);
  await hub.start();
  return hub;
}
