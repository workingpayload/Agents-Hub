// Scripted ACP agent used for demos and automated tests ("Echo Agent").
// Structured mode speaks ACP over stdio; `--terminal` runs a tiny interactive REPL for PTY mode.
import { Readable, Writable } from 'node:stream';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import * as acp from '@agentclientprotocol/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (process.argv.includes('--terminal')) {
  runTerminal();
} else {
  runAcp();
}

function runTerminal(): void {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write('\x1b[1;36mEcho Agent (terminal mode)\x1b[0m — type a message, "perm" to test approvals, "exit" to quit.\r\n');
  const ask = () =>
    rl.question('echo> ', async (line) => {
      const text = line.trim();
      if (text === 'exit') {
        rl.close();
        process.exit(0);
      }
      if (/perm/i.test(text)) {
        rl.question('Allow running `echo hello`? (y/n) ', (answer) => {
          process.stdout.write(/^y/i.test(answer) ? 'hello\r\nPermission granted.\r\n' : 'Permission denied.\r\n');
          ask();
        });
        return;
      }
      process.stdout.write(`Echo: ${text}\r\n`);
      ask();
    });
  ask();
}

interface SessionState {
  cwd: string;
  mcpServers: acp.McpServer[];
  cancelled: boolean;
  mode: string;
}

function runAcp(): void {
  const sessions = new Map<string, SessionState>();
  const modes: acp.SessionModeState = {
    currentModeId: 'default',
    availableModes: [
      { id: 'default', name: 'Default', description: 'Ask before running tools' },
      { id: 'fast', name: 'Fast', description: 'Respond quickly' },
    ],
  };

  const app = acp
    .agent({ name: 'echo-agent' })
    .onRequest(acp.methods.agent.initialize, async () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false, mcpCapabilities: { http: true, sse: false } },
      agentInfo: { name: 'echo-agent', title: 'Echo Agent', version: '1.0.0' },
      authMethods: [],
    }))
    .onRequest(acp.methods.agent.session.new, async (ctx) => {
      const sessionId = randomUUID();
      sessions.set(sessionId, { cwd: ctx.params.cwd, mcpServers: ctx.params.mcpServers, cancelled: false, mode: 'default' });
      return { sessionId, modes };
    })
    .onRequest(acp.methods.agent.session.setMode, async (ctx) => {
      const s = sessions.get(ctx.params.sessionId);
      if (s) s.mode = ctx.params.modeId;
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: { sessionUpdate: 'current_mode_update', currentModeId: ctx.params.modeId },
      });
      return {};
    })
    .onNotification(acp.methods.agent.session.cancel, async (ctx) => {
      const s = sessions.get(ctx.params.sessionId);
      if (s) s.cancelled = true;
    })
    .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
      const { sessionId } = ctx.params;
      const state = sessions.get(sessionId);
      if (!state) throw acp.RequestError.invalidParams({ sessionId }, 'Unknown session');
      state.cancelled = false;
      const text = ctx.params.prompt
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
      const update = (u: acp.SessionUpdate) => ctx.client.notify(acp.methods.client.session.update, { sessionId, update: u });
      const say = async (message: string) => {
        for (const chunk of message.match(/[\s\S]{1,24}/g) ?? []) {
          if (state.cancelled) return;
          await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } });
          await sleep(5);
        }
      };

      await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking about the request…' } });

      if (text.includes('/fail')) throw new Error('Echo agent failed on purpose');

      if (text.includes('/plan')) {
        await update({
          sessionUpdate: 'plan',
          entries: [
            { content: 'Read the request', status: 'completed', priority: 'high' },
            { content: 'Echo it back', status: 'in_progress', priority: 'medium' },
          ],
        });
      }

      if (text.includes('/slow')) {
        for (let i = 0; i < 40 && !state.cancelled; i++) await sleep(100);
        if (state.cancelled) return { stopReason: 'cancelled' };
      }

      if (text.includes('/perm')) {
        const toolCallId = randomUUID();
        await update({
          sessionUpdate: 'tool_call',
          toolCallId,
          title: 'Run `echo hello`',
          kind: 'execute',
          status: 'pending',
          rawInput: { command: 'echo hello' },
        });
        const res = await ctx.client.request(acp.methods.client.session.requestPermission, {
          sessionId,
          toolCall: { toolCallId, title: 'Run `echo hello`', kind: 'execute', rawInput: { command: 'echo hello' } },
          options: [
            { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        });
        const allowed = res.outcome.outcome === 'selected' && res.outcome.optionId !== 'reject';
        await update({
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: allowed ? 'completed' : 'failed',
          content: [{ type: 'content', content: { type: 'text', text: allowed ? 'hello' : 'Permission denied' } }],
        });
        if (res.outcome.outcome === 'cancelled') return { stopReason: 'cancelled' };
        await say(allowed ? 'Permission granted; command ran. ' : 'Permission denied; skipped the command. ');
      }

      if (text.includes('/edit')) {
        const toolCallId = randomUUID();
        await update({
          sessionUpdate: 'tool_call',
          toolCallId,
          title: 'Edit hello.txt',
          kind: 'edit',
          status: 'completed',
          locations: [{ path: `${state.cwd}/hello.txt` }],
          content: [{ type: 'diff', path: `${state.cwd}/hello.txt`, oldText: 'hello\n', newText: 'hello world\n' }],
        });
      }

      const delegate = text.match(/\/delegate\s+(\S+)\s+([\s\S]+)/);
      if (delegate) {
        const [, agentId, task] = delegate;
        try {
          const result = await delegateViaMcp(state.mcpServers, agentId, task.trim());
          await say(`Delegation result:\n${result}`);
        } catch (err) {
          await say(`Delegation failed: ${(err as Error).message}`);
        }
        return { stopReason: state.cancelled ? 'cancelled' : 'end_turn' };
      }

      await say(`Echo: ${text}`);
      return { stopReason: state.cancelled ? 'cancelled' : 'end_turn' };
    });

  app.connect(
    acp.ndJsonStream(
      Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
      Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
    ),
  );
}

async function delegateViaMcp(servers: acp.McpServer[], agentId: string, prompt: string): Promise<string> {
  const spec = servers.find((s) => s.name === 'agent-hub');
  if (!spec) throw new Error('agent-hub MCP server not configured');
  const client = new Client({ name: 'echo-agent', version: '1.0.0' });
  if ('type' in spec && spec.type === 'http') {
    const headers = Object.fromEntries(spec.headers.map((h) => [h.name, h.value]));
    await client.connect(new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers } }));
  } else if (!('type' in spec)) {
    const env = Object.fromEntries(spec.env.map((e) => [e.name, e.value]));
    await client.connect(
      new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...process.env, ...env } as Record<string, string> }),
    );
  } else {
    throw new Error(`Unsupported MCP transport ${spec.type}`);
  }
  try {
    const textOf = (r: unknown) =>
      ((r as { content?: { type: string; text?: string }[] }).content ?? [])
        .map((c) => c.text ?? '')
        .join('\n');
    let out = textOf(
      await client.callTool({ name: 'delegate_task', arguments: { agent_id: agentId, prompt, wait_seconds: 30 } }),
    );
    for (let i = 0; i < 20 && /status: (running|pending_approval)/.test(out); i++) {
      const taskId = out.match(/task_id: (\S+)/)?.[1];
      if (!taskId) break;
      out = textOf(await client.callTool({ name: 'wait_for_task', arguments: { task_id: taskId, timeout_seconds: 30 } }));
    }
    return out;
  } finally {
    await client.close();
  }
}
