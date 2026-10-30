import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubBus } from '../src/bus.js';
import { openDatabase, type Db } from '../src/db.js';
import { DeviceStore, PairingService } from '../src/services/devices.js';

describe('device pairing', () => {
  let db: Db;
  let devices: DeviceStore;
  let pairing: PairingService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    devices = new DeviceStore(db, new HubBus());
    pairing = new PairingService(devices, () => ['https://192.168.1.10:7443']);
  });
  afterEach(() => db.close());

  it('pairs with the QR code or the PIN exactly once and stores only token hashes', async () => {
    const ticket = await pairing.start();
    expect(ticket.pin).toMatch(/^\d{6}$/);
    expect(ticket.links[0].url).toBe(`https://192.168.1.10:7443/pair#code=${ticket.code}`);
    expect(ticket.links[0].qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const { token, device } = pairing.complete({ pin: ticket.pin, deviceName: 'Phone' }, '10.0.0.2');
    expect(devices.authenticate(token)).toMatchObject({ id: device.id, name: 'Phone' });
    const stored = db.prepare('SELECT token_hash FROM devices WHERE id = ?').get(device.id) as { token_hash: string };
    expect(stored.token_hash).not.toContain(token);

    expect(() => pairing.complete({ code: ticket.code, deviceName: 'Again' }, '10.0.0.2')).toThrowError(
      expect.objectContaining({ statusCode: 400 }),
    );

    const second = await pairing.start();
    expect(pairing.complete({ code: second.code, deviceName: 'Tablet' }, '10.0.0.3').device.name).toBe('Tablet');
  });

  it('rejects wrong codes and rate limits repeated failures per IP', async () => {
    const ticket = await pairing.start();
    const wrong = ticket.pin === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(() => pairing.complete({ pin: wrong, deviceName: 'x' }, '10.0.0.9')).toThrowError(
        expect.objectContaining({ statusCode: 401 }),
      );
    }
    expect(() => pairing.complete({ pin: ticket.pin, deviceName: 'x' }, '10.0.0.9')).toThrowError(
      expect.objectContaining({ statusCode: 429 }),
    );
    // Another IP with the right PIN still works.
    expect(pairing.complete({ pin: ticket.pin, deviceName: 'ok' }, '10.0.0.10').device.name).toBe('ok');
  });

  it('revoking a device invalidates its token; the local device cannot be revoked', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-dev-'));
    const localToken = devices.ensureLocalToken(dir);
    expect(devices.ensureLocalToken(dir)).toBe(localToken);
    const local = devices.authenticate(localToken)!;
    expect(local.isLocal).toBe(true);
    expect(() => devices.revoke(local.id, 'test')).toThrowError(expect.objectContaining({ statusCode: 400 }));

    const { token, device } = devices.create('Phone');
    devices.revoke(device.id, 'test');
    expect(devices.authenticate(token)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
