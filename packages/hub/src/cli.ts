#!/usr/bin/env node
import './suppress-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import qrcodeTerminal from 'qrcode-terminal';
import { APP_NAME, VERSION, defaultDataDir, type LogLevel } from './config.js';
import { startHub, type Hub } from './hub.js';

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
}

const USAGE = `${APP_NAME} ${VERSION}

Usage: agent-hub [serve] [options]
       agent-hub token [--data-dir DIR]

Options:
  --port <n>          HTTPS port for LAN devices (default 7443)
  --local-port <n>    Loopback HTTP port for this computer (default 7780)
  --host <addr>       LAN bind address (default 0.0.0.0)
  --no-lan            Disable LAN access (local only)
  --data-dir <dir>    Data directory (default ${defaultDataDir()})
  --web-dir <dir>     Directory with the built web UI
  --pair              Start pairing immediately and print a QR code
  --test-agent        Enable the built-in Echo test agent
  --log-level <lvl>   debug | info | warn | error
  -h, --help          Show this help
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      'local-port': { type: 'string' },
      host: { type: 'string' },
      'no-lan': { type: 'boolean' },
      'data-dir': { type: 'string' },
      'web-dir': { type: 'string' },
      pair: { type: 'boolean' },
      'test-agent': { type: 'boolean' },
      'log-level': { type: 'string' },
      electron: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0] ?? 'serve';
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (command === 'token') {
    const file = path.join(values['data-dir'] ?? defaultDataDir(), 'local-token');
    if (!fs.existsSync(file)) throw new Error('No local token yet; start the hub once first.');
    process.stdout.write(`${fs.readFileSync(file, 'utf8').trim()}\n`);
    return;
  }
  if (command !== 'serve') {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  let hub: Hub;
  try {
    hub = await startHub({
      port: values.port ? Number(values.port) : undefined,
      localPort: values['local-port'] ? Number(values['local-port']) : undefined,
      host: values.host,
      lan: values['no-lan'] ? false : undefined,
      dataDir: values['data-dir'],
      webDir: values['web-dir'],
      enableTestAgent: values['test-agent'] || undefined,
      logLevel: values['log-level'] as LogLevel | undefined,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') {
      throw new Error(`Port already in use (${e.message}). Is another Agent Hub running? Use --port/--local-port.`);
    }
    throw err;
  }

  const lines = [
    '',
    `  ${APP_NAME} ${VERSION} is running`,
    `  This computer: ${hub.localLoginUrl}`,
    ...hub.lanUrls().map((u) => `  LAN:           ${u}`),
    `  Data:          ${hub.opts.dataDir}`,
    hub.tls ? `  CA fingerprint ${hub.tls.caFingerprint}` : '',
    '',
  ].filter((l) => l !== '');
  process.stdout.write(`${lines.join('\n')}\n\n`);

  if (values.pair) {
    const ticket = await hub.pairing.start();
    const link = ticket.links[0];
    process.stdout.write(`  Pairing PIN: ${ticket.pin} (valid 5 minutes)\n`);
    if (link) {
      process.stdout.write(`  Scan to pair: ${link.url}\n`);
      qrcodeTerminal.generate(link.url, { small: true }, (qr: string) => process.stdout.write(`${qr}\n`));
    }
  }

  const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
  if (values.electron && parentPort) {
    parentPort.postMessage({
      type: 'ready',
      localUrl: hub.localUrl,
      loginUrl: hub.localLoginUrl,
      token: hub.localToken,
      lanUrls: hub.lanUrls(),
    });
    parentPort.on('message', (e) => {
      const msg = e.data as { type?: string };
      if (msg?.type === 'shutdown') void shutdown();
    });
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    process.stdout.write('\nShutting down Agent Hub…\n');
    await hub.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
