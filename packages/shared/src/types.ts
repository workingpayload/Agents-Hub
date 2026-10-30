// Domain types shared by the hub daemon, the web UI and the desktop shell.

export type SessionMode = 'structured' | 'terminal';
/** Which tool kinds are approved automatically without asking a human. */
export type AutoApprove = 'none' | 'read' | 'edits' | 'all';
/** What happens when an agent tries to delegate work to another agent. */
export type DelegationPolicy = 'ask' | 'auto' | 'deny';
export type IsolationMode = 'shared' | 'worktree';

export interface AgentModeOption {
  id: string;
  name: string;
  description?: string | null;
}

/** A select-style session setting exposed by the agent (e.g. Claude's model or permission mode). */
export interface SessionConfigOptionInfo {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  currentValue: string;
  options: { value: string; name: string; description?: string | null }[];
}

export interface QueuedPrompt {
  id: string;
  text: string;
  from: Actor;
}

export interface AgentCapabilityStatus {
  available: boolean;
  reason?: string;
  command?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version?: string;
  structured: AgentCapabilityStatus;
  terminal: AgentCapabilityStatus;
  enabled: boolean;
  defaultMode: SessionMode;
  autoApprove: AutoApprove;
  activeSessions: number;
  test?: boolean;
}

export type SessionStatus = 'starting' | 'idle' | 'running' | 'awaiting_permission' | 'stopped' | 'error';

export interface WorkspaceInfo {
  type: IsolationMode;
  baseCwd: string;
  worktreePath?: string;
  branch?: string;
}

export interface SessionInfo {
  id: string;
  agentId: string;
  title: string;
  mode: SessionMode;
  cwd: string;
  workspace: WorkspaceInfo;
  status: SessionStatus;
  statusMessage?: string;
  parentSessionId?: string;
  taskId?: string;
  depth: number;
  delegationPolicy: DelegationPolicy;
  autoApprove: AutoApprove;
  availableModes: AgentModeOption[];
  currentModeId?: string;
  availableModels: AgentModeOption[];
  currentModelId?: string;
  configOptions: SessionConfigOptionInfo[];
  queue: QueuedPrompt[];
  lastSeq: number;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  archived?: boolean;
}

export type ToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: 'terminal'; terminalId: string };

export interface ToolLocation {
  path: string;
  line?: number | null;
}

export interface PlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'high' | 'medium' | 'low';
}

/** Who performed an action (answered a permission, sent a prompt, ...). */
export interface Actor {
  kind: 'device' | 'agent' | 'system' | 'policy';
  id?: string;
  name: string;
}

export type TaskStatus =
  | 'pending_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'denied'
  | 'cancelled'
  | 'timeout';

export type SessionEventPayload =
  | { kind: 'user_message'; text: string; from: Actor }
  | { kind: 'agent_message_chunk'; text: string }
  | { kind: 'agent_thought_chunk'; text: string }
  | {
      kind: 'tool_call';
      toolCallId: string;
      title: string;
      toolKind: ToolKind;
      status: ToolStatus;
      content: ToolContent[];
      locations: ToolLocation[];
      rawInput?: unknown;
    }
  | {
      kind: 'tool_call_update';
      toolCallId: string;
      title?: string;
      toolKind?: ToolKind;
      status?: ToolStatus;
      content?: ToolContent[];
      locations?: ToolLocation[];
      rawOutput?: unknown;
    }
  | { kind: 'plan'; entries: PlanEntry[] }
  | { kind: 'permission_request'; requestId: string; title: string }
  | {
      kind: 'permission_resolved';
      requestId: string;
      outcome: 'selected' | 'cancelled';
      optionId?: string;
      optionName?: string;
      by: Actor;
    }
  | { kind: 'status'; status: SessionStatus; message?: string }
  | { kind: 'turn_end'; stopReason: string }
  | { kind: 'mode_changed'; modeId: string }
  | { kind: 'delegation'; taskId: string; childSessionId?: string; agentId: string; prompt: string; status: TaskStatus }
  | { kind: 'system'; level: 'info' | 'warn' | 'error'; text: string };

export type SessionEventKind = SessionEventPayload['kind'];

export type SessionEvent = SessionEventPayload & {
  sessionId: string;
  seq: number;
  ts: number;
};

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

export type PermissionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

export interface PermissionRequest {
  id: string;
  sessionId: string;
  agentId: string;
  type: 'tool' | 'delegation';
  title: string;
  toolKind?: ToolKind;
  detail?: string;
  content: ToolContent[];
  rawInput?: unknown;
  options: PermissionOption[];
  status: PermissionStatus;
  selectedOptionId?: string;
  resolvedBy?: Actor;
  resolvedAt?: number;
  createdAt: number;
}

