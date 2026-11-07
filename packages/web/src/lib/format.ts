import type { AgentInfo, SessionStatus, TaskStatus } from '@agent-hub/shared/client';

export function timeAgo(ts: number | undefined): string {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Flat identity colour per agent; every shade keeps white initials above 4.5:1 contrast. */
export const AGENT_STYLE: Record<string, { color: string; short: string }> = {
  copilot: { color: 'bg-violet-600', short: 'GH' },
  claude: { color: 'bg-orange-700', short: 'Cl' },
  codex: { color: 'bg-emerald-700', short: 'Cx' },
  gemini: { color: 'bg-blue-600', short: 'Ge' },
  echo: { color: 'bg-neutral-600', short: 'Ec' },
};

export function agentName(agents: AgentInfo[], id: string): string {
  return agents.find((a) => a.id === id)?.name ?? id;
}

export const STATUS_STYLE: Record<SessionStatus, { label: string; cls: string }> = {
  starting: { label: 'Starting', cls: 'text-sky-300' },
  idle: { label: 'Ready', cls: 'text-emerald-300' },
  running: { label: 'Working', cls: 'text-blue-300' },
  awaiting_permission: { label: 'Needs approval', cls: 'text-amber-300' },
  stopped: { label: 'Stopped', cls: 'text-neutral-300' },
  error: { label: 'Error', cls: 'text-red-300' },
};

export const TASK_STYLE: Record<TaskStatus, { label: string; cls: string }> = {
  pending_approval: { label: 'Awaiting approval', cls: 'text-amber-300' },
  running: { label: 'Running', cls: 'text-blue-300' },
  completed: { label: 'Completed', cls: 'text-emerald-300' },
  failed: { label: 'Failed', cls: 'text-red-300' },
  denied: { label: 'Denied', cls: 'text-neutral-300' },
  cancelled: { label: 'Cancelled', cls: 'text-neutral-300' },
  timeout: { label: 'Timed out', cls: 'text-red-300' },
};

export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows PC'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  return `${os} · ${browser}`;
}

export function isDesktopShell(): boolean {
  return Boolean((window as unknown as { agentHubDesktop?: unknown }).agentHubDesktop);
}

export interface DesktopBridge {
  setBadge(count: number): void;
  flash(): void;
  fixFirewall?(port: number): Promise<boolean>;
}

export function desktopBridge(): DesktopBridge | undefined {
  return (window as unknown as { agentHubDesktop?: DesktopBridge }).agentHubDesktop;
}
