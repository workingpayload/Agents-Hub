import {
  ArchiveIcon,
  ArrowClockwiseIcon,
  ArrowElbowDownRightIcon,
  BellIcon,
  CaretRightIcon,
  ChatCircleIcon,
  LightningIcon,
  PlusIcon,
  RobotIcon,
  TerminalWindowIcon,
} from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AgentInfo, SessionInfo } from '@agent-hub/shared/client';
import { isSessionActive } from '@agent-hub/shared/client';
import { NewSessionDialog } from '../components/NewSessionDialog';
import { PermissionCard } from '../components/PermissionCard';
import { AgentAvatar, Button, Card, Dots, EmptyState, Loading, Pill, Reveal, SectionTitle, Skeleton, StatusBadge } from '../components/ui';
import { post } from '../lib/api';
import { agentName, basename, timeAgo } from '../lib/format';
import { toastError, useHub } from '../lib/store';

function Capability({ ok, title, icon, children }: { ok: boolean; title?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Pill className={ok ? 'text-emerald-300' : 'text-neutral-400'}>
      <span title={title} className="inline-flex items-center gap-1">
        {icon}
        {children}
      </span>
    </Pill>
  );
}

function AgentCard({ agent, onNew }: { agent: AgentInfo; onNew(): void }) {
  const ready = agent.enabled && (agent.structured.available || agent.terminal.available);
  return (
    <Card className="flex flex-col gap-4 p-4 transition-[background-color] duration-300 hover:bg-surface-2">
      <div className="flex items-start gap-3">
        <AgentAvatar agentId={agent.id} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="title-3 truncate text-white">{agent.name}</p>
          <p className="caption-4 truncate text-neutral-400">{agent.version ?? (agent.installed ? 'Installed' : 'Not installed')}</p>
        </div>
        {agent.activeSessions > 0 && <Pill className="text-blue-300">{agent.activeSessions} active</Pill>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Capability ok={agent.structured.available} title={agent.structured.reason} icon={<ChatCircleIcon className="h-3 w-3" />}>
          Chat
        </Capability>
        <Capability ok={agent.terminal.available} title={agent.terminal.reason} icon={<TerminalWindowIcon className="h-3 w-3" />}>
          Terminal
        </Capability>
        {!agent.enabled && <Pill className="text-amber-300">Disabled</Pill>}
      </div>
      {!ready && agent.structured.reason && <p className="caption-4 text-neutral-400">{agent.structured.reason}</p>}
      <Button variant={ready ? 'primary' : 'secondary'} disabled={!ready} onClick={onNew} className="mt-auto w-full">
        <PlusIcon className="h-4 w-4" /> New session
      </Button>
    </Card>
  );
}

function SessionRow({ session, depth = 0 }: { session: SessionInfo; depth?: number }) {
  const agents = useHub((s) => s.agents);
  return (
    <Link
      to={`/sessions/${session.id}`}
      className="group flex min-h-14 items-center gap-3 rounded-xl py-2 pr-3 transition-[background-color] duration-300 hover:bg-surface-3"
      style={{ paddingLeft: `${12 + depth * 24}px` }}
    >
      {depth > 0 && <ArrowElbowDownRightIcon className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />}
      <AgentAvatar agentId={session.agentId} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="title-4 truncate text-white">{session.title}</p>
        <p className="caption-4 truncate text-neutral-400">
          {agentName(agents, session.agentId)} · {session.mode === 'terminal' ? 'terminal · ' : ''}
          {basename(session.cwd)}
          {session.workspace.type === 'worktree' ? ` · ${session.workspace.branch}` : ''} · {timeAgo(session.updatedAt)}
        </p>
      </div>
      <StatusBadge status={session.status} />
      <CaretRightIcon
        className="hidden h-4 w-4 text-neutral-400 transition-transform duration-300 ease-base group-hover:translate-x-0.5 sm:block"
        aria-hidden
      />
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
  return <div className="space-y-1 p-2">{(byParent.get(undefined) ?? []).flatMap((s) => render(s, 0))}</div>;
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="surface-inset flex h-full flex-col gap-2 rounded-xl p-3 sm:flex-row sm:items-center sm:gap-3">
      <span className={clsx('flex h-8 w-8 items-center justify-center rounded-lg bg-surface-3', tone)}>{icon}</span>
      <div className="min-w-0">
        <p className="heading-6 font-mono tabular-nums text-white">{value}</p>
        <p className="caption-4 text-neutral-300">{label}</p>
      </div>
    </div>
  );
}

function AgentSkeletons() {
  return (
    <Loading label="Detecting agents" className="contents">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="surface space-y-4 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-5 w-1/2 rounded-full" />
          <Skeleton className="h-9 w-full rounded-xl" />
        </div>
      ))}
    </Loading>
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
    <div className="space-y-12 pt-8">
      <section className="animate-rise space-y-8" aria-labelledby="dash-title">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <p className="caption-3 uppercase tracking-wide text-neutral-400">{server?.hostname ?? 'Agent Hub'}</p>
            <h1 id="dash-title" className="hero-heading heading-3 sm:heading-2">
              Your agents, in one place
            </h1>
            <p className="body-5 max-w-xl text-neutral-300">
              Start a session, approve actions from any paired device, and let agents hand work to each other.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={refresh} disabled={refreshing} aria-label="Detect agents again" title="Detect agents again">
              {refreshing ? <Dots label="Detecting agents" /> : <ArrowClockwiseIcon className="h-5 w-5" />}
            </Button>
            <Button variant="primary" size="lg" onClick={() => setDialog({ open: true })}>
              <PlusIcon className="h-5 w-5" /> New session
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={<LightningIcon className="h-4 w-4" />} label="Active" value={active.length} tone="text-blue-300" />
          <Link to="/approvals" className="rounded-xl transition-transform duration-300 ease-base active:scale-[0.98]" aria-label={`${pending.length} waiting for approval`}>
            <Stat icon={<BellIcon className="h-4 w-4" />} label="Need approval" value={pending.length} tone={pending.length ? 'text-amber-300' : 'text-neutral-300'} />
          </Link>
          <Stat icon={<RobotIcon className="h-4 w-4" />} label="Agents ready" value={readyAgents} tone="text-emerald-300" />
        </div>
      </section>

      {pending.length > 0 && (
        <Reveal as="section" className="space-y-4" aria-labelledby="dash-pending">
          <SectionTitle
            id="dash-pending"
            action={
              pending.length > 2 && (
                <Link to="/approvals" className="link button-sm">
                  View all
                </Link>
              )
            }
          >
            Needs your approval ({pending.length})
          </SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            {pending.slice(0, 2).map((p) => (
              <PermissionCard key={p.id} request={p} showSession />
            ))}
          </div>
        </Reveal>
      )}

      <Reveal as="section" className="space-y-4" aria-labelledby="dash-agents">
        <SectionTitle id="dash-agents">Agents</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} onNew={() => setDialog({ open: true, agentId: a.id })} />
          ))}
          {agents.length === 0 && <AgentSkeletons />}
        </div>
      </Reveal>

      <Reveal as="section" className="space-y-4" aria-labelledby="dash-active">
        <SectionTitle id="dash-active">Active sessions</SectionTitle>
        {active.length === 0 ? (
          <EmptyState
            icon={<RobotIcon className="h-6 w-6" />}
            title="No agents are running"
            action={
              <Button variant="primary" onClick={() => setDialog({ open: true })}>
                <PlusIcon className="h-4 w-4" /> Start a session
              </Button>
            }
          >
            Give an agent a task, then approve its actions from any paired device.
          </EmptyState>
        ) : (
          <Card>
            <SessionTree sessions={active} />
          </Card>
        )}
      </Reveal>

      {recent.length > 0 && (
        <Reveal as="section" className="space-y-4" aria-labelledby="dash-recent">
          <SectionTitle
            id="dash-recent"
            action={
              <Button size="sm" variant="ghost" onClick={() => setShowArchived(!showArchived)}>
                <ArchiveIcon className="h-4 w-4" /> {showArchived ? 'Hide archived' : 'Show archived'}
              </Button>
            }
          >
            Recent
          </SectionTitle>
          <Card>
            <SessionTree sessions={recent} />
          </Card>
        </Reveal>
      )}

      <NewSessionDialog open={dialog.open} agentId={dialog.agentId} onClose={() => setDialog({ open: false })} />
    </div>
  );
}