export interface TaskInfo {
  id: string;
  parentSessionId: string;
  childSessionId?: string;
  agentId: string;
  prompt: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  depth: number;
  createdAt: number;
  updatedAt: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
  isLocal: boolean;
  createdAt: number;
  lastSeenAt?: number;
  pushEnabled: boolean;
  current?: boolean;
}

export interface AgentSettings {
  enabled: boolean;
  defaultMode: SessionMode;
  autoApprove: AutoApprove;
  /** Override for the structured (ACP) launch command. */
  command?: string;
  args?: string[];
  /** Override for the interactive terminal launch command. */
  terminalCommand?: string;
  terminalArgs?: string[];
  env?: Record<string, string>;
}

export interface OrchestrationSettings {
  maxDepth: number;
  maxConcurrentSessions: number;
  taskTimeoutSec: number;
  defaultDelegationPolicy: DelegationPolicy;
  loopDetection: boolean;
}

export interface NotificationSettings {
  permission: boolean;
  turnEnd: boolean;
  task: boolean;
  error: boolean;
}

export interface HubSettings {
  defaultCwd: string;
  orchestration: OrchestrationSettings;
  permissions: { timeoutSec: number };
  notifications: NotificationSettings;
  agents: Record<string, AgentSettings>;
}

export interface ServerInfo {
  version: string;
  hostname: string;
  lanUrls: string[];
  localUrl: string;
  caFingerprint: string;
  vapidPublicKey: string;
  device: DeviceInfo;
}

export interface PairingTicket {
  code: string;
  pin: string;
  expiresAt: number;
  links: { url: string; qrDataUrl: string }[];
}

export interface PublicInfo {
  name: string;
  version: string;
  hostname: string;
  caFingerprint: string;
  pairingActive: boolean;
}

export interface DirectoryListing {
  path: string;
  parent?: string;
  entries: { name: string; path: string; isGitRepo?: boolean }[];
  roots: string[];
}

export interface WorkspaceDiff {
  cwd: string;
  isGitRepo: boolean;
  branch?: string;
  diff: string;
  untracked: string[];
  truncated: boolean;
}

export interface NetworkDiagnostics {
  platform: string;
  port: number;
  networks: { name: string; interface: string; category: string }[];
  firewall: {
    checked: boolean;
    /** true = every active network allows inbound connections to the hub; null = unknown. */
    allowed: boolean | null;
    profiles?: string[];
    blockedNetworks?: string[];
    error?: string;
  };
  fixCommand?: string;
}

export interface NotifyPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  kind: 'permission' | 'turn_end' | 'task' | 'error' | 'info';
}

export type ServerMessage =
  | { type: 'hello'; server: ServerInfo }
  | { type: 'auth_error'; message: string }
  | { type: 'event'; event: SessionEvent }
  | { type: 'replay_done'; sessionId: string; lastSeq: number }
  | { type: 'session'; session: SessionInfo }
  | { type: 'session_removed'; sessionId: string }
  | { type: 'permission'; permission: PermissionRequest }
  | { type: 'task'; task: TaskInfo }
  | { type: 'agents'; agents: AgentInfo[] }
  | { type: 'pty_output'; sessionId: string; data: string }
  | { type: 'pty_snapshot'; sessionId: string; data: string }
  /** Authoritative terminal size; every viewer renders at exactly this size. `mine` = this connection sets it. */
  | {
      type: 'pty_size';
      sessionId: string;
      cols: number;
      rows: number;
      driverDeviceId?: string;
      driverName?: string;
      mine?: boolean;
    }
  | { type: 'notify'; notification: NotifyPayload }
  | { type: 'pong' };

export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'subscribe'; sessionId: string; sinceSeq: number }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'pty_input'; sessionId: string; data: string }
  /** The viewer's preferred size. With `claim`, this viewer takes control of the terminal size. */
  | { type: 'pty_resize'; sessionId: string; cols: number; rows: number; claim?: boolean }
  | { type: 'ping' };

export interface AuditEntry {
  id: number;
  ts: number;
  actor: string;
  action: string;
  detail: string;
}

export const ACTIVE_SESSION_STATUSES: SessionStatus[] = ['starting', 'idle', 'running', 'awaiting_permission'];

export function isSessionActive(status: SessionStatus): boolean {
  return ACTIVE_SESSION_STATUSES.includes(status);
}

export const TERMINAL_TASK_STATUSES: TaskStatus[] = ['completed', 'failed', 'denied', 'cancelled', 'timeout'];

export function isTaskFinished(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}
