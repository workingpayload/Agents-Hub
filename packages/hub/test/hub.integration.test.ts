import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { PermissionRequest, ServerMessage, SessionEvent, SessionInfo, TaskInfo } from '@agent-hub/shared';
import { resolveEntryCommand } from '../src/config.js';
import { startHub, type Hub } from '../src/hub.js';

let hub: Hub;
let dataDir: string;

async function api<T>(method: string, url: string, body?: unknown, token = hub.localToken): Promise<{ status: number; data: T }> {
  const res = await fetch(`${hub.localUrl}${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

async function waitFor<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 150));
  }
}

const events = async (id: string) => (await api<SessionEvent[]>('GET', `/api/sessions/${id}/events`)).data;
const pendingFor = async (sessionId: string) =>
  (await api<PermissionRequest[]>('GET', '/api/permissions?status=pending')).data.find((p) => p.sessionId === sessionId);
const agentText = (list: SessionEvent[]) =>
  list
    .filter((e) => e.kind === 'agent_message_chunk')
    .map((e) => (e as { text: string }).text)
    .join('');

async function createSession(body: Record<string, unknown>): Promise<SessionInfo> {
  const res = await api<SessionInfo>('POST', '/api/sessions', { agentId: 'echo', cwd: dataDir, ...body });
  expect(res.status).toBe(201);
  return res.data;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-test-'));
  hub = await startHub({ dataDir, localPort: 0, lan: false, enableTestAgent: true, logLevel: 'error' });
  await hub.registry.refresh();
});

afterAll(async () => {
  await hub?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('hub integration (Echo ACP agent)', () => {
  let firstSession: SessionInfo;

  it('runs a structured session end to end with a permission approved over the API', async () => {
    firstSession = await createSession({ prompt: 'hi /perm' });
    const perm = await waitFor(() => pendingFor(firstSession.id));
    expect(perm).toMatchObject({ title: 'Run `echo hello`', toolKind: 'execute', detail: 'echo hello' });
    expect((await api<SessionInfo>('GET', `/api/sessions/${firstSession.id}`)).data.status).toBe('awaiting_permission');

    const answered = await api<PermissionRequest>('POST', `/api/permissions/${perm.id}/respond`, { optionId: 'allow' });
    expect(answered.data.status).toBe('approved');
    const second = await api('POST', `/api/permissions/${perm.id}/respond`, { optionId: 'reject' });
    expect(second.status).toBe(409);

    const list = await waitFor(async () => {
      const l = await events(firstSession.id);
      return l.some((e) => e.kind === 'turn_end') && l;
    });
    expect(agentText(list)).toContain('Permission granted');
    expect(agentText(list)).toContain('Echo: hi /perm');
    expect((await api<SessionInfo>('GET', `/api/sessions/${firstSession.id}`)).data.status).toBe('idle');
  });

  it('queues prompts sent while the agent is busy and processes them in order', async () => {
    await api('POST', `/api/sessions/${firstSession.id}/prompt`, { text: 'one /slow' });
    const queued = await api<{ queued: boolean }>('POST', `/api/sessions/${firstSession.id}/prompt`, { text: 'two' });
    expect(queued.data.queued).toBe(true);
    const list = await waitFor(async () => {
      const l = await events(firstSession.id);
      return l.filter((e) => e.kind === 'turn_end').length >= 3 && l;
    });
    const users = list.filter((e) => e.kind === 'user_message').map((e) => (e as { text: string }).text);
    expect(users.slice(-2)).toEqual(['one /slow', 'two']);
  });

  it('streams events over the WebSocket with replay from a sequence number', async () => {
    const ws = new WebSocket(`${hub.localUrl.replace('http', 'ws')}/ws`);
    const messages: ServerMessage[] = [];
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)) as ServerMessage);
    ws.send(JSON.stringify({ type: 'auth', token: hub.localToken }));
    await waitFor(() => messages.some((m) => m.type === 'hello'));
    ws.send(JSON.stringify({ type: 'subscribe', sessionId: firstSession.id, sinceSeq: 3 }));
    const done = await waitFor(() => messages.find((m) => m.type === 'replay_done'));
    const replayed = messages.filter((m) => m.type === 'event').map((m) => (m as { event: SessionEvent }).event);
    const all = await events(firstSession.id);
    expect(replayed[0].seq).toBe(4);
    expect(replayed.length).toBe(all.length - 3);
    expect(done).toMatchObject({ lastSeq: all[all.length - 1].seq });
    expect(messages.some((m) => m.type === 'session')).toBe(true);
    ws.close();

    const bad = new WebSocket(`${hub.localUrl.replace('http', 'ws')}/ws`);
    const code = await new Promise<number>((resolve) => {
      bad.onopen = () => bad.send(JSON.stringify({ type: 'auth', token: 'nope' }));
      bad.onclose = (e) => resolve(e.code);
    });
    expect(code).toBe(4401);
  });

  it('lets an agent delegate to another agent through the hub MCP server after approval', async () => {
    const parent = await createSession({ prompt: '/delegate echo compute 2+2', delegationPolicy: 'ask' });
    const perm = await waitFor(async () => {
      const p = await pendingFor(parent.id);
      return p?.type === 'delegation' && p;
    });
    expect(perm.detail).toBe('compute 2+2');
    await api('POST', `/api/permissions/${perm.id}/respond`, { optionId: 'allow' });

    const task = await waitFor(async () => {
      const tasks = (await api<TaskInfo[]>('GET', '/api/tasks')).data;
      return tasks.find((t) => t.parentSessionId === parent.id && t.status === 'completed');
    });
    expect(task.result).toContain('compute 2+2');
    const child = (await api<SessionInfo>('GET', `/api/sessions/${task.childSessionId}`)).data;
    expect(child).toMatchObject({ parentSessionId: parent.id, taskId: task.id, depth: 1 });

    const parentEvents = await waitFor(async () => {
      const l = await events(parent.id);
      return l.some((e) => e.kind === 'turn_end') && l;
    });
    expect(agentText(parentEvents)).toContain('status: completed');
    expect(parentEvents.filter((e) => e.kind === 'delegation').map((e) => (e as { status: string }).status)).toEqual([
      'pending_approval',
      'running',
      'completed',
    ]);

    // A child repeating its own task to the same agent is a loop.
    await expect(hub.orchestrator.delegate(child.id, { agentId: 'echo', prompt: 'compute 2+2' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('enforces delegation policy and guardrails', async () => {
    const denied = await createSession({ delegationPolicy: 'deny' });
    await expect(hub.orchestrator.delegate(denied.id, { agentId: 'echo', prompt: 'x' })).rejects.toMatchObject({ statusCode: 403 });

    const asking = await createSession({ delegationPolicy: 'ask' });
    const task = await hub.orchestrator.delegate(asking.id, { agentId: 'echo', prompt: 'please' });
    expect(task.status).toBe('pending_approval');
    const perm = await waitFor(() => pendingFor(asking.id));
    await api('POST', `/api/permissions/${perm.id}/respond`, { optionId: 'deny' });
    expect((await hub.orchestrator.wait(task.id, 5)).status).toBe('denied');

    hub.settings.patch({ orchestration: { maxDepth: 0 } });
    try {
      const auto = await createSession({ delegationPolicy: 'auto' });
      await expect(hub.orchestrator.delegate(auto.id, { agentId: 'echo', prompt: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      hub.settings.patch({ orchestration: { maxDepth: 2 } });
    }
  });

  it('exposes the same tools through the stdio MCP bridge', async () => {
    const session = await createSession({});
    await waitFor(() => hub.sessions.isLive(session.id));
    const token = [...(hub.sessions as unknown as { mcpTokens: Map<string, string> }).mcpTokens].find(([, id]) => id === session.id)![0];
    const bridge = resolveEntryCommand('mcp-bridge');
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: bridge.command,
        args: bridge.args,
        env: { ...(process.env as Record<string, string>), AGENT_HUB_URL: hub.localUrl, AGENT_HUB_MCP_TOKEN: token },
      }),
    );
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(tools).toEqual(['cancel_task', 'delegate_task', 'get_task', 'list_agents', 'list_tasks', 'send_message', 'wait_for_task']);
      const res = (await client.callTool({ name: 'list_agents', arguments: {} })) as { content: { text: string }[] };
      expect(res.content[0].text).toContain('echo: Echo Agent (test)');
    } finally {
      await client.close();
    }
  });

  it('rejects MCP calls without a session token and foreign Host headers on the loopback listener', async () => {
    const res = await fetch(`${hub.localUrl}/mcp`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
    const status = await new Promise<number>((resolve) => {
      const url = new URL(hub.localUrl);
      http.get({ host: url.hostname, port: url.port, path: '/api/public/info', headers: { host: 'attacker.example' } }, (r) =>
        resolve(r.statusCode ?? 0),
      );
    });
    expect(status).toBe(421);
    expect((await api('GET', '/api/sessions', undefined, 'bogus')).status).toBe(401);
  });

  it('reports network/firewall diagnostics for the LAN port', async () => {
    const res = await api<{ platform: string; port: number; firewall: { checked: boolean }; fixCommand?: string }>(
      'GET',
      '/api/network/diagnostics',
    );
    expect(res.status).toBe(200);
    expect(res.data.port).toBe(hub.lanPort);
    if (process.platform === 'win32') {
      expect(res.data.firewall.checked).toBe(true);
      expect(res.data.fixCommand).toContain(`-LocalPort ${hub.lanPort}`);
    }
  });

  it('stop-all kill switch stops sessions and cancels pending approvals', async () => {
    const s = await createSession({ prompt: '/perm' });
    await waitFor(() => pendingFor(s.id));
    const res = await api<{ stopped: number }>('POST', '/api/stop-all');
    expect(res.data.stopped).toBeGreaterThan(0);
    expect(await pendingFor(s.id)).toBeUndefined();
    expect((await api<SessionInfo>('GET', `/api/sessions/${s.id}`)).data.status).toBe('stopped');
  });

  it('isolates a session in a git worktree and merges its changes back', async () => {
    const repo = path.join(dataDir, 'repo');
    fs.mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'init');
    const s = await createSession({ cwd: repo, isolation: 'worktree' });
    expect(s.workspace).toMatchObject({ type: 'worktree', baseCwd: repo });
    expect(s.cwd.startsWith(path.join(dataDir, 'worktrees'))).toBe(true);

    fs.writeFileSync(path.join(s.cwd, 'agent.txt'), 'made by agent\n');
    const diff = (await api<{ untracked: string[] }>('GET', `/api/sessions/${s.id}/diff`)).data;
    expect(diff.untracked).toContain('agent.txt');

    const merged = await api('POST', `/api/sessions/${s.id}/worktree/merge`, {});
    expect(merged.status).toBe(200);
    expect(fs.readFileSync(path.join(repo, 'agent.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('made by agent\n');

    await api('POST', `/api/sessions/${s.id}/worktree/remove`, {});
    expect(fs.existsSync(s.cwd)).toBe(false);
  });

  it('mirrors terminal-mode agents through a PTY', async () => {
    const s = await createSession({ mode: 'terminal' });
    await waitFor(() => hub.sessions.isLive(s.id));
    let output = '';
    hub.bus.on('pty_output', (id, data) => {
      if (id === s.id) output += data;
    });
    await waitFor(() => (hub.sessions.ptySnapshot(s.id) ?? '').includes('echo>'), 20_000);
    hub.sessions.ptyInput(s.id, 'hello pty\r');
    await waitFor(() => output.includes('Echo: hello pty'), 20_000);
    await api('POST', `/api/sessions/${s.id}/stop`);
  });

  it('keeps one terminal size for all viewers, driven by the most recently active device', async () => {
    const s = await createSession({ mode: 'terminal' });
    await waitFor(() => (hub.sessions.ptySnapshot(s.id) ?? '').includes('echo>'), 20_000);
    const phone = hub.devices.create('Phone');

    const connect = async (token: string) => {
      const ws = new WebSocket(`${hub.localUrl.replace('http', 'ws')}/ws`);
      const messages: ServerMessage[] = [];
      ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)) as ServerMessage);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      ws.send(JSON.stringify({ type: 'auth', token }));
      await waitFor(() => messages.some((m) => m.type === 'hello'));
      ws.send(JSON.stringify({ type: 'subscribe', sessionId: s.id, sinceSeq: 0 }));
      await waitFor(() => messages.some((m) => m.type === 'pty_snapshot'));
      const lastSize = () => [...messages].reverse().find((m) => m.type === 'pty_size') as Extract<ServerMessage, { type: 'pty_size' }>;
      const send = (msg: object) => ws.send(JSON.stringify({ sessionId: s.id, ...msg }));
      return { ws, messages, lastSize, send };
    };
    const desktop = await connect(hub.localToken);
    const mobile = await connect(phone.token);

    // Late joiners get the size before a clean snapshot of the current screen.
    const firstSize = desktop.messages.findIndex((m) => m.type === 'pty_size');
    const firstSnap = desktop.messages.findIndex((m) => m.type === 'pty_snapshot');
    expect(firstSize).toBeGreaterThanOrEqual(0);
    expect(firstSize).toBeLessThan(firstSnap);
    expect((desktop.messages[firstSnap] as { data: string }).data).toContain('echo>');

    desktop.send({ type: 'pty_resize', cols: 100, rows: 30, claim: true });
    await waitFor(() => mobile.lastSize()?.cols === 100);
    expect(desktop.lastSize()).toMatchObject({ cols: 100, rows: 30, driverName: 'This computer', mine: true });
    expect(mobile.lastSize().mine).toBe(false);

    // Opening the terminal on the phone sizes it for the phone, and the desktop is told to follow.
    mobile.send({ type: 'pty_resize', cols: 40, rows: 20, claim: true });
    await waitFor(() => desktop.lastSize()?.cols === 40);
    expect(desktop.lastSize()).toMatchObject({ cols: 40, rows: 20, driverName: 'Phone' });
    expect(hub.sessions.ptySize(s.id)).toEqual({ cols: 40, rows: 20 });

    // A non-driver resizing its window does not steal the size...
    desktop.send({ type: 'pty_resize', cols: 110, rows: 35 });
    await new Promise((r) => setTimeout(r, 200));
    expect(hub.sessions.ptySize(s.id)).toEqual({ cols: 40, rows: 20 });
    // ...but typing on the desktop does.
    desktop.send({ type: 'pty_input', data: 'x' });
    await waitFor(() => mobile.lastSize()?.cols === 110);
    expect(mobile.lastSize()).toMatchObject({ cols: 110, rows: 35, driverName: 'This computer' });

    // When the driving device disconnects, the remaining viewer takes over.
    mobile.send({ type: 'pty_resize', cols: 42, rows: 18, claim: true });
    await waitFor(() => desktop.lastSize()?.cols === 42);
    mobile.ws.close();
    await waitFor(() => desktop.lastSize()?.cols === 110);
    expect(hub.sessions.ptySize(s.id)).toEqual({ cols: 110, rows: 35 });

    desktop.ws.close();
    await api('POST', `/api/sessions/${s.id}/stop`);
  });
});
