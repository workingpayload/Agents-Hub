// Diagnostic: performs an ACP initialize + session/new handshake against an agent command.
// Usage: node scripts/acp-probe.mjs <command> [args...]
import spawn from 'cross-spawn';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: acp-probe <command> [args...]');
  process.exit(2);
}

const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));
child.on('exit', (code) => console.log(`[probe] agent exited with ${code}`));

const app = acp
  .client({ name: 'agent-hub-probe' })
  .onRequest(acp.methods.client.session.requestPermission, async () => ({ outcome: { outcome: 'cancelled' } }))
  .onNotification(acp.methods.client.session.update, async (ctx) => {
    console.log('[update]', ctx.params.update.sessionUpdate);
  });

const conn = app.connect(acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
const timeout = setTimeout(() => {
  console.error('[probe] timeout; stderr:', stderr.slice(-2000));
  child.kill();
  process.exit(1);
}, 60_000);

try {
  const init = await conn.agent.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'agent-hub', version: '0.1.0' },
  });
  console.log('[initialize]', JSON.stringify(init, null, 1).slice(0, 3000));
  const session = await conn.agent.request(acp.methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] });
  console.log('[session/new]', JSON.stringify(session, null, 1).slice(0, 3000));
} catch (err) {
  console.error('[probe] error', err?.message ?? err, JSON.stringify(err?.data ?? ''));
  console.error('[probe] stderr:', stderr.slice(-2000));
} finally {
  clearTimeout(timeout);
  conn.close();
  child.kill();
  setTimeout(() => process.exit(0), 200);
}
