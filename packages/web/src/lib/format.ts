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

export const AGENT_STYLE: Record<string, { color: string; short: string; glow: string }> = {
  copilot: { color: 'from-violet-400 to-fuchsia-600', short: 'GH', glow: 'rgb(168 85 247 / 0.35)' },
  claude: { color: 'from-amber-300 to-orange-600', short: 'Cl', glow: 'rgb(249 115 22 / 0.32)' },
  codex: { color: 'from-emerald-300 to-teal-600', short: 'Cx', glow: 'rgb(16 185 129 / 0.3)' },
  gemini: { color: 'from-sky-300 to-blue-600', short: 'Ge', glow: 'rgb(59 130 246 / 0.34)' },
  echo: { color: 'from-slate-300 to-slate-600', short: 'Ec', glow: 'rgb(148 163 184 / 0.25)' },
};

export function agentName(agents: AgentInfo[], id: string): string {
  return agents.find((a) => a.id === id)?.name ?? id;
}

export const STATUS_STYLE: Record<SessionStatus, { label: string; cls: string }> = {
  starting: { label: 'Starting', cls: 'bg-sky-400/10 text-sky-200 ring-sky-300/25' },
  idle: { label: 'Ready', cls: 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/25' },
  running: { label: 'Working', cls: 'bg-blue-400/12 text-blue-100 ring-blue-300/30' },
  awaiting_permission: { label: 'Needs approval', cls: 'bg-amber-400/12 text-amber-100 ring-amber-300/35' },
  stopped: { label: 'Stopped', cls: 'bg-white/[0.06] text-slate-300 ring-white/12' },
  error: { label: 'Error', cls: 'bg-red-400/12 text-red-200 ring-red-300/30' },
};

export const TASK_STYLE: Record<TaskStatus, { label: string; cls: string }> = {
  pending_approval: { label: 'Awaiting approval', cls: 'bg-amber-400/12 text-amber-100 ring-amber-300/35' },
  running: { label: 'Running', cls: 'bg-blue-400/12 text-blue-100 ring-blue-300/30' },
  completed: { label: 'Completed', cls: 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/25' },
  failed: { label: 'Failed', cls: 'bg-red-400/12 text-red-200 ring-red-300/30' },
  denied: { label: 'Denied', cls: 'bg-white/[0.06] text-slate-300 ring-white/12' },
  cancelled: { label: 'Cancelled', cls: 'bg-white/[0.06] text-slate-300 ring-white/12' },
  timeout: { label: 'Timed out', cls: 'bg-red-400/12 text-red-200 ring-red-300/30' },
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
