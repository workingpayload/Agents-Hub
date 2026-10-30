import { ArrowRight, GitBranch, XCircle } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { SessionInfo, TaskInfo } from '@agent-hub/shared/client';
import { isTaskFinished } from '@agent-hub/shared/client';
import { AgentAvatar, Button, Card, EmptyState, StatusBadge, TaskBadge } from '../components/ui';
import { post } from '../lib/api';
import { agentName, timeAgo } from '../lib/format';
import { toastError, useHub } from '../lib/store';

function TaskNode({ task, depth }: { task: TaskInfo; depth: number }) {
  const agents = useHub((s) => s.agents);
  const child = useHub((s) => (task.childSessionId ? s.sessions[task.childSessionId] : undefined));
  return (
    <div className="border-l-2 border-blue-300/25 py-2.5 pl-3.5" style={{ marginLeft: `${depth * 1.25}rem` }}>
      <div className="flex flex-wrap items-center gap-2">
        <ArrowRight className="h-3.5 w-3.5 text-blue-200" />
        <AgentAvatar agentId={task.agentId} size="sm" />
        <span className="text-sm font-medium">{agentName(agents, task.agentId)}</span>
        <TaskBadge status={task.status} />
        <span className="text-xs text-slate-400">{timeAgo(task.updatedAt)}</span>
        {!isTaskFinished(task.status) && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-red-300"
            onClick={() => post(`/api/tasks/${task.id}/cancel`).catch((e) => toastError(e))}
          >
            <XCircle className="h-3.5 w-3.5" /> Cancel
          </Button>
        )}
      </div>
      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-400">{task.prompt}</p>
      {task.error && <p className="mt-1 text-xs text-red-300">{task.error}</p>}
      {child && (
        <Link to={`/sessions/${child.id}`} className="mt-1 inline-flex items-center gap-1.5 text-xs text-blue-200 hover:underline">
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
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="px-1 text-2xl font-semibold tracking-tight">Delegations</h1>
        <p className="text-sm text-slate-400">
          Agents can hand work to each other with the hub's <code>delegate_task</code> tool. Each tree shows who delegated what.
        </p>
      </div>
      {tasks.length === 0 ? (
        <EmptyState icon={<GitBranch className="h-8 w-8" />} title="No delegations yet">
          Ask an agent to “use Agent Hub to have Claude review this” — it will call the hub tools, and you approve the hand-off.
        </EmptyState>
      ) : (
        roots.map((root) => (
          <Card key={root.id} className="p-3">
            <Link to={`/sessions/${root.id}`} className="flex items-center gap-2 hover:underline">
              <AgentAvatar agentId={root.agentId} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{root.title}</p>
                <p className="text-xs text-slate-400">{agentName(agents, root.agentId)}</p>
              </div>
              <StatusBadge status={root.status} />
            </Link>
            <div className="mt-2">{renderTasks(root.id, 0)}</div>
          </Card>
        ))
      )}
    </div>
  );
}
