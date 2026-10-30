import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubBus } from '../src/bus.js';
import { openDatabase, type Db } from '../src/db.js';
import { EventStore } from '../src/services/events.js';
import { autoApproveCovers, PermissionBroker } from '../src/services/permissions.js';
import { SettingsStore } from '../src/services/settings.js';
import type { PermissionOption } from '@agent-hub/shared';

const OPTIONS: PermissionOption[] = [
  { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'always', name: 'Always', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

const phone = { kind: 'device' as const, id: 'd1', name: 'Phone' };
const laptop = { kind: 'device' as const, id: 'd2', name: 'Laptop' };

describe('PermissionBroker', () => {
  let db: Db;
  let broker: PermissionBroker;
  let settings: SettingsStore;
  let events: EventStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    const bus = new HubBus();
    settings = new SettingsStore(db);
    events = new EventStore(db, bus);
    broker = new PermissionBroker(db, bus, events, settings);
  });
  afterEach(() => db.close());

  const ask = (extra: Partial<Parameters<PermissionBroker['request']>[0]> = {}) =>
    broker.request({
      sessionId: 's1',
      agentId: 'copilot',
      type: 'tool',
      title: 'Run tests',
      toolKind: 'execute',
      content: [],
      options: OPTIONS,
      ...extra,
    });

  it('lets the first device answer and rejects later answers with 409', async () => {
    const answer = ask();
    const [pending] = broker.list({ status: 'pending' });
    expect(broker.pendingCount('s1')).toBe(1);

    const resolved = broker.respond(pending.id, { optionId: 'allow' }, phone);
    expect(resolved).toMatchObject({ status: 'approved', resolvedBy: { name: 'Phone' } });
    await expect(answer).resolves.toEqual({ outcome: 'selected', optionId: 'allow' });

    expect(() => broker.respond(pending.id, { optionId: 'reject' }, laptop)).toThrowError(
      expect.objectContaining({ statusCode: 409 }),
    );
    expect(broker.pendingCount()).toBe(0);
    const kinds = events.list('s1').map((e) => e.kind);
    expect(kinds).toEqual(['permission_request', 'permission_resolved']);
  });

  it('auto-approves only tool kinds covered by the policy', async () => {
    await expect(ask({ toolKind: 'read', autoApprove: 'read' })).resolves.toEqual({ outcome: 'selected', optionId: 'allow' });
    expect(broker.pendingCount()).toBe(0);

    void ask({ toolKind: 'execute', autoApprove: 'edits' });
    expect(broker.pendingCount()).toBe(1);

    expect(autoApproveCovers('edits', 'edit')).toBe(true);
    expect(autoApproveCovers('read', 'edit')).toBe(false);
    expect(autoApproveCovers('all', 'execute')).toBe(true);
    expect(autoApproveCovers('none', 'read')).toBe(false);
  });

  it('never auto-approves delegations', () => {
    void ask({ type: 'delegation', autoApprove: 'all' });
    expect(broker.pendingCount()).toBe(1);
  });

  it('cancels pending requests when the session stops', async () => {
    const answer = ask();
    broker.cancelForSession('s1');
    await expect(answer).resolves.toEqual({ outcome: 'cancelled' });
    expect(broker.list({ sessionId: 's1' })[0].status).toBe('cancelled');
  });

  it('expires requests after the configured timeout by choosing the reject option', async () => {
    settings.patch({ permissions: { timeoutSec: 1 } });
    const started = Date.now();
    await expect(ask()).resolves.toEqual({ outcome: 'selected', optionId: 'reject' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(broker.list({ sessionId: 's1' })[0].status).toBe('expired');
  });

  it('withdraws the request when the agent aborts it', async () => {
    const controller = new AbortController();
    const answer = ask({ signal: controller.signal });
    controller.abort();
    await expect(answer).resolves.toEqual({ outcome: 'cancelled' });
  });
});
