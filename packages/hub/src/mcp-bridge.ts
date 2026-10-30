// Stdio MCP server spawned by agents that cannot reach the hub's HTTP MCP endpoint directly.
// It exposes the same tools and forwards each call to the hub REST API with the session's token.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { TaskInfo } from '@agent-hub/shared';
import { VERSION } from './config.js';
import { registerHubTools, type HubAgentSummary, type HubToolApi } from './mcp/tools.js';

const base = process.env.AGENT_HUB_URL;
const token = process.env.AGENT_HUB_MCP_TOKEN;
if (!base || !token) {
  process.stderr.write('agent-hub MCP bridge: AGENT_HUB_URL and AGENT_HUB_MCP_TOKEN must be set\n');
  process.exit(1);
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api/mcp${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Hub responded ${res.status}`);
  return json as T;
}

const api: HubToolApi = {
  listAgents: () => call<HubAgentSummary[]>('GET', '/agents'),
  delegate: (body) => call<TaskInfo>('POST', '/tasks', body),
  getTask: (id) => call<TaskInfo>('GET', `/tasks/${encodeURIComponent(id)}`),
  waitForTask: (id, seconds) => call<TaskInfo>('GET', `/tasks/${encodeURIComponent(id)}?wait=${seconds}`),
  sendMessage: (id, text, waitSeconds) =>
    call<TaskInfo>('POST', `/tasks/${encodeURIComponent(id)}/messages`, { text, waitSeconds }),
  listTasks: () => call<TaskInfo[]>('GET', '/tasks'),
  cancelTask: (id) => call<TaskInfo>('POST', `/tasks/${encodeURIComponent(id)}/cancel`),
};

const server = new McpServer({ name: 'agent-hub', version: VERSION });
registerHubTools(server, api);
await server.connect(new StdioServerTransport());
