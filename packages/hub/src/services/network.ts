import os from 'node:os';

const VIRTUAL_IFACE = /(vethernet|wsl|docker|virtualbox|vmware|hyper-v|loopback|vbox|tailscale|zerotier|utun|bridge|br-|veth)/i;

function score(name: string, address: string): number {
  let s = 0;
  if (address.startsWith('192.168.')) s += 30;
  else if (address.startsWith('10.')) s += 20;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) s += 10;
  if (/wi-?fi|wlan|wireless|ethernet|^en|^eth/i.test(name)) s += 5;
  if (VIRTUAL_IFACE.test(name)) s -= 50;
  return s;
}

/** Private IPv4 addresses of this machine, most likely LAN interface first. */
export function lanAddresses(): string[] {
  const out: { address: string; score: number }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      out.push({ address: a.address, score: score(name, a.address) });
    }
  }
  return out.sort((x, y) => y.score - x.score).map((x) => x.address);
}
