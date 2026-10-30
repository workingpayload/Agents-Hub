import { clsx } from 'clsx';
import { Activity, Archive, Bell, Bot, ChevronRight, CornerDownRight, Plus, RefreshCw, TerminalSquare } from 'lucide-react';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AgentInfo, SessionInfo } from '@agent-hub/shared/client';
import { isSessionActive } from '@agent-hub/shared/client';
import { NewSessionDialog } from '../components/NewSessionDialog';
import { PermissionCard } from '../components/PermissionCard';
import { AgentAvatar, Button, Card, EmptyState, StatusBadge } from '../components/ui';
import { post } from '../lib/api';
import { AGENT_STYLE, agentName, basename, timeAgo } from '../lib/format';
import { toastError, useHub } from '../lib/store';

function Capability({ ok, title, icon, children }: { ok: boolean; title?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        ok ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/20' : 'bg-white/[0.04] text-slate-400 ring-white/10',
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function AgentCard({ agent, onNew }: { agent: AgentInfo; onNew(): void }) {
  const ready = agent.enabled && (agent.structured.available || agent.terminal.available);
  const glow = AGENT_STYLE[agent.id]?.glow ?? 'rgb(148 163 184 / 0.2)';
  return (
    <Card className="group flex flex-col gap-4 overflow-hidden p-4 transition-[box-shadow] duration-300 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.2),0_24px_48px_-24px_rgb(0_0_0/0.9)]">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-10 -top-14 -z-10 h-40 w-40 rounded-full opacity-80 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(closest-side, ${glow}, transparent)` }}
      />
      <div className="flex items-start gap-3">
        <AgentAvatar agentId={agent.id} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-semibold">{agent.name}</p>
          <p className="truncate text-xs text-slate-400">{agent.version ?? (agent.installed ? 'installed' : 'not installed')}</p>
        </div>
        {agent.activeSessions > 0 && (
          <span className="rounded-full bg-blue-400/15 px-2 py-0.5 text-xs font-medium text-blue-100 ring-1 ring-inset ring-blue-300/25">
            {agent.activeSessions} active
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Capability ok={agent.structured.available} title={agent.structured.reason} icon={<Bot className="h-3 w-3" />}>
          Chat
        </Capability>
        <Capability ok={agent.terminal.available} title={agent.terminal.reason} icon={<TerminalSquare className="h-3 w-3" />}>
          Terminal
        </Capability>
        {!agent.enabled && (
          <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-100 ring-1 ring-inset ring-amber-300/30">disabled</span>
        )}
      </div>
      {!ready && agent.structured.reason && <p className="text-xs text-slate-400">{agent.structured.reason}</p>}
      <Button variant={ready ? 'primary' : 'secondary'} disabled={!ready} onClick={onNew} className="mt-auto w-full">
        <Plus className="h-4 w-4" /> New session
      </Button>
    </Card>
  );
}

function SessionRow({ session, depth = 0 }: { session: SessionInfo; depth?: number }) {
  const agents = useHub((s) => s.agents);
  return (
    <Link
      to={`/sessions/${session.id}`}
      className="group flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.06]"
      style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
    >
      {depth > 0 && <CornerDownRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
      <AgentAvatar agentId={session.agentId} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-100">{session.title}</p>
        <p className="truncate text-xs text-slate-400">
          {agentName(agents, session.agentId)} · {session.mode === 'terminal' ? 'terminal · ' : ''}
          {basename(session.cwd)}
          {session.workspace.type === 'worktree' ? ` · ${session.workspace.branch}` : ''} · {timeAgo(session.updatedAt)}
        </p>
      </div>
      <StatusBadge status={session.status} />
      <ChevronRight className="hidden h-4 w-4 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5 sm:block" aria-hidden />
    </Link>
  );
}

function SessionTree({ sessions }: { sessions: SessionInfo[] }) {
  const byParent = useMemo(() => {
    const m = new Map<string | undefined, SessionInfo[]>();
    const ids = new Set(sessions.map((s) => s.id));
    for (const s of sessions) {
      const key = s.parentSessionId && ids.has(s.parentSessionId) ? s.parentSessionId : undefined;
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return m;
  }, [sessions]);
  const render = (s: SessionInfo, depth: number): ReactElement[] => [
    <SessionRow key={s.id} session={s} depth={depth} />,
    ...(byParent.get(s.id) ?? []).flatMap((c) => render(c, depth + 1)),
  ];
  return <div className="space-y-0.5 p-1.5">{(byParent.get(undefined) ?? []).flatMap((s) => render(s, 0))}</div>;
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="glass-inset flex h-full flex-col gap-2 rounded-2xl px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3 sm:px-3.5">
      <span className={clsx('flex h-8 w-8 items-center justify-center rounded-xl ring-1 ring-inset sm:h-9 sm:w-9', tone)}>{icon}</span>
      <div className="min-w-0">
        <p className="font-display text-xl font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-1 text-[11px] leading-tight text-slate-300 sm:text-xs">{label}</p>
      </div>
    </div>
  );
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function Dashboard() {
  const agents = useHub((s) => s.agents);
  const sessionsMap = useHub((s) => s.sessions);
  const permissions = useHub((s) => s.permissions);
  const server = useHub((s) => s.server);
  const [dialog, setDialog] = useState<{ open: boolean; agentId?: string }>({ open: false });
  const [showArchived, setShowArchived] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const sessions = Object.values(sessionsMap).sort((a, b) => b.updatedAt - a.updatedAt);
  const active = sessions.filter((s) => isSessionActive(s.status) && !s.archived);
  const recent = sessions.filter((s) => !isSessionActive(s.status) && (showArchived || !s.archived)).slice(0, 50);
  const pending = Object.values(permissions).sort((a, b) => a.createdAt - b.createdAt);
  const readyAgents = agents.filter((a) => a.enabled && (a.structured.available || a.terminal.available)).length;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await post('/api/agents/refresh');
    } catch (err) {
      toastError(err);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <Card rim className="overflow-hidden p-5 sm:p-6">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 -z-10 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgb(99_102_241/0.35),transparent)] blur-2xl"
        />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-200/80">{server?.hostname ?? 'Agent Hub'}</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your agents, in one place</h1>
            <p className="max-w-xl text-sm text-slate-300">
              Start a session, approve actions from any paired device, and let agents hand work to each other.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={refresh} disabled={refreshing} aria-label="Re-detect installed agents" title="Re-detect installed agents">
              <RefreshCw className={clsx('h-4 w-4', refreshing && 'animate-spin')} />
            </Button>
            <Button variant="primary" size="lg" onClick={() => setDialog({ open: true })}>
              <Plus className="h-5 w-5" /> New session
            </Button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Stat icon={<Activity className="h-4 w-4" />} label="Active" value={active.length} tone="bg-blue-400/15 text-blue-100 ring-blue-300/25" />
          <Link to="/approvals" className="rounded-2xl" aria-label={`${pending.length} waiting for approval`}>
            <Stat
              icon={<Bell className="h-4 w-4" />}
              label="Need approval"
              value={pending.length}
              tone={pending.length ? 'bg-amber-400/15 text-amber-100 ring-amber-300/30' : 'bg-white/[0.06] text-slate-300 ring-white/10'}
            />
          </Link>
          <Stat icon={<Bot className="h-4 w-4" />} label="Agents ready" value={readyAgents} tone="bg-emerald-400/15 text-emerald-100 ring-emerald-300/25" />
        </div>
      </Card>

      {pending.length > 0 && (
        <section className="space-y-3">
          <SectionTitle
            action={
              pending.length > 2 && (
                <Link to="/approvals" className="text-sm font-medium text-blue-200 hover:text-white">
                  View all
                </Link>
              )
            }
          >
            <span className="text-amber-100">Needs your approval ({pending.length})</span>
          </SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            {pending.slice(0, 2).map((p) => (
              <PermissionCard key={p.id} request={p} showSession />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>Agents</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} onNew={() => setDialog({ open: true, agentId: a.id })} />
          ))}
          {agents.length === 0 && <p className="text-sm text-slate-400">Detecting agents…</p>}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Active sessions</SectionTitle>
        {active.length === 0 ? (
          <EmptyState icon={<Bot className="h-7 w-7" />} title="No agents are running">
            Start a session to give an agent a task. You can approve its actions from any paired device.
          </EmptyState>
        ) : (
          <Card>
            <SessionTree sessions={active} />
          </Card>
        )}
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <SectionTitle
            action={
              <Button size="sm" variant="ghost" onClick={() => setShowArchived(!showArchived)}>
                <Archive className="h-4 w-4" /> {showArchived ? 'Hide archived' : 'Show archived'}
              </Button>
            }
          >
            Recent
          </SectionTitle>
          <Card>
            <SessionTree sessions={recent} />
          </Card>
        </section>
      )}

      <NewSessionDialog open={dialog.open} agentId={dialog.agentId} onClose={() => setDialog({ open: false })} />
    </div>
  );
}
