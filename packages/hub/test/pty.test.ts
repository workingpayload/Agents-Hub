import { afterEach, describe, expect, it } from 'vitest';
import { PtyAdapter } from '../src/adapters/pty.js';
import { createLogger } from '../src/logger.js';
import type { AdapterCallbacks } from '../src/adapters/types.js';

// A tiny program that asks the terminal for the cursor position (as many TUIs do on startup)
// and prints whatever reply arrives on stdin.
const QUERY_SCRIPT = `
process.stdin.setRawMode?.(true);
process.stdout.write('ready\\r\\n\\x1b[6n');
let got = '';
process.stdin.on('data', (d) => {
  got += d.toString();
  if (/R/.test(got)) { process.stdout.write('REPLY:' + JSON.stringify(got) + '\\r\\n'); process.exit(0); }
});
setTimeout(() => { process.stdout.write('NO-REPLY\\r\\n'); process.exit(1); }, 5000);
`;

describe('PtyAdapter', () => {
  let adapter: PtyAdapter | undefined;
  afterEach(async () => {
    await adapter?.stop();
  });

  it('answers terminal queries itself, even with no viewer attached', async () => {
    let output = '';
    const exited = new Promise<void>((resolve) => {
      const callbacks: AdapterCallbacks = {
        emit: () => undefined,
        requestPermission: async () => ({ outcome: 'cancelled' }),
        updateSettings: () => undefined,
        onExit: () => resolve(),
        onPtyData: (d) => (output += d),
      };
      adapter = new PtyAdapter({
        spec: { command: process.execPath, args: ['-e', QUERY_SCRIPT] },
        cwd: process.cwd(),
        callbacks,
        log: createLogger('silent'),
        cols: 80,
        rows: 24,
      });
    });
    await adapter!.start();
    await exited;
    expect(output).toMatch(/REPLY:"\\u001b\[\d+;\d+R"/);
    expect(output).not.toContain('NO-REPLY');
  });

  it('serializes the current screen for late joiners and resizes the emulator with the PTY', async () => {
    adapter = new PtyAdapter({
      spec: { command: process.execPath, args: ['-e', "process.stdout.write('hello from pty\\r\\n'); setTimeout(() => {}, 10000)"] },
      cwd: process.cwd(),
      callbacks: {
        emit: () => undefined,
        requestPermission: async () => ({ outcome: 'cancelled' }),
        updateSettings: () => undefined,
        onExit: () => undefined,
      },
      log: createLogger('silent'),
      cols: 100,
      rows: 30,
    });
    await adapter.start();
    const deadline = Date.now() + 10_000;
    while (!adapter.snapshot().includes('hello from pty') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(adapter.snapshot()).toContain('hello from pty');
    expect(adapter.resize(40, 12)).toEqual({ cols: 40, rows: 12 });
    expect(adapter.size()).toEqual({ cols: 40, rows: 12 });
    expect(adapter.resize(5, 1)).toEqual({ cols: 20, rows: 5 });
  });
});
