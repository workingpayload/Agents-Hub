import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DelegateTaskBody, TaskInfo } from '@agent-hub/shared';

export interface HubAgentSummary {
  id: string;
  name: string;
  description: string;
  activeSessions: number;
}

/** Operations behind the hub MCP tools; implemented in-process (HTTP) or over REST (stdio bridge). */
export interface HubToolApi {
  listAgents(): Promise<HubAgentSummary[]>;
  delegate(body: DelegateTaskBody): Promise<TaskInfo>;
  getTask(taskId: string): Promise<TaskInfo>;
  waitForTask(taskId: string, seconds: number): Promise<TaskInfo>;
  sendMessage(taskId: string, text: string, waitSeconds: number): Promise<TaskInfo>;
  listTasks(): Promise<TaskInfo[]>;
  cancelTask(taskId: string): Promise<TaskInfo>;
}

export const DEFAULT_WAIT_SECONDS = 45;

export function formatTask(t: TaskInfo): string {
  const lines = [`task_id: ${t.id}`, `agent: ${t.agentId}`, `status: ${t.status}`];
  if (t.childSessionId) lines.push(`session_id: ${t.childSessionId}`);
  if (t.status === 'pending_approval') {
    lines.push('', 'Waiting for the user to approve this delegation. Call wait_for_task to keep waiting.');
  } else if (t.status === 'running') {
    lines.push('', 'The agent is still working. Call wait_for_task with this task_id to get the result.');
  }
  if (t.error) lines.push(`error: ${t.error}`);
  if (t.result) lines.push('', 'result:', t.result);
  return lines.join('\n');
}

function text(body: string, isError = false) {
  return { content: [{ type: 'text' as const, text: body }], isError };
}

async function guard(fn: () => Promise<string>) {
  try {
    return text(await fn());
  } catch (err) {
    return text(`Error: ${(err as Error).message}`, true);
  }
}

export function registerHubTools(server: McpServer, api: HubToolApi): void {
  server.registerTool(
    'list_agents',
    {
      title: 'List agents',
      description:
        'List the coding agents available in Agent Hub that you can delegate work to (e.g. copilot, claude, codex, gemini).',
      inputSchema: {},
    },
    () =>
      guard(async () => {
        const agents = await api.listAgents();
        if (!agents.length) return 'No agents are currently available for delegation.';
        return agents.map((a) => `- ${a.id}: ${a.name} — ${a.description} (active sessions: ${a.activeSessions})`).join('\n');
      }),
  );

  server.registerTool(
    'delegate_task',
    {
      title: 'Delegate task to another agent',
      description:
        'Ask another coding agent to perform a task. The agent works in its own session (same project folder by default) ' +
        'and its final reply is returned as the result. The user may need to approve the delegation. ' +
        'Write a self-contained prompt: the other agent cannot see your conversation.',
      inputSchema: {
        agent_id: z.string().describe('Agent id from list_agents, e.g. "claude" or "codex"'),
        prompt: z.string().describe('Complete, self-contained instructions for the other agent'),
        cwd: z.string().optional().describe('Working directory (defaults to your current directory)'),
        isolation: z
          .enum(['shared', 'worktree'])
          .optional()
          .describe('"worktree" gives the agent an isolated git worktree/branch; default "shared"'),
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .max(1800)
          .optional()
          .describe(`Seconds to wait for the result before returning (default ${DEFAULT_WAIT_SECONDS})`),
      },
    },
    (args) =>
      guard(async () => {
        const task = await api.delegate({
          agentId: args.agent_id,
          prompt: args.prompt,
          cwd: args.cwd,
          isolation: args.isolation,
          waitSeconds: args.wait_seconds ?? DEFAULT_WAIT_SECONDS,
        });
        return formatTask(task);
      }),
  );

  server.registerTool(
    'wait_for_task',
    {
      title: 'Wait for delegated task',
      description: 'Wait for a delegated task to finish and return its result.',
      inputSchema: {
        task_id: z.string(),
        timeout_seconds: z.number().int().min(1).max(1800).optional().describe(`Default ${DEFAULT_WAIT_SECONDS}`),
      },
    },
    (args) => guard(async () => formatTask(await api.waitForTask(args.task_id, args.timeout_seconds ?? DEFAULT_WAIT_SECONDS))),
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get delegated task',
      description: 'Get the current status and result of a delegated task without waiting.',
      inputSchema: { task_id: z.string() },
    },
    (args) => guard(async () => formatTask(await api.getTask(args.task_id))),
  );

  server.registerTool(
    'send_message',
    {
      title: 'Message delegated agent',
      description: 'Send a follow-up instruction to the agent working on a finished delegated task (it keeps its context).',
      inputSchema: {
        task_id: z.string(),
        text: z.string(),
        wait_seconds: z.number().int().min(0).max(1800).optional().describe(`Default ${DEFAULT_WAIT_SECONDS}`),
      },
    },
    (args) =>
      guard(async () => formatTask(await api.sendMessage(args.task_id, args.text, args.wait_seconds ?? DEFAULT_WAIT_SECONDS))),
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List delegated tasks',
      description: 'List the tasks you have delegated in this session.',
      inputSchema: {},
    },
    () =>
      guard(async () => {
        const tasks = await api.listTasks();
        if (!tasks.length) return 'You have not delegated any tasks yet.';
        return tasks.map((t) => `- ${t.id} [${t.status}] ${t.agentId}: ${t.prompt.replace(/\s+/g, ' ').slice(0, 100)}`).join('\n');
      }),
  );

  server.registerTool(
    'cancel_task',
    {
      title: 'Cancel delegated task',
      description: 'Cancel a delegated task and stop the agent working on it.',
      inputSchema: { task_id: z.string() },
    },
    (args) => guard(async () => formatTask(await api.cancelTask(args.task_id))),
  );
}
