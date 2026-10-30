import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import {
  createSessionSchema,
  delegateTaskSchema,
  handoffSchema,
  pairCompleteSchema,
  permissionResponseSchema,
  promptSchema,
  pushSubscribeSchema,
  sessionConfigSchema,
  settingsPatchSchema,
  taskMessageSchema,
  updateDeviceSchema,
  updateSessionSchema,
  worktreeCommitSchema,
  type Actor,
  type AuditEntry,
  type DeviceInfo,
  type DirectoryListing,
  type NetworkDiagnostics,
  type PermissionStatus,
  type PublicInfo,
} from '@agent-hub/shared';
import { APP_NAME, VERSION } from '../config.js';
import { audit } from '../db.js';
import type { Hub } from '../hub.js';
import { createLocalToolApi } from '../mcp/local-api.js';
import { registerHubTools } from '../mcp/tools.js';
import { diagnoseNetwork, firewallFixCommand } from '../services/firewall.js';
import { HttpError } from '../services/sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    device: DeviceInfo | null;
  }
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const PUBLIC_API = new Set(['/api/public/info', '/api/pairing/complete']);

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  return undefined;
}

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value ?? {});
}

export function actorOf(req: FastifyRequest): Actor {
  const d = req.device;
  return d ? { kind: 'device', id: d.id, name: d.name } : { kind: 'system', name: 'unknown' };
}

export interface AppOptions {
  secure: boolean;
  https?: { key: string; cert: string };
}

export async function buildApp(hub: Hub, opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 4 * 1024 * 1024,
    trustProxy: false,
    ...(opts.https ? { https: { key: opts.https.key, cert: opts.https.cert } } : {}),
  }) as unknown as FastifyInstance;

  app.decorateRequest('device', null);
  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });
  // Accept bodies with any content type (e.g. bodiless action POSTs from scripts); JSON is parsed when present.
  // Auth uses bearer headers, so lenient parsing does not open a CSRF hole.
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(null, undefined);
    }
  });

  app.addHook('onRequest', async (req, reply) => {
    // The loopback listener only answers to loopback host names (DNS-rebinding protection).
    if (!opts.secure && !LOOPBACK_HOST.test(req.headers.host ?? '')) {
      return reply.code(421).send({ error: 'Misdirected request' });
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
  });

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || PUBLIC_API.has(url) || url.startsWith('/api/mcp/')) return;
    const device = hub.devices.authenticate(bearer(req));
    if (!device) return reply.code(401).send({ error: 'Unauthorized. Pair this device first.' });
    req.device = device;
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) hub.log.error('request failed', err);
    return reply.code(status).send({ error: err.message || 'Internal error' });
  });

  registerPublicRoutes(app, hub);
  registerApiRoutes(app, hub);
  if (!opts.secure) registerMcpRoutes(app, hub);

  app.get('/ws', { websocket: true }, (socket, req) => hub.gateway.handle(socket, req, opts.secure));

  await registerStatic(app, hub);
  return app;
}

function registerPublicRoutes(app: FastifyInstance, hub: Hub): void {
  app.get('/api/public/info', async (): Promise<PublicInfo> => ({
    name: APP_NAME,
    version: VERSION,
    hostname: os.hostname(),
    caFingerprint: hub.tls?.caFingerprint ?? '',
    pairingActive: hub.pairing.isActive(),
  }));

  app.post('/api/pairing/complete', async (req) => {
    const body = parse(pairCompleteSchema, req.body);
    const { device, token } = hub.pairing.complete(body, req.ip);
    return { token, device };
  });

  app.get('/ca.crt', async (_req, reply) => {
    if (!hub.tls) return reply.code(404).send('Not available');
    reply.header('Content-Type', 'application/x-x509-ca-cert');
    reply.header('Content-Disposition', 'attachment; filename="agent-hub-ca.crt"');
    return hub.tls.caCert;
  });
}

