import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import type { DeviceInfo, PairingTicket } from '@agent-hub/shared';
import { audit, type Db } from '../db.js';
import type { HubBus } from '../bus.js';
import { HttpError } from './sessions.js';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

interface DeviceRow {
  id: string;
  name: string;
  token_hash: string;
  is_local: number;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

/** Paired devices and their bearer tokens (only SHA-256 hashes are stored). */
export class DeviceStore {
  private lastSeenWrites = new Map<string, number>();
  private pushCheck?: (deviceId: string) => boolean;

  constructor(
    private db: Db,
    private bus: HubBus,
  ) {}

  setPushChecker(fn: (deviceId: string) => boolean): void {
    this.pushCheck = fn;
  }

  create(name: string, isLocal = false): { device: DeviceInfo; token: string } {
    const token = newToken();
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare('INSERT INTO devices (id, name, token_hash, is_local, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, hashToken(token), isLocal ? 1 : 0, now);
    audit(this.db, name, 'device.pair', { id, isLocal });
    return { device: this.get(id)!, token };
  }

  /**
   * Returns the token of the "This computer" device, persisted in the data directory so the
   * desktop shell and CLI can log in without pairing.
   */
  ensureLocalToken(dataDir: string): string {
    const file = path.join(dataDir, 'local-token');
    if (fs.existsSync(file)) {
      const token = fs.readFileSync(file, 'utf8').trim();
      if (token && this.authenticate(token)) return token;
    }
    const { token } = this.create('This computer', true);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, token, { mode: 0o600 });
    return token;
  }

  authenticate(token: string | undefined | null): DeviceInfo | null {
    if (!token) return null;
    const row = this.db
      .prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL')
      .get(hashToken(token)) as DeviceRow | undefined;
    if (!row) return null;
    const now = Date.now();
    if (now - (this.lastSeenWrites.get(row.id) ?? 0) > 60_000) {
      this.lastSeenWrites.set(row.id, now);
      this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, row.id);
      row.last_seen_at = now;
    }
    return this.toInfo(row);
  }

  list(): DeviceInfo[] {
    const rows = this.db
      .prepare('SELECT * FROM devices WHERE revoked_at IS NULL ORDER BY created_at ASC')
      .all() as unknown as DeviceRow[];
    return rows.map((r) => this.toInfo(r));
  }

  get(id: string): DeviceInfo | undefined {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ? AND revoked_at IS NULL').get(id) as
      | DeviceRow
      | undefined;
    return row ? this.toInfo(row) : undefined;
  }

  rename(id: string, name: string): DeviceInfo {
    if (!this.get(id)) throw new HttpError(404, 'Device not found');
    this.db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name, id);
    return this.get(id)!;
  }

  revoke(id: string, by: string): void {
    const device = this.get(id);
    if (!device) throw new HttpError(404, 'Device not found');
    if (device.isLocal) throw new HttpError(400, 'The local device cannot be revoked');
    this.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ?').run(Date.now(), id);
    this.db.prepare('DELETE FROM push_subscriptions WHERE device_id = ?').run(id);
    audit(this.db, by, 'device.revoke', { id, name: device.name });
    this.bus.emit('device_revoked', id);
  }

  private toInfo(r: DeviceRow): DeviceInfo {
    return {
      id: r.id,
      name: r.name,
      isLocal: r.is_local === 1,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at ?? undefined,
      pushEnabled: this.pushCheck?.(r.id) ?? false,
    };
  }
}

const TICKET_TTL_MS = 5 * 60_000;
const MAX_FAILURES_PER_IP = 5;
const FAILURE_WINDOW_MS = 10 * 60_000;
const MAX_TICKET_FAILURES = 10;

interface ActiveTicket {
  code: string;
  pin: string;
  expiresAt: number;
  failures: number;
}

/**
 * One-time pairing: the desktop shows a QR code (long random code) and a 6-digit PIN; a new device
 * exchanges either for a long-lived device token. Attempts are rate limited per IP and per ticket.
 */
export class PairingService {
  private ticket?: ActiveTicket;
  private failures = new Map<string, number[]>();

  constructor(
    private devices: DeviceStore,
    private urls: () => string[],
  ) {}

  isActive(): boolean {
    return Boolean(this.ticket && this.ticket.expiresAt > Date.now());
  }

  async start(): Promise<PairingTicket> {
    const ticket: ActiveTicket = {
      code: randomBytes(24).toString('base64url'),
      pin: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      expiresAt: Date.now() + TICKET_TTL_MS,
      failures: 0,
    };
    this.ticket = ticket;
    const links = await Promise.all(
      this.urls().map(async (base) => {
        const url = `${base}/pair#code=${ticket.code}`;
        return { url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 320 }) };
      }),
    );
    return { code: ticket.code, pin: ticket.pin, expiresAt: ticket.expiresAt, links };
  }

  cancel(): void {
    this.ticket = undefined;
  }

  complete(input: { code?: string; pin?: string; deviceName: string }, ip: string): { device: DeviceInfo; token: string } {
    const now = Date.now();
    const recent = (this.failures.get(ip) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
    this.failures.set(ip, recent);
    if (recent.length >= MAX_FAILURES_PER_IP) {
      throw new HttpError(429, 'Too many pairing attempts. Wait a few minutes and try again.');
    }
    const ticket = this.ticket;
    if (!ticket || ticket.expiresAt < now) {
      this.fail(ip);
      throw new HttpError(400, 'No active pairing request. Start pairing on the host computer first.');
    }
    const ok =
      (input.code !== undefined && safeEqual(input.code, ticket.code)) ||
      (input.pin !== undefined && safeEqual(input.pin, ticket.pin));
    if (!ok) {
      this.fail(ip);
      ticket.failures += 1;
      if (ticket.failures >= MAX_TICKET_FAILURES) this.ticket = undefined;
      throw new HttpError(401, 'Invalid or expired pairing code');
    }
    this.ticket = undefined;
    return this.devices.create(input.deviceName.trim());
  }

  private fail(ip: string): void {
    const list = this.failures.get(ip) ?? [];
    list.push(Date.now());
    this.failures.set(ip, list);
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
