import { ArrowRightIcon, GitForkIcon, XCircleIcon } from '@phosphor-icons/react';
import { useMemo, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { SessionInfo, TaskInfo } from '@agent-hub/shared/client';
import { isTaskFinished } from '@agent-hub/shared/client';
import { AgentAvatar, Button, Card, EmptyState, PageHeader, Reveal, StatusBadge, TaskBadge } from '../components/ui';
import { post } from '../lib/api';
import { agentName, timeAgo } from '../lib/format';
import { toastError, useHub } from '../lib/store';

function TaskNode({ task, depth }: { task: TaskInfo; depth: number }) {
  const agents = useHub((s) => s.agents);
  const child = useHub((s) => (task.childSessionId ? s.sessions[task.childSessionId] : undefined));
  return (
    <div className="surface-inset space-y-2 rounded-xl p-3" style={{ marginLeft: `${depth * 24}px` }}>
      <div className="flex flex-wrap items-center gap-2">
        <ArrowRightIcon className="h-4 w-4 text-neutral-400" aria-hidden />
        <AgentAvatar agentId={task.agentId} size="sm" />
        <span className="title-4 text-white">{agentName(agents, task.agentId)}</span>
        <TaskBadge status={task.status} />
        <span className="caption-4 text-neutral-400">{timeAgo(task.updatedAt)}</span>
        {!isTaskFinished(task.status) && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-red-300 hover:text-red-200"
            onClick={() => post(`/api/tasks/${task.id}/cancel`).catch((e) => toastError(e))}
          >
            <XCircleIcon className="h-4 w-4" /> Cancel
          </Button>
        )}
      </div>
      <p className="body-6 line-clamp-2 whitespace-pre-wrap text-neutral-300">{task.prompt}</p>
      {task.error && <p className="caption-4 text-red-300">{task.error}</p>}
      {child && (
        <Link to={`/sessions/${child.id}`} className="link caption-3 inline-flex items-center gap-2">
          Open session <StatusBadge status={child.status} />
        </Link>
      )}
    </div>
  );
}

export function TasksPage() {
  const tasksMap = useHub((s) => s.tasks);
  const sessions = useHub((s) => s.sessions);
  const agents = useHub((s) => s.agents);
  const tasks = Object.values(tasksMap);

  const { roots, byParent } = useMemo(() => {
    const byParent = new Map<string, TaskInfo[]>();
    for (const t of Object.values(tasksMap)) byParent.set(t.parentSessionId, [...(byParent.get(t.parentSessionId) ?? []), t]);
    for (const list of byParent.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    const childSessionIds = new Set(Object.values(tasksMap).map((t) => t.childSessionId).filter(Boolean));
    const roots = [...byParent.keys()]
      .filter((id) => !childSessionIds.has(id))
      .map((id) => sessions[id])
      .filter((s): s is SessionInfo => Boolean(s))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return { roots, byParent };
  }, [tasksMap, sessions]);

  const renderTasks = (sessionId: string, depth: number): ReactElement[] =>
    (byParent.get(sessionId) ?? []).flatMap((t) => [
      <TaskNode key={t.id} task={t} depth={depth} />,
      ...(t.childSessionId ? renderTasks(t.childSessionId, depth + 1) : []),
    ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 pt-8">
      <div className="animate-rise">
        <PageHeader
          title="Delegations"
          description={
            <>
              Agents hand work to each other with the hub's <code className="font-mono">delegate_task</code> tool. Each tree shows who delegated what.
            </>
          }
        />
      </div>
      {tasks.length === 0 ? (
        <EmptyState
          icon={<GitForkIcon className="h-6 w-6" />}
          title="No delegations yet"
          action={
            <Link to="/" className="link button-sm">
              Start a session
            </Link>
          }
        >
          Ask an agent to “use Agent Hub to have Claude review this”. It calls the hub tools, and you approve the handoff.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {roots.map((root) => (
            <Reveal key={root.id}>
              <Card className="space-y-3 p-3">
                <Link to={`/sessions/${root.id}`} className="flex items-center gap-3 rounded-xl p-1 transition-[background-color] duration-300 hover:bg-surface-3">
                  <AgentAvatar agentId={root.agentId} />
                  <div className="min-w-0 flex-1">
                    <p className="title-3 truncate text-white">{root.title}</p>
                    <p className="caption-4 text-neutral-400">{agentName(agents, root.agentId)}</p>
                  </div>
                  <StatusBadge status={root.status} />
                </Link>
                <div className="space-y-2">{renderTasks(root.id, 0)}</div>
              </Card>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
