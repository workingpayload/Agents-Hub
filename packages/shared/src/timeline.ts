import type {
  Actor,
  PlanEntry,
  SessionEvent,
  TaskStatus,
  ToolContent,
  ToolKind,
  ToolLocation,
  ToolStatus,
} from './types.js';

export type TimelineItem =
  | { type: 'user'; id: string; text: string; from: Actor; ts: number }
  | { type: 'agent'; id: string; text: string; ts: number }
  | { type: 'thought'; id: string; text: string; ts: number }
  | {
      type: 'tool';
      id: string;
      title: string;
      toolKind: ToolKind;
      status: ToolStatus;
      content: ToolContent[];
      locations: ToolLocation[];
      rawInput?: unknown;
      rawOutput?: unknown;
      ts: number;
    }
  | { type: 'plan'; id: string; entries: PlanEntry[]; ts: number }
  | {
      type: 'permission';
      id: string;
      title: string;
      ts: number;
      resolved?: { outcome: 'selected' | 'cancelled'; optionName?: string; optionId?: string; by: Actor };
    }
  | {
      type: 'delegation';
      id: string;
      agentId: string;
      prompt: string;
      status: TaskStatus;
      childSessionId?: string;
      ts: number;
    }
  | { type: 'system'; id: string; level: 'info' | 'warn' | 'error'; text: string; ts: number }
  | { type: 'turn_end'; id: string; stopReason: string; ts: number };

/**
 * Folds the raw session event stream into display items: merges streamed chunks,
 * applies tool-call updates in place and pairs permission requests with their resolution.
 */
export function buildTimeline(events: readonly SessionEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const byId = new Map<string, number>();
  let currentPlanIndex = -1;

  const last = () => items[items.length - 1];

  for (const ev of events) {
    switch (ev.kind) {
      case 'user_message':
        items.push({ type: 'user', id: `u${ev.seq}`, text: ev.text, from: ev.from, ts: ev.ts });
        currentPlanIndex = -1;
        break;
      case 'agent_message_chunk': {
        const prev = last();
        if (prev && prev.type === 'agent') {
          items[items.length - 1] = { ...prev, text: prev.text + ev.text };
        } else {
          items.push({ type: 'agent', id: `a${ev.seq}`, text: ev.text, ts: ev.ts });
        }
        break;
      }
      case 'agent_thought_chunk': {
        const prev = last();
        if (prev && prev.type === 'thought') {
          items[items.length - 1] = { ...prev, text: prev.text + ev.text };
        } else {
          items.push({ type: 'thought', id: `t${ev.seq}`, text: ev.text, ts: ev.ts });
        }
        break;
      }
      case 'tool_call': {
        const key = `tool:${ev.toolCallId}`;
        const existing = byId.get(key);
        const item: TimelineItem = {
          type: 'tool',
          id: ev.toolCallId,
          title: ev.title,
          toolKind: ev.toolKind,
          status: ev.status,
          content: ev.content,
          locations: ev.locations,
          rawInput: ev.rawInput,
          ts: ev.ts,
        };
        if (existing !== undefined) {
          items[existing] = item;
        } else {
          byId.set(key, items.length);
          items.push(item);
        }
        break;
      }
      case 'tool_call_update': {
        const key = `tool:${ev.toolCallId}`;
        const idx = byId.get(key);
        if (idx === undefined) {
          byId.set(key, items.length);
          items.push({
            type: 'tool',
            id: ev.toolCallId,
            title: ev.title ?? 'Tool call',
            toolKind: ev.toolKind ?? 'other',
            status: ev.status ?? 'in_progress',
            content: ev.content ?? [],
            locations: ev.locations ?? [],
            rawOutput: ev.rawOutput,
            ts: ev.ts,
          });
        } else {
          const prev = items[idx];
          if (prev.type === 'tool') {
            items[idx] = {
              ...prev,
              title: ev.title ?? prev.title,
              toolKind: ev.toolKind ?? prev.toolKind,
              status: ev.status ?? prev.status,
              content: ev.content ?? prev.content,
              locations: ev.locations ?? prev.locations,
              rawOutput: ev.rawOutput ?? prev.rawOutput,
            };
          }
        }
        break;
      }
      case 'plan':
        if (currentPlanIndex >= 0) {
          items[currentPlanIndex] = { type: 'plan', id: items[currentPlanIndex].id, entries: ev.entries, ts: ev.ts };
        } else {
          currentPlanIndex = items.length;
          items.push({ type: 'plan', id: `p${ev.seq}`, entries: ev.entries, ts: ev.ts });
        }
        break;
      case 'permission_request': {
        const key = `perm:${ev.requestId}`;
        byId.set(key, items.length);
        items.push({ type: 'permission', id: ev.requestId, title: ev.title, ts: ev.ts });
        break;
      }
      case 'permission_resolved': {
        const idx = byId.get(`perm:${ev.requestId}`);
        if (idx !== undefined) {
          const prev = items[idx];
          if (prev.type === 'permission') {
            items[idx] = {
              ...prev,
              resolved: { outcome: ev.outcome, optionId: ev.optionId, optionName: ev.optionName, by: ev.by },
            };
          }
        }
        break;
      }
      case 'delegation': {
        const key = `task:${ev.taskId}`;
        const idx = byId.get(key);
        const item: TimelineItem = {
          type: 'delegation',
          id: ev.taskId,
          agentId: ev.agentId,
          prompt: ev.prompt,
          status: ev.status,
          childSessionId: ev.childSessionId,
          ts: ev.ts,
        };
        if (idx !== undefined) {
          items[idx] = item;
        } else {
          byId.set(key, items.length);
          items.push(item);
        }
        break;
      }
      case 'system':
        items.push({ type: 'system', id: `s${ev.seq}`, level: ev.level, text: ev.text, ts: ev.ts });
        break;
      case 'mode_changed':
        items.push({ type: 'system', id: `m${ev.seq}`, level: 'info', text: `Mode changed to ${ev.modeId}`, ts: ev.ts });
        break;
      case 'turn_end':
        items.push({ type: 'turn_end', id: `e${ev.seq}`, stopReason: ev.stopReason, ts: ev.ts });
        currentPlanIndex = -1;
        break;
      case 'status':
        if (ev.status === 'error' && ev.message) {
          items.push({ type: 'system', id: `x${ev.seq}`, level: 'error', text: ev.message, ts: ev.ts });
        }
        break;
    }
  }
  return items;
}

/** Concatenates the agent's message text produced after the given sequence number. */
export function collectAgentText(events: readonly SessionEvent[], afterSeq = 0): string {
  let text = '';
  for (const ev of events) {
    if (ev.seq > afterSeq && ev.kind === 'agent_message_chunk') text += ev.text;
  }
  return text.trim();
}
