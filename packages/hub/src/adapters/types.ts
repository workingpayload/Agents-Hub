import type {
  AgentModeOption,
  PermissionOption,
  SessionConfigOptionInfo,
  SessionEventPayload,
  ToolContent,
  ToolKind,
} from '@agent-hub/shared';

export interface PermissionAsk {
  toolCallId?: string;
  title: string;
  toolKind?: ToolKind;
  detail?: string;
  content: ToolContent[];
  rawInput?: unknown;
  options: PermissionOption[];
  /** Aborted when the agent withdraws the request (e.g. the turn was cancelled). */
  signal?: AbortSignal;
}

export type PermissionAnswer = { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };

export interface SessionSettingsInfo {
  availableModes?: AgentModeOption[];
  currentModeId?: string;
  availableModels?: AgentModeOption[];
  currentModelId?: string;
  configOptions?: SessionConfigOptionInfo[];
  title?: string;
}

export interface AdapterCallbacks {
  emit(payload: SessionEventPayload): void;
  requestPermission(ask: PermissionAsk): Promise<PermissionAnswer>;
  updateSettings(info: SessionSettingsInfo): void;
  /** Called once when the underlying agent process goes away. */
  onExit(info: { code: number | null; signal: string | null; expected: boolean; stderrTail: string }): void;
  /** Raw terminal output (terminal mode only). */
  onPtyData?(data: string): void;
}

export interface StartResult {
  acpSessionId?: string;
  resumed?: boolean;
}

export interface AgentAdapter {
  readonly kind: 'structured' | 'terminal';
  start(): Promise<StartResult>;
  /** Runs one prompt turn; resolves with the stop reason when the agent finishes. */
  prompt(text: string): Promise<{ stopReason: string }>;
  cancel(): Promise<void>;
  stop(): Promise<void>;
  setMode?(modeId: string): Promise<void>;
  setModel?(modelId: string): Promise<void>;
  setConfigOption?(configId: string, value: string): Promise<void>;
  write?(data: string): void;
  /** Resizes the terminal (clamped) and returns the size actually applied. */
  resize?(cols: number, rows: number): { cols: number; rows: number } | undefined;
  size?(): { cols: number; rows: number };
  snapshot?(): string;
}
