import { PtyAdapter } from './src/adapters/pty.ts';
import { createLogger } from './src/logger.ts';
const script = `process.stdin.setRawMode?.(true); process.stdout.write('A\\x1b[6nB\\x1b[cC\\x1b]11;?\\x07D'); let got=''; process.stdin.on('data', d => { got += d.toString(); }); setTimeout(() => { process.stdout.write('\\r\\nGOT:' + JSON.stringify(got) + '\\r\\n'); process.exit(0); }, 2500);`;
let out = '';
await new Promise(async (resolve) => {
  const a = new PtyAdapter({ spec: { command: process.execPath, args: ['-e', script] }, cwd: process.cwd(), log: createLogger('silent'), cols: 80, rows: 24,
    callbacks: { emit() {}, async requestPermission() { return { outcome: 'cancelled' }; }, updateSettings() {}, onExit: resolve, onPtyData: (d) => (out += d) } });
  await a.start();
});
console.log('forwarded CPR query to viewers:', out.includes('\x1b[6n'));
console.log('forwarded DA query to viewers:', out.includes('\x1b[c'));
console.log('forwarded OSC11 query to viewers:', out.includes('\x1b]11;?'));
console.log(out.match(/GOT:.*/)?.[0]);