function registerApiRoutes(app: FastifyInstance, hub: Hub): void {
  const { sessions, broker, orchestrator, registry, settings, devices, pairing, push, events, worktrees } = hub;

  app.get('/api/me', async (req) => hub.serverInfo(req.device!));

  // Agents
  app.get('/api/agents', async () => registry.list());
  app.post('/api/agents/refresh', async () => registry.refresh());

  // Sessions
  app.get('/api/sessions', async (req) => {
    const q = req.query as { archived?: string };
    return sessions.list(q.archived === '1' || q.archived === 'true');
  });
  app.post('/api/sessions', async (req, reply) => {
    const body = parse(createSessionSchema, req.body);
    const session = await sessions.create({ ...body, createdBy: actorOf(req) });
    return reply.code(201).send(session);
  });
  app.get('/api/sessions/:id', async (req) => sessions.require((req.params as { id: string }).id));
  app.patch('/api/sessions/:id', async (req) =>
    sessions.update((req.params as { id: string }).id, parse(updateSessionSchema, req.body), actorOf(req)),
  );
  app.delete('/api/sessions/:id', async (req) => {
    await sessions.remove((req.params as { id: string }).id, actorOf(req));
    return { ok: true };
  });
  app.get('/api/sessions/:id/events', async (req) => {
    const { id } = req.params as { id: string };
    sessions.require(id);
    const q = req.query as { since?: string; limit?: string };
    return events.list(id, Number(q.since ?? 0) || 0, Math.min(Number(q.limit ?? 5000) || 5000, 20_000));
  });
  app.post('/api/sessions/:id/prompt', async (req) => {
    const { text } = parse(promptSchema, req.body);
    return sessions.prompt((req.params as { id: string }).id, text, actorOf(req));
  });
  app.delete('/api/sessions/:id/queue/:qid', async (req) => {
    const { id, qid } = req.params as { id: string; qid: string };
    return sessions.removeQueued(id, qid);
  });
  app.post('/api/sessions/:id/cancel', async (req) => {
    await sessions.cancel((req.params as { id: string }).id, actorOf(req));
    return { ok: true };
  });
  app.post('/api/sessions/:id/stop', async (req) => {
    await sessions.stop((req.params as { id: string }).id, actorOf(req));
    return { ok: true };
  });
  app.post('/api/sessions/:id/restart', async (req) => sessions.restart((req.params as { id: string }).id, actorOf(req)));
  app.post('/api/sessions/:id/config', async (req) =>
    sessions.configure((req.params as { id: string }).id, parse(sessionConfigSchema, req.body)),
  );
  app.post('/api/sessions/:id/handoff', async (req) => {
    const { id } = req.params as { id: string };
    const source = sessions.require(id);
    const body = parse(handoffSchema, req.body);
    const sourceAgent = registry.get(source.agentId)?.name ?? source.agentId;
    const text = [
      `[Context handed off from ${sourceAgent} (session "${source.title}") via Agent Hub]`,
      body.note ? `\n${body.note}\n` : '',
      body.text,
    ]
      .filter(Boolean)
      .join('\n');
    const from = actorOf(req);
    if (body.targetSessionId) {
      await sessions.prompt(body.targetSessionId, text, from);
      return { sessionId: body.targetSessionId };
    }
    const created = await sessions.create({
      agentId: body.agentId!,
      cwd: source.cwd,
      prompt: text,
      createdBy: from,
      title: `Hand-off from ${sourceAgent}: ${source.title}`.slice(0, 120),
    });
    return { sessionId: created.id };
  });
  app.get('/api/sessions/:id/diff', async (req) => {
    const s = sessions.require((req.params as { id: string }).id);
    return worktrees.diff(s.cwd);
  });
  app.post('/api/sessions/:id/worktree/commit', async (req) => {
    const s = sessions.require((req.params as { id: string }).id);
    if (s.workspace.type !== 'worktree' || !s.workspace.worktreePath) throw new HttpError(400, 'Session has no worktree');
    const { message } = parse(worktreeCommitSchema, req.body);
    const committed = await worktrees.commit(s.workspace.worktreePath, message ?? `Agent Hub: ${s.title}`);
    audit(hub.db, actorOf(req).name, 'worktree.commit', { session: s.id, committed });
    return { committed };
  });
  app.post('/api/sessions/:id/worktree/merge', async (req) => {
    const s = sessions.require((req.params as { id: string }).id);
    if (s.workspace.type !== 'worktree' || !s.workspace.worktreePath || !s.workspace.branch) {
      throw new HttpError(400, 'Session has no worktree');
    }
    try {
      const output = await worktrees.merge(s.workspace.baseCwd, s.workspace.worktreePath, s.workspace.branch, `Agent Hub: ${s.title}`);
      audit(hub.db, actorOf(req).name, 'worktree.merge', { session: s.id, branch: s.workspace.branch });
      events.append(s.id, { kind: 'system', level: 'info', text: `Merged ${s.workspace.branch} into ${s.workspace.baseCwd}` });
      return { ok: true, output };
    } catch (err) {
      throw new HttpError(409, (err as Error).message);
    }
  });
  app.post('/api/sessions/:id/worktree/remove', async (req) => {
    const s = sessions.require((req.params as { id: string }).id);
    if (s.workspace.type !== 'worktree' || !s.workspace.worktreePath) throw new HttpError(400, 'Session has no worktree');
    const q = req.query as { deleteBranch?: string };
    if (sessions.isLive(s.id)) await sessions.stop(s.id, actorOf(req), 'worktree removed');
    await worktrees.remove(s.workspace.baseCwd, s.workspace.worktreePath, s.workspace.branch, q.deleteBranch === '1');
    sessions.markWorktreeRemoved(s.id);
    audit(hub.db, actorOf(req).name, 'worktree.remove', { session: s.id });
    return { ok: true };
  });

  // Permissions
  app.get('/api/permissions', async (req) => {
    const q = req.query as { status?: PermissionStatus; sessionId?: string; limit?: string };
    return broker.list({ status: q.status, sessionId: q.sessionId, limit: q.limit ? Number(q.limit) : undefined });
  });
  app.post('/api/permissions/:id/respond', async (req, reply) => {
    const body = parse(permissionResponseSchema, req.body);
    try {
      return broker.respond((req.params as { id: string }).id, body, actorOf(req));
    } catch (err) {
      const e = err as Error & { statusCode?: number; existing?: unknown };
      if (e.statusCode === 409) return reply.code(409).send({ error: e.message, permission: e.existing });
      throw err;
    }
  });

  // Orchestration
  app.get('/api/tasks', async (req) => orchestrator.list({ parentSessionId: (req.query as { parentSessionId?: string }).parentSessionId }));
  app.post('/api/tasks/:id/cancel', async (req) => orchestrator.cancel((req.params as { id: string }).id, actorOf(req)));
  app.post('/api/stop-all', async (req) => {
    const by = actorOf(req);
    orchestrator.cancelAll(by);
    broker.cancelAll(by);
    const stopped = await sessions.stopAll(by, 'kill switch');
    audit(hub.db, by.name, 'stop_all', { stopped });
    return { stopped };
  });

  // Settings
  app.get('/api/settings', async () => settings.get());
  app.patch('/api/settings', async (req) => {
    const patch = parse(settingsPatchSchema, req.body);
    const result = settings.patch(patch);
    audit(hub.db, actorOf(req).name, 'settings.update', patch);
    if (patch.agents) void registry.refresh();
    return result;
  });

  // Devices & pairing
  app.get('/api/devices', async (req) => devices.list().map((d) => ({ ...d, current: d.id === req.device!.id })));
  app.patch('/api/devices/:id', async (req) => devices.rename((req.params as { id: string }).id, parse(updateDeviceSchema, req.body).name));
  app.delete('/api/devices/:id', async (req) => {
    devices.revoke((req.params as { id: string }).id, actorOf(req).name);
    return { ok: true };
  });
  app.post('/api/pairing/start', async (req) => {
    if (!hub.opts.lan) throw new HttpError(400, 'LAN access is disabled; start the hub without --no-lan to pair devices');
    audit(hub.db, actorOf(req).name, 'pairing.start', {});
    return pairing.start();
  });
  app.delete('/api/pairing', async () => {
    pairing.cancel();
    return { ok: true };
  });

  // Push notifications
  app.post('/api/push/subscribe', async (req) => {
    push.subscribe(req.device!.id, parse(pushSubscribeSchema, req.body));
    return { ok: true };
  });
  app.delete('/api/push/subscribe', async (req) => {
    const body = (req.body ?? {}) as { endpoint?: string };
    push.unsubscribe(req.device!.id, body.endpoint);
    return { ok: true };
  });
  app.post('/api/push/test', async (req) => {
    const delivered = await push.send(
      { kind: 'info', title: 'Agent Hub', body: `Test notification for ${req.device!.name}`, url: '/settings', tag: 'test' },
      req.device!.id,
    );
    return { delivered };
  });

  // File system browser (used to pick working directories remotely)
  app.get('/api/fs/list', async (req): Promise<DirectoryListing> => {
    const q = req.query as { path?: string };
    const target = path.resolve(q.path || settings.get().defaultCwd || os.homedir());
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(target, { withFileTypes: true });
    } catch (err) {
      throw new HttpError(400, `Cannot read ${target}: ${(err as Error).message}`);
    }
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('$'))
      .map((e) => {
        const full = path.join(target, e.name);
        return { name: e.name, path: full, isGitRepo: fs.existsSync(path.join(full, '.git')) };
      })
      .sort((a, b) => Number(a.name.startsWith('.')) - Number(b.name.startsWith('.')) || a.name.localeCompare(b.name));
    const parent = path.dirname(target);
    return { path: target, parent: parent !== target ? parent : undefined, entries: dirs, roots: listRoots() };
  });

  app.get('/api/audit', async (req): Promise<AuditEntry[]> => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 200) || 200, 1000);
    return hub.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit) as unknown as AuditEntry[];
  });

  app.get('/api/network/diagnostics', async (): Promise<NetworkDiagnostics> => {
    const result = await diagnoseNetwork(hub.lanPort, process.execPath);
    return { ...result, fixCommand: result.platform === 'win32' ? firewallFixCommand(hub.lanPort) : undefined };
  });
}

