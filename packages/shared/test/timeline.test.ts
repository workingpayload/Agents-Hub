import { describe, expect, it } from 'vitest';
import { buildTimeline, collectAgentText, type SessionEvent, type SessionEventPayload } from '../src/index.js';

let seq = 0;
const ev = (payload: SessionEventPayload): SessionEvent => ({ ...payload, sessionId: 's', seq: ++seq, ts: seq } as SessionEvent);

describe('buildTimeline', () => {
  it('merges streamed chunks, applies tool updates in place and pairs permission resolutions', () => {
    seq = 0;
    const events = [
      ev({ kind: 'user_message', text: 'hi', from: { kind: 'device', name: 'Phone' } }),
      ev({ kind: 'agent_message_chunk', text: 'Hel' }),
      ev({ kind: 'agent_message_chunk', text: 'lo' }),
      ev({ kind: 'tool_call', toolCallId: 't1', title: 'Run ls', toolKind: 'execute', status: 'pending', content: [], locations: [] }),
      ev({ kind: 'permission_request', requestId: 'p1', title: 'Run ls' }),
      ev({ kind: 'permission_resolved', requestId: 'p1', outcome: 'selected', optionId: 'a', optionName: 'Allow', by: { kind: 'device', name: 'Phone' } }),
      ev({ kind: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'text', text: 'file.txt' }] }),
      ev({ kind: 'agent_message_chunk', text: 'Done' }),
      ev({ kind: 'turn_end', stopReason: 'end_turn' }),
    ];
    const items = buildTimeline(events);
    expect(items.map((i) => i.type)).toEqual(['user', 'agent', 'tool', 'permission', 'agent', 'turn_end']);
    expect(items[1]).toMatchObject({ type: 'agent', text: 'Hello' });
    expect(items[2]).toMatchObject({ type: 'tool', status: 'completed', title: 'Run ls', content: [{ type: 'text', text: 'file.txt' }] });
    expect(items[3]).toMatchObject({ type: 'permission', resolved: { optionName: 'Allow' } });
    expect(collectAgentText(events, 1)).toBe('HelloDone');
  });

  it('keeps one plan per turn and upserts delegations by task id', () => {
    seq = 0;
    const items = buildTimeline([
      ev({ kind: 'plan', entries: [{ content: 'a', status: 'pending' }] }),
      ev({ kind: 'delegation', taskId: 'x', agentId: 'claude', prompt: 'p', status: 'pending_approval' }),
      ev({ kind: 'plan', entries: [{ content: 'a', status: 'completed' }] }),
      ev({ kind: 'delegation', taskId: 'x', agentId: 'claude', prompt: 'p', status: 'completed', childSessionId: 'c' }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: 'plan', entries: [{ status: 'completed' }] });
    expect(items[1]).toMatchObject({ type: 'delegation', status: 'completed', childSessionId: 'c' });
  });
});
