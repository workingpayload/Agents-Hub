import { clsx } from 'clsx';
import {
  ArrowLeft,
  ArrowRightLeft,
  Archive,
  ChevronDown,
  FileDiff,
  GitBranch,
  MoreVertical,
  Pencil,
  Play,
  Power,
  Trash2,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AutoApprove, DelegationPolicy, SessionInfo } from '@agent-hub/shared/client';
import { buildTimeline, collectAgentText, isSessionActive } from '@agent-hub/shared/client';
import { Composer } from '../components/Composer';
import { DiffDialog } from '../components/DiffDialog';
import { HandoffDialog } from '../components/HandoffDialog';
import { TimelineView } from '../components/Timeline';
import { AgentAvatar, Button, Modal, Select, Spinner, StatusBadge, TaskBadge, inputCls } from '../components/ui';
import { del, patch, post } from '../lib/api';
import { agentName, basename } from '../lib/format';
import { toastError, useHub } from '../lib/store';
import { hubSocket } from '../lib/ws';

const EMPTY: never[] = [];
const TerminalView = lazy(() => import('../components/TerminalView').then((m) => ({ default: m.TerminalView })));

function SessionSettings({ session }: { session: SessionInfo }) {
  const live = isSessionActive(session.status) && session.status !== 'starting';
  const configure = (body: Record<string, string>) => post(`/api/sessions/${session.id}/config`, body).catch((e) => toastError(e));
  const update = (body: Record<string, unknown>) => patch(`/api/sessions/${session.id}`, body).catch((e) => toastError(e));
  const configCategories = new Set(session.configOptions.map((c) => c.category ?? ''));
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {session.availableModes.length > 0 && !configCategories.has('mode') && (
        <label className="text-xs text-slate-400">
          Mode
          <Select disabled={!live} value={session.currentModeId ?? ''} onChange={(e) => configure({ modeId: e.target.value })}>
            {session.availableModes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {session.availableModels.length > 0 && !configCategories.has('model') && (
        <label className="text-xs text-slate-400">
          Model
          <Select disabled={!live} value={session.currentModelId ?? ''} onChange={(e) => configure({ modelId: e.target.value })}>
            {!session.currentModelId && <option value="">Default</option>}
            {session.availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {session.configOptions.map((c) => (
        <label key={c.id} className="text-xs text-slate-400">
          {c.name}
          <Select disabled={!live} value={c.currentValue} onChange={(e) => configure({ configId: c.id, value: e.target.value })}>
            {c.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.name}
              </option>
            ))}
          </Select>
        </label>
      ))}
      {session.mode === 'structured' && (
        <label className="text-xs text-slate-400">
          Auto-approve
          <Select value={session.autoApprove} onChange={(e) => update({ autoApprove: e.target.value as AutoApprove })}>
            <option value="none">Nothing (ask me)</option>
            <option value="read">Reads & searches</option>
            <option value="edits">Reads & edits</option>
            <option value="all">Everything</option>
          </Select>
        </label>
      )}
      {session.mode === 'structured' && (
        <label className="text-xs text-slate-400">
          Delegation
          <Select value={session.delegationPolicy} onChange={(e) => update({ delegationPolicy: e.target.value as DelegationPolicy })}>
            <option value="ask">Ask me</option>
            <option value="auto">Allow automatically</option>
            <option value="deny">Not allowed</option>
          </Select>
        </label>
      )}
    </div>
  );
}

export function SessionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const session = useHub((s) => s.sessions[id]);
  const events = useHub((s) => s.events[id] ?? EMPTY);
  const replayed = useHub((s) => s.replayed[id]);
  const agents = useHub((s) => s.agents);
  const tasks = useHub((s) => s.tasks);
  const parent = useHub((s) => (session?.parentSessionId ? s.sessions[session.parentSessionId] : undefined));
  const [showSettings, setShowSettings] = useState(false);
  const [menu, setMenu] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [diff, setDiff] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (!id || session?.mode === 'terminal') return;
    return hubSocket.subscribe(id);
  }, [id, session?.mode]);

  const timeline = useMemo(() => buildTimeline(events), [events]);
  const pendingHere = useHub((s) => Object.values(s.permissions).filter((p) => p.sessionId === id).length);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [timeline, pendingHere]);

  if (!session) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
        <Spinner />
        <p>Loading session…</p>
        <Link to="/" className="text-sm text-blue-200 hover:text-white">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const live = isSessionActive(session.status);
  const task = session.taskId ? tasks[session.taskId] : undefined;
  const childTasks = Object.values(tasks).filter((t) => t.parentSessionId === session.id);
  const lastTurnText = (() => {
    const lastUser = [...events].reverse().find((e) => e.kind === 'user_message');
    return collectAgentText(events, lastUser?.seq ?? 0) || collectAgentText(events);
  })();

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setMenu(false);
    try {
      await fn();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-var(--chrome-top)-var(--chrome-bottom))] max-w-6xl flex-col">
      <div className="space-y-2 pb-3">
        <div className="flex items-center gap-2 px-1">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Back" className="h-9 w-9 shrink-0 rounded-full px-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <AgentAvatar agentId={session.agentId} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="min-w-0 truncate text-base font-semibold tracking-tight sm:text-xl">{session.title}</h1>
              <StatusBadge status={session.status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-300">
              {agentName(agents, session.agentId)} · {session.mode} · <span title={session.cwd}>{basename(session.cwd)}</span>
              {session.workspace.type === 'worktree' && (
                <span className="text-emerald-200">
                  {' '}
                  · <GitBranch className="inline h-3 w-3" /> {session.workspace.branch}
                </span>
              )}
            </p>
          </div>
          <div className="relative flex shrink-0 items-center gap-1">
            {live ? (
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run('stop', () => post(`/api/sessions/${id}/stop`))} title="Stop agent" aria-label="Stop agent">
                {busy === 'stop' ? <Spinner /> : <Power className="h-4 w-4" />}
                <span className="hidden sm:inline">Stop</span>
              </Button>
            ) : (
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => run('restart', () => post(`/api/sessions/${id}/restart`))}>
                {busy === 'restart' ? <Spinner /> : <Play className="h-4 w-4" />} Restart
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setMenu(!menu)} aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} className="w-9 px-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
            {menu && (
              <div className="glass-strong glass-rim animate-rise absolute right-0 top-11 z-20 w-52 overflow-hidden rounded-2xl p-1.5 text-sm" role="menu">
                <button role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.08]" onClick={() => (setMenu(false), setHandoff(true))}>
                  <ArrowRightLeft className="h-4 w-4" /> Hand off…
                </button>
                <button role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.08]" onClick={() => (setMenu(false), setDiff(true))}>
                  <FileDiff className="h-4 w-4" /> Changes / diff
                </button>
                <button role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.08]" onClick={() => (setMenu(false), setRename(session.title))}>
                  <Pencil className="h-4 w-4" /> Rename
                </button>
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.08]"
                  onClick={() => run('archive', () => patch(`/api/sessions/${id}`, { archived: !session.archived }))}
                >
                  <Archive className="h-4 w-4" /> {session.archived ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-red-200 transition-colors duration-200 hover:bg-red-500/15"
                  onClick={() => {
                    if (confirm('Delete this session and its history?')) {
                      void run('delete', async () => {
                        await del(`/api/sessions/${id}`);
                        navigate('/');
                      });
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
        {(parent || task) && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-blue-400/10 px-3 py-2 text-xs text-blue-100 ring-1 ring-inset ring-blue-300/20">
            <GitBranch className="h-3.5 w-3.5" />
            Delegated task
            {task && <TaskBadge status={task.status} />}
            {parent && (
              <Link to={`/sessions/${parent.id}`} className="truncate underline">
                from {agentName(agents, parent.agentId)}: {parent.title}
              </Link>
            )}
          </div>
        )}
        {session.status === 'error' && session.statusMessage && (
          <p className="rounded-2xl bg-red-500/10 px-3 py-2 text-xs text-red-200 ring-1 ring-inset ring-red-300/20">{session.statusMessage}</p>
        )}
        <button className="flex min-h-8 items-center gap-1 text-xs text-slate-400 transition-colors duration-200 hover:text-slate-200" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>
          <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform duration-200', showSettings && 'rotate-180')} /> Session settings
        </button>
        {showSettings && <SessionSettings session={session} />}
      </div>

      {session.mode === 'terminal' ? (
        <div className="min-h-0 flex-1">
          <Suspense fallback={<Spinner />}>
            <TerminalView sessionId={session.id} live={live} />
          </Suspense>
        </div>
      ) : (
        <div
          ref={scroller}
          className="glass min-h-0 flex-1 overflow-y-auto rounded-3xl p-3 sm:p-5"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {!replayed && events.length === 0 ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : (
            <TimelineView items={timeline} />
          )}
          {session.status === 'running' && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <Spinner className="h-3 w-3" /> {agentName(agents, session.agentId)} is working…
            </div>
          )}
          {childTasks.length > 0 && (
            <div className="glass-inset mt-4 space-y-1 rounded-2xl p-2">
              <p className="px-1 text-xs font-semibold text-slate-300">Delegated tasks</p>
              {childTasks.map((t) => (
                <Link
                  key={t.id}
                  to={t.childSessionId ? `/sessions/${t.childSessionId}` : '/tasks'}
                  className="flex min-h-10 items-center gap-2 rounded-xl px-1.5 py-1 text-xs transition-colors duration-200 hover:bg-white/[0.06]"
                >
                  <AgentAvatar agentId={t.agentId} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{t.prompt}</span>
                  <TaskBadge status={t.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pt-3">
        <Composer session={session} />
      </div>

      <HandoffDialog open={handoff} onClose={() => setHandoff(false)} session={session} defaultText={lastTurnText} />
      <DiffDialog open={diff} onClose={() => setDiff(false)} session={session} />
      <Modal open={rename !== null} onClose={() => setRename(null)} title="Rename session">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (rename?.trim()) void run('rename', () => patch(`/api/sessions/${id}`, { title: rename.trim() })).then(() => setRename(null));
          }}
        >
          <input className={inputCls} value={rename ?? ''} onChange={(e) => setRename(e.target.value)} autoFocus />
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
