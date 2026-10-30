import { EventEmitter } from 'node:events';
import type {
  AgentInfo,
  NotifyPayload,
  PermissionRequest,
  SessionEvent,
  SessionInfo,
  TaskInfo,
} from '@agent-hub/shared';

export interface TurnEndInfo {
  sessionId: string;
  stopReason: string;
  /** Last event sequence number before the turn started; agent output is everything after it. */
  startSeq: number;
  error?: string;
}

export interface BusEvents {
  event: [SessionEvent];
  session: [SessionInfo];
  session_removed: [string];
  permission: [PermissionRequest];
  task: [TaskInfo];
  agents: [AgentInfo[]];
  pty_output: [string, string];
  notify: [NotifyPayload];
  turn_end: [TurnEndInfo];
  device_revoked: [string];
}

/** In-process pub/sub connecting services with the WebSocket gateway and notifier. */
export class HubBus extends EventEmitter<BusEvents> {
  constructor() {
    super();
    this.setMaxListeners(200);
  }
}
