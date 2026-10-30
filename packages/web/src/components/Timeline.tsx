import { clsx } from 'clsx';
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDashed,
  FileEdit,
  FileSearch,
  GitBranch,
  Globe,
  Loader2,
  ShieldCheck,
  ShieldX,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
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

const TOOL_ICON: Partial<Record<ToolKind, typeof Wrench>> = {
  read: FileSearch,
  search: FileSearch,
  edit: FileEdit,
  delete: Trash2,
  move: FileEdit,
  execute: Terminal,
  fetch: Globe,
  think: Brain,
};

function ToolStatusIcon({ status }: { status: ToolStatus }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === 'in_progress') return <Loader2 className="h-4 w-4 animate-spin text-blue-200" />;
  return <CircleDashed className="h-4 w-4 text-slate-400" />;
}

function ToolCard({ item }: { item: Extract<TimelineItem, { type: 'tool' }> }) {
  const [open, setOpen] = useState(item.status === 'failed' || item.content.some((c) => c.type === 'diff'));
  const Icon = TOOL_ICON[item.toolKind] ?? Wrench;
  const hasBody = item.content.length > 0 || item.locations.length > 0 || item.rawInput !== undefined;
  return (
    <div className="glass-inset rounded-2xl">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        onClick={() => hasBody && setOpen(!open)}
        aria-expanded={open}
      >
        <Icon className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-slate-200">{item.title}</span>
        <ToolStatusIcon status={item.status} />
        {hasBody && <ChevronRight className={clsx('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-90')} />}
      </button>
      {open && hasBody && (
        <div className="space-y-2 border-t border-white/10 p-3">
          {item.locations.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.locations.map((l, i) => (
                <code key={i} className="rounded bg-white/[0.08] px-1.5 py-0.5 text-xs text-slate-300">
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
              <pre key={i} className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-black/35 p-2 font-mono text-xs text-slate-300">
                {c.text}
              </pre>
            ) : (
              <p key={i} className="text-xs text-slate-400">
                Terminal output ({c.terminalId})
              </p>
            ),
          )}
          {item.rawInput !== undefined && item.content.length === 0 && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-black/35 p-2 font-mono text-xs text-slate-400">
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
    <button className="block w-full text-left" onClick={() => setOpen(!open)}>
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Brain className="h-3.5 w-3.5" />
        <span>Thinking</span>
        <ChevronRight className={clsx('h-3.5 w-3.5 transition', open && 'rotate-90')} />
      </div>
      {open ? (
        <p className="mt-1 whitespace-pre-wrap border-l-2 border-white/10 pl-3 text-xs italic text-slate-400">{text}</p>
      ) : (
        <p className="mt-0.5 truncate pl-5 text-xs italic text-slate-500">{text}</p>
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
    <div className="flex items-center gap-2 text-xs text-slate-400">
      {approved ? <ShieldCheck className="h-4 w-4 text-emerald-400" /> : <ShieldX className="h-4 w-4 text-red-400" />}
      <span className="min-w-0 truncate">
        {item.title} — <span className={approved ? 'text-emerald-300' : 'text-red-300'}>{r?.optionName ?? 'Pending'}</span>
        {r && <span> · {r.by.name}</span>}
      </span>
    </div>
  );
}

function Delegation({ item }: { item: Extract<TimelineItem, { type: 'delegation' }> }) {
  const agents = useHub((s) => s.agents);
  const task = useHub((s) => s.tasks[item.id]);
  return (
    <div className="glass-inset rounded-2xl !border-blue-300/20 bg-blue-400/[0.06] p-3.5">
      <div className="flex items-center gap-2 text-sm">
        <GitBranch className="h-4 w-4 text-blue-200" />
        <span className="text-slate-300">Delegated to</span>
        <AgentAvatar agentId={item.agentId} size="sm" />
        <span className="font-medium">{agentName(agents, item.agentId)}</span>
        <span className="ml-auto">
          <TaskBadge status={item.status} />
        </span>
      </div>
      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-slate-400">{item.prompt}</p>
      {task?.result && item.status === 'completed' && (
        <details className="mt-2">
          <summary className="text-xs font-medium text-blue-200">Result</summary>
          <div className="mt-1 rounded bg-black/25 p-2 text-sm">
            <Markdown text={task.result} />
          </div>
        </details>
      )}
      {task?.error && <p className="mt-2 text-xs text-red-300">{task.error}</p>}
      {item.childSessionId && (
        <Link to={`/sessions/${item.childSessionId}`} className="mt-2 inline-block text-xs font-medium text-blue-200 hover:text-white hover:underline">
          Open sub-agent session →
        </Link>
      )}
    </div>
  );
}

export function TimelineView({ items }: { items: TimelineItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => {
        switch (item.type) {
          case 'user':
            return (
              <div key={item.id} className="flex justify-end">
                <div className="max-w-[88%] rounded-[20px] rounded-br-md bg-gradient-to-br from-blue-500/35 to-violet-500/30 px-4 py-2.5 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.22),0_10px_24px_-14px_rgb(59_130_246/0.8)] ring-1 ring-inset ring-white/15">
                  {item.from.kind !== 'device' && (
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-blue-100">{item.from.name}</p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-100">{item.text}</p>
                  {item.from.kind === 'device' && <p className="mt-1 text-right text-[10px] text-slate-400">{item.from.name}</p>}
                </div>
              </div>
            );
          case 'agent':
            return (
              <div key={item.id} className="text-sm text-slate-200">
                <Markdown text={item.text} />
              </div>
            );
          case 'thought':
            return <Thought key={item.id} text={item.text} />;
          case 'tool':
            return <ToolCard key={item.id} item={item} />;
          case 'plan':
            return (
              <div key={item.id} className="glass-inset rounded-2xl p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Plan</p>
                <ul className="space-y-1">
                  {item.entries.map((e, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      {e.status === 'completed' ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      ) : e.status === 'in_progress' ? (
                        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-200" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      )}
                      <span className={clsx(e.status === 'completed' && 'text-slate-400 line-through')}>{e.content}</span>
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
                  'text-center text-xs',
                  item.level === 'error' ? 'rounded-2xl bg-red-500/10 px-3 py-2 text-red-200 ring-1 ring-inset ring-red-300/20' : item.level === 'warn' ? 'text-amber-300/80' : 'text-slate-400',
                )}
              >
                {item.text}
              </p>
            );
          case 'turn_end':
            return item.stopReason === 'end_turn' ? (
              <div key={item.id} className="border-t border-white/[0.06]" />
            ) : (
              <div key={item.id} className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                <div className="h-px flex-1 bg-white/[0.08]" />
                {item.stopReason.replace(/_/g, ' ')}
                <div className="h-px flex-1 bg-white/[0.08]" />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
