import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowsLeftRightIcon,
  CaretDownIcon,
  DotsThreeVerticalIcon,
  GitBranchIcon,
  GitDiffIcon,
  PencilSimpleIcon,
  PlayIcon,
  PowerIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AutoApprove, DelegationPolicy, SessionInfo } from '@agent-hub/shared/client';
import { buildTimeline, collectAgentText, isSessionActive } from '@agent-hub/shared/client';
import { Composer } from '../components/Composer';
import { DiffDialog } from '../components/DiffDialog';
import { HandoffDialog } from '../components/HandoffDialog';
import { TimelineView } from '../components/Timeline';
import {
  AgentAvatar,
  Button,
  ConfirmDialog,
  Dots,
  Field,
  Loading,
  Modal,
  Select,
  Skeleton,
  StatusBadge,
  TaskBadge,
  inputCls,
  pressable,
} from '../components/ui';
import { del, patch, post } from '../lib/api';
import { agentName, basename } from '../lib/format';
import { toastError, useHub } from '../lib/store';
import { hubSocket } from '../lib/ws';

const EMPTY: never[] = [];
const TerminalView = lazy(() => import('../components/TerminalView').then((m) => ({ default: m.TerminalView })));

function SettingSelect({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="caption-3 block text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function SessionSettings({ session }: { session: SessionInfo }) {
  const live = isSessionActive(session.status) && session.status !== 'starting';
  const configure = (body: Record<string, string>) => post(`/api/sessions/${session.id}/config`, body).catch((e) => toastError(e));
  const update = (body: Record<string, unknown>) => patch(`/api/sessions/${session.id}`, body).catch((e) => toastError(e));
  const configCategories = new Set(session.configOptions.map((c) => c.category ?? ''));
  return (
    <div className="surface animate-rise grid gap-3 rounded-2xl p-3 sm:grid-cols-2 lg:grid-cols-4">
      {session.availableModes.length > 0 && !configCategories.has('mode') && (
        <SettingSelect label="Mode">
          <Select disabled={!live} value={session.currentModeId ?? ''} onChange={(e) => configure({ modeId: e.target.value })}>
            {session.availableModes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </SettingSelect>
      )}
      {session.availableModels.length > 0 && !configCategories.has('model') && (
        <SettingSelect label="Model">
          <Select disabled={!live} value={session.currentModelId ?? ''} onChange={(e) => configure({ modelId: e.target.value })}>
            {!session.currentModelId && <option value="">Default</option>}
            {session.availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </SettingSelect>
      )}
      {session.configOptions.map((c) => (
        <SettingSelect key={c.id} label={c.name}>
          <Select disabled={!live} value={c.currentValue} onChange={(e) => configure({ configId: c.id, value: e.target.value })}>
            {c.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.name}
              </option>
            ))}
          </Select>
        </SettingSelect>
      ))}
      {session.mode === 'structured' && (
        <SettingSelect label="Auto approve">
          <Select value={session.autoApprove} onChange={(e) => update({ autoApprove: e.target.value as AutoApprove })}>
            <option value="none">Nothing (ask me)</option>
            <option value="read">Reads & searches</option>
            <option value="edits">Reads & edits</option>
            <option value="all">Everything</option>
          </Select>
        </SettingSelect>
      )}
      {session.mode === 'structured' && (
        <SettingSelect label="Delegation">
          <Select value={session.delegationPolicy} onChange={(e) => update({ delegationPolicy: e.target.value as DelegationPolicy })}>
            <option value="ask">Ask me</option>
            <option value="auto">Allow automatically</option>
            <option value="deny">Not allowed</option>
          </Select>
        </SettingSelect>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick(): void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      className={clsx(
        'title-4 flex w-full items-center gap-3 rounded-xl px-3 py-2 pointer-coarse:min-h-11',
        pressable,
        danger ? 'text-red-300 hover:bg-red-950' : 'text-neutral-200 hover:bg-surface-4 hover:text-white',
      )}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

function TimelineSkeleton() {
  return (
    <Loading label="Loading conversation" className="space-y-4">
      <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
      <Skeleton className="h-20 w-5/6 rounded-2xl" />
      <Skeleton className="h-10 w-1/2 rounded-2xl" />
    </Loading>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (!id || session?.mode === 'terminal') return;
    return hubSocket.subscribe(id);
  }, [id, session?.mode]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    const onDown = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [menu]);

  const timeline = useMemo(() => buildTimeline(events), [events]);
  const pendingHere = useHub((s) => Object.values(s.permissions).filter((p) => p.sessionId === id).length);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [timeline, pendingHere]);

  if (!session) {
    return (
      <div className="space-y-6 pt-8">
        <Loading label="Loading session" className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </Loading>
        <Skeleton className="h-64 rounded-3xl" />
        <Link to="/" className="link button-sm">
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
    <div className="flex h-[calc(100dvh-var(--chrome-top)-var(--chrome-bottom))] flex-col">
      <div className="space-y-3 pb-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Back" className="h-8 w-8 shrink-0 rounded-full px-0">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <AgentAvatar agentId={session.agentId} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="title-2 sm:heading-6 min-w-0 truncate text-white">{session.title}</h1>
              <StatusBadge status={session.status} />
            </div>
            <p className="caption-4 truncate text-neutral-300">
              {agentName(agents, session.agentId)} · {session.mode} · <span title={session.cwd}>{basename(session.cwd)}</span>
              {session.workspace.type === 'worktree' && (
                <span className="text-emerald-300">
                  {' '}
                  · <GitBranchIcon className="inline h-3 w-3" /> {session.workspace.branch}
                </span>
              )}
            </p>
          </div>
          <div ref={menuRef} className="relative flex shrink-0 items-center gap-1">
            {live ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => run('stop', () => post(`/api/sessions/${id}/stop`))}
                title="Stop agent"
                aria-label="Stop agent"
              >
                {busy === 'stop' ? <Dots label="Stopping" /> : <PowerIcon className="h-4 w-4" />}
                <span className="hidden sm:inline">Stop</span>
              </Button>
            ) : (
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => run('restart', () => post(`/api/sessions/${id}/restart`))}>
                {busy === 'restart' ? <Dots label="Restarting" /> : <PlayIcon className="h-4 w-4" />} Restart
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMenu(!menu)}
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menu}
              className="w-8 px-0"
            >
              <DotsThreeVerticalIcon className="h-4 w-4" weight="bold" />
            </Button>
            {menu && (
              <div className="surface-raised animate-rise absolute right-0 top-12 z-20 w-56 space-y-1 rounded-2xl p-2" role="menu">
                <MenuItem icon={<ArrowsLeftRightIcon className="h-4 w-4" />} onClick={() => (setMenu(false), setHandoff(true))}>
                  Hand off…
                </MenuItem>
                <MenuItem icon={<GitDiffIcon className="h-4 w-4" />} onClick={() => (setMenu(false), setDiff(true))}>
                  Changes and diff
                </MenuItem>
                <MenuItem icon={<PencilSimpleIcon className="h-4 w-4" />} onClick={() => (setMenu(false), setRename(session.title))}>
                  Rename
                </MenuItem>
                <MenuItem icon={<ArchiveIcon className="h-4 w-4" />} onClick={() => run('archive', () => patch(`/api/sessions/${id}`, { archived: !session.archived }))}>
                  {session.archived ? 'Unarchive' : 'Archive'}
                </MenuItem>
                <MenuItem danger icon={<TrashIcon className="h-4 w-4" />} onClick={() => (setMenu(false), setConfirmDelete(true))}>
                  Delete
                </MenuItem>
              </div>
            )}
          </div>
        </div>
        {(parent || task) && (
          <div className="surface caption-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-neutral-200">
            <GitBranchIcon className="h-4 w-4 text-blue-300" />
            Delegated task
            {task && <TaskBadge status={task.status} />}
            {parent && (
              <Link to={`/sessions/${parent.id}`} className="link truncate">
                from {agentName(agents, parent.agentId)}: {parent.title}
              </Link>
            )}
          </div>
        )}
        {session.status === 'error' && session.statusMessage && (
          <p role="alert" className="body-6 rounded-xl border border-red-900 bg-red-950 px-3 py-2 text-red-200">
            {session.statusMessage}
          </p>
        )}
        <button
          className={clsx('caption-3 flex min-h-8 items-center gap-1 rounded-lg px-1 text-neutral-400 hover:text-white', pressable)}
          onClick={() => setShowSettings(!showSettings)}
          aria-expanded={showSettings}
        >
          <CaretDownIcon className={clsx('h-4 w-4 transition-transform duration-500 ease-base', showSettings && 'rotate-180')} /> Session settings
        </button>
        {showSettings && <SessionSettings session={session} />}
      </div>

      {session.mode === 'terminal' ? (
        <div className="min-h-0 flex-1">
          <Suspense fallback={<Skeleton className="h-full rounded-3xl" />}>
            <TerminalView sessionId={session.id} live={live} />
          </Suspense>
        </div>
      ) : (
        <div
          ref={scroller}
          className="surface min-h-0 flex-1 overflow-y-auto rounded-3xl p-4 sm:p-6"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {!replayed && events.length === 0 ? <TimelineSkeleton /> : <TimelineView items={timeline} />}
          {session.status === 'running' && (
            <div className="caption-4 mt-4 flex items-center gap-2 text-neutral-400">
              <Dots label="Working" /> {agentName(agents, session.agentId)} is working…
            </div>
          )}
          {childTasks.length > 0 && (
            <div className="surface-inset mt-4 space-y-1 rounded-2xl p-2">
              <p className="title-5 px-2 py-1 text-neutral-300">Delegated tasks</p>
              {childTasks.map((t) => (
                <Link
                  key={t.id}
                  to={t.childSessionId ? `/sessions/${t.childSessionId}` : '/tasks'}
                  className="caption-3 flex min-h-10 items-center gap-2 rounded-xl px-2 py-1 transition-[background-color] duration-300 hover:bg-surface-3"
                >
                  <AgentAvatar agentId={t.agentId} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-neutral-200">{t.prompt}</span>
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
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (rename?.trim()) void run('rename', () => patch(`/api/sessions/${id}`, { title: rename.trim() })).then(() => setRename(null));
          }}
        >
          <Field label="Session name">
            <input className={inputCls} value={rename ?? ''} onChange={(e) => setRename(e.target.value)} autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRename(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!rename?.trim()}>
              Save name
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this session?"
        confirmLabel="Delete session"
        onConfirm={() => {
          setConfirmDelete(false);
          void run('delete', async () => {
            await del(`/api/sessions/${id}`);
            navigate('/');
          });
        }}
      >
        “{session.title}” and its full history are removed from this hub. This can't be undone.
      </ConfirmDialog>
    </div>
  );
}