function listRoots(): string[] {
  if (process.platform !== 'win32') return ['/', os.homedir()];
  const roots: string[] = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch {
      // ignore
    }
  }
  return [os.homedir(), ...roots];
}

/** Endpoints used by agents (loopback only), authenticated with the per-session MCP token. */
function registerMcpRoutes(app: FastifyInstance, hub: Hub): void {
  const sessionFor = (req: FastifyRequest, reply: FastifyReply) => {
    const token = bearer(req);
    const session = token ? hub.sessions.sessionForMcpToken(token) : undefined;
    if (!session) {
      void reply.code(401).send({ error: 'Invalid MCP token' });
      return undefined;
    }
    return session;
  };
  const apiFor = (sessionId: string) => {
    const s = hub.sessions.get(sessionId)!;
    const name = hub.registry.get(s.agentId)?.name ?? s.agentId;
    return createLocalToolApi(sessionId, hub.orchestrator, { kind: 'agent', id: sessionId, name });
  };

  app.post('/mcp', async (req, reply) => {
    const session = sessionFor(req, reply);
    if (!session) return reply;
    const server = new McpServer({ name: 'agent-hub', version: VERSION });
    registerHubTools(server, apiFor(session.id));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
    return reply;
  });
  const notAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).header('Allow', 'POST').send({ error: 'Method not allowed' });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);

  // REST mirror of the MCP tools for the stdio bridge.
  app.get('/api/mcp/agents', async (req, reply) => {
    const s = sessionFor(req, reply);
    return s ? apiFor(s.id).listAgents() : reply;
  });
  app.get('/api/mcp/tasks', async (req, reply) => {
    const s = sessionFor(req, reply);
    return s ? apiFor(s.id).listTasks() : reply;
  });
  app.post('/api/mcp/tasks', async (req, reply) => {
    const s = sessionFor(req, reply);
    return s ? apiFor(s.id).delegate(parse(delegateTaskSchema, req.body)) : reply;
  });
  app.get('/api/mcp/tasks/:taskId', async (req, reply) => {
    const s = sessionFor(req, reply);
    if (!s) return reply;
    const wait = Math.min(Number((req.query as { wait?: string }).wait ?? 0) || 0, 1800);
    return apiFor(s.id).waitForTask((req.params as { taskId: string }).taskId, wait);
  });
  app.post('/api/mcp/tasks/:taskId/messages', async (req, reply) => {
    const s = sessionFor(req, reply);
    if (!s) return reply;
    const body = parse(taskMessageSchema, req.body);
    return apiFor(s.id).sendMessage((req.params as { taskId: string }).taskId, body.text, body.waitSeconds ?? 0);
  });
  app.post('/api/mcp/tasks/:taskId/cancel', async (req, reply) => {
    const s = sessionFor(req, reply);
    return s ? apiFor(s.id).cancelTask((req.params as { taskId: string }).taskId) : reply;
  });
}

async function registerStatic(app: FastifyInstance, hub: Hub): Promise<void> {
  const webDir = hub.opts.webDir;
  if (!webDir || !fs.existsSync(path.join(webDir, 'index.html'))) {
    app.get('/', async (_req, reply) =>
      reply
        .type('text/html')
        .send(
          `<!doctype html><title>${APP_NAME}</title><body style="font-family:sans-serif;padding:2rem">` +
            `<h1>${APP_NAME} ${VERSION}</h1><p>The web UI has not been built. Run <code>npm run build</code> ` +
            'in the repository root, or start the UI dev server with <code>npm run dev:web</code>.</p></body>',
        ),
    );
    return;
  }
  await app.register(fastifyStatic, {
    root: webDir,
    wildcard: true,
    setHeaders(res, filePath) {
      const name = path.basename(filePath);
      if (name === 'index.html' || name === 'sw.js' || name.endsWith('.webmanifest')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });
  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && !url.startsWith('/api/') && !url.startsWith('/mcp') && !path.extname(url)) {
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });
}
