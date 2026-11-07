import {
  BrainIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  FileMagnifyingGlassIcon,
  GitForkIcon,
  GlobeIcon,
  NotePencilIcon,
  ShieldCheckIcon,
  ShieldSlashIcon,
  TerminalIcon,
  TrashIcon,
  WrenchIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import type { TimelineItem, ToolKind, ToolStatus } from '@agent-hub/shared/client';
import { agentName } from '../lib/format';
import { useHub } from '../lib/store';
import { FileDiff } from './DiffView';
import { PermissionCard } from './PermissionCard';
import { AgentAvatar, TaskBadge } from './ui';

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

const TOOL_ICON: Partial<Record<ToolKind, typeof WrenchIcon>> = {
  read: FileMagnifyingGlassIcon,
  search: FileMagnifyingGlassIcon,
  edit: NotePencilIcon,
  delete: TrashIcon,
  move: NotePencilIcon,
  execute: TerminalIcon,
  fetch: GlobeIcon,
  think: BrainIcon,
};

/** Small pulsing dot used for in progress work instead of a spinner. */
function Working({ className }: { className?: string }) {
  return (
    <span role="status" aria-label="In progress" className={clsx('flex h-4 w-4 shrink-0 items-center justify-center', className)}>
      <span className="live-dot h-2 w-2 rounded-full bg-blue-300 text-blue-300" />
    </span>
  );
}

function ToolStatusIcon({ status }: { status: ToolStatus }) {
  if (status === 'completed') return <CheckCircleIcon className="h-4 w-4 text-emerald-400" weight="fill" aria-label="Completed" />;
  if (status === 'failed') return <XCircleIcon className="h-4 w-4 text-red-400" weight="fill" aria-label="Failed" />;
  if (status === 'in_progress') return <Working />;
  return <CircleDashedIcon className="h-4 w-4 text-neutral-400" aria-label="Pending" />;
}

function ToolCard({ item }: { item: Extract<TimelineItem, { type: 'tool' }> }) {
  const [open, setOpen] = useState(item.status === 'failed' || item.content.some((c) => c.type === 'diff'));
  const Icon = TOOL_ICON[item.toolKind] ?? WrenchIcon;
  const hasBody = item.content.length > 0 || item.locations.length > 0 || item.rawInput !== undefined;
  return (
    <div className="surface-inset rounded-xl">
      <button
        className="body-6 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-[background-color] duration-300 hover:bg-surface-3"
        onClick={() => hasBody && setOpen(!open)}
        aria-expanded={hasBody ? open : undefined}
      >
        <Icon className="h-4 w-4 shrink-0 text-neutral-400" />
        <span className="min-w-0 flex-1 truncate text-neutral-200">{item.title}</span>
        <ToolStatusIcon status={item.status} />
        {hasBody && <CaretRightIcon className={clsx('h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-500 ease-base', open && 'rotate-90')} />}
      </button>
      {open && hasBody && (
        <div className="animate-fade space-y-2 px-3 pb-3">
          {item.locations.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.locations.map((l, i) => (
                <code key={i} className="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-xs text-neutral-300">
                  {l.path}
                  {l.line ? `:${l.line}` : ''}
                </code>
              ))}
            </div>
          )}
          {item.content.map((c, i) =>
            c.type === 'diff' ? (
              <FileDiff key={i} path={c.path} oldText={c.oldText} newText={c.newText} />
            ) : c.type === 'text' ? (
              <pre key={i} className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black p-2 font-mono text-xs text-neutral-300">
                {c.text}
              </pre>
            ) : (
              <p key={i} className="caption-4 text-neutral-400">
                Terminal output ({c.terminalId})
              </p>
            ),
          )}
          {item.rawInput !== undefined && item.content.length === 0 && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black p-2 font-mono text-xs text-neutral-400">
              {JSON.stringify(item.rawInput, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button className="block w-full rounded-lg text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="caption-3 flex items-center gap-1 text-neutral-400 hover:text-neutral-200">
        <BrainIcon className="h-4 w-4" />
        Thinking
        <CaretRightIcon className={clsx('h-3 w-3 transition-transform duration-500 ease-base', open && 'rotate-90')} />
      </span>
      {open ? (
        <span className="surface-inset caption-4 animate-fade mt-2 block whitespace-pre-wrap rounded-xl p-3 text-neutral-400">{text}</span>
      ) : (
        <span className="caption-4 mt-0.5 block truncate pl-6 text-neutral-400">{text}</span>
      )}
    </button>
  );
}

function PermissionItem({ item }: { item: Extract<TimelineItem, { type: 'permission' }> }) {
  const live = useHub((s) => s.permissions[item.id]);
  if (live && !item.resolved) return <PermissionCard request={live} />;
  const r = item.resolved;
  const approved = r?.outcome === 'selected' && !/reject|deny/i.test(`${r.optionId} ${r.optionName}`);
  return (
    <div className="caption-4 flex items-center gap-2 text-neutral-400">
      {approved ? <ShieldCheckIcon className="h-4 w-4 text-emerald-400" /> : <ShieldSlashIcon className="h-4 w-4 text-red-400" />}
      <span className="min-w-0 truncate">
        {item.title}: <span className={approved ? 'text-emerald-300' : 'text-red-300'}>{r?.optionName ?? 'Pending'}</span>
        {r && <span> · {r.by.name}</span>}
      </span>
    </div>
  );
}

function Delegation({ item }: { item: Extract<TimelineItem, { type: 'delegation' }> }) {
  const agents = useHub((s) => s.agents);
  const task = useHub((s) => s.tasks[item.id]);
  return (
    <div className="surface-inset space-y-2 rounded-xl p-3">
      <div className="body-6 flex items-center gap-2">
        <GitForkIcon className="h-4 w-4 text-blue-300" />
        <span className="text-neutral-300">Delegated to</span>
        <AgentAvatar agentId={item.agentId} size="sm" />
        <span className="title-4 text-white">{agentName(agents, item.agentId)}</span>
        <span className="ml-auto">
          <TaskBadge status={item.status} />
        </span>
      </div>
      <p className="caption-4 line-clamp-3 whitespace-pre-wrap text-neutral-400">{item.prompt}</p>
      {task?.result && item.status === 'completed' && (
        <details>
          <summary className="caption-3 text-neutral-200">Result</summary>
          <div className="body-6 mt-2 rounded-lg bg-black p-3">
            <Markdown text={task.result} />
          </div>
        </details>
      )}
      {task?.error && <p className="caption-4 text-red-300">{task.error}</p>}
      {item.childSessionId && (
        <Link to={`/sessions/${item.childSessionId}`} className="link caption-3 inline-block">
          Open subagent session →
        </Link>
      )}
    </div>
  );
}

export function TimelineView({ items }: { items: TimelineItem[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => {
        switch (item.type) {
          case 'user':
            return (
              <div key={item.id} className="flex justify-end">
                <div className="max-w-[88%] space-y-1 rounded-2xl rounded-br-sm bg-surface-4 px-4 py-2">
                  {item.from.kind !== 'device' && <p className="caption-2 uppercase tracking-wide text-neutral-300">{item.from.name}</p>}
                  <p className="body-6 whitespace-pre-wrap break-words text-white">{item.text}</p>
                  {item.from.kind === 'device' && <p className="caption-5 text-right text-neutral-400">{item.from.name}</p>}
                </div>
              </div>
            );
          case 'agent':
            return (
              <div key={item.id} className="body-6 text-neutral-200">
                <Markdown text={item.text} />
              </div>
            );
          case 'thought':
            return <Thought key={item.id} text={item.text} />;
          case 'tool':
            return <ToolCard key={item.id} item={item} />;
          case 'plan':
            return (
              <div key={item.id} className="surface-inset space-y-2 rounded-xl p-3">
                <p className="caption-2 uppercase tracking-wide text-neutral-400">Plan</p>
                <ul className="space-y-1">
                  {item.entries.map((e, i) => (
                    <li key={i} className="body-6 flex items-start gap-2">
                      {e.status === 'completed' ? (
                        <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" weight="fill" />
                      ) : e.status === 'in_progress' ? (
                        <Working className="mt-0.5" />
                      ) : (
                        <CircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                      )}
                      <span className={clsx(e.status === 'completed' ? 'text-neutral-400 line-through' : 'text-neutral-200')}>{e.content}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          case 'permission':
            return <PermissionItem key={item.id} item={item} />;
          case 'delegation':
            return <Delegation key={item.id} item={item} />;
          case 'system':
            return (
              <p
                key={item.id}
                className={clsx(
                  'caption-4 text-center',
                  item.level === 'error'
                    ? 'rounded-xl border border-red-900 bg-red-950 px-3 py-2 text-red-200'
                    : item.level === 'warn'
                      ? 'text-amber-300'
                      : 'text-neutral-400',
                )}
              >
                {item.text}
              </p>
            );
          case 'turn_end':
            return item.stopReason === 'end_turn' ? (
              <div key={item.id} className="h-2" aria-hidden />
            ) : (
              <div key={item.id} className="caption-2 flex items-center gap-2 uppercase tracking-wide text-neutral-400">
                <div className="h-px flex-1 bg-surface-4" />
                {item.stopReason.replace(/_/g, ' ')}
                <div className="h-px flex-1 bg-surface-4" />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
