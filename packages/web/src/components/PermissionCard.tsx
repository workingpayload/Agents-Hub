import { clsx } from 'clsx';
import { Check, GitBranch, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PermissionOption, PermissionRequest } from '@agent-hub/shared/client';
import { ApiError, post } from '../lib/api';
import { agentName, timeAgo } from '../lib/format';
import { toastError, useHub } from '../lib/store';
import { FileDiff } from './DiffView';
import { AgentAvatar, Button, Spinner } from './ui';

function optionVariant(o: PermissionOption) {
  if (o.kind === 'allow_once') return 'success' as const;
  if (o.kind === 'allow_always') return 'secondary' as const;
  return 'danger' as const;
}

/** An actionable approval request (tool call or delegation). First answer from any device wins. */
export function PermissionCard({ request, showSession = false }: { request: PermissionRequest; showSession?: boolean }) {
  const agents = useHub((s) => s.agents);
  const session = useHub((s) => s.sessions[request.sessionId]);
  const toast = useHub((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);

  const respond = async (body: { optionId?: string; cancel?: boolean }, key: string) => {
    setBusy(key);
    try {
      await post(`/api/permissions/${request.id}/respond`, body);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast({ tone: 'info', title: 'Already answered', body: 'Another device responded first.' });
      } else {
        toastError(err, 'Could not send response');
      }
    } finally {
      setBusy(null);
    }
  };

  const isDelegation = request.type === 'delegation';
  return (
    <div
      role="group"
      aria-label={`${isDelegation ? 'Delegation' : 'Permission'} request: ${request.title}`}
      className="glass animate-rise overflow-hidden rounded-3xl !border-amber-300/30 shadow-[inset_0_1px_0_0_rgb(253_230_138/0.25),0_0_0_1px_rgb(245_158_11/0.12),0_18px_44px_-22px_rgb(245_158_11/0.55)]"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-16 -z-10 h-44 w-44 rounded-full bg-[radial-gradient(closest-side,rgb(245_158_11/0.28),transparent)] blur-2xl"
      />
      <div className="flex items-start gap-3 p-4">
        <AgentAvatar agentId={request.agentId} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-amber-200">
            {isDelegation ? <GitBranch className="h-3.5 w-3.5" aria-hidden /> : <ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
            <span className="font-semibold">{isDelegation ? 'Delegation request' : 'Permission request'}</span>
            <span className="text-slate-300">· {agentName(agents, request.agentId)}</span>
            {request.toolKind && <span className="text-slate-300">· {request.toolKind}</span>}
            <span className="text-slate-400">· {timeAgo(request.createdAt)}</span>
          </div>
          <p className="break-words font-display text-[15px] font-semibold text-slate-50">{request.title}</p>
          {showSession && session && (
            <Link to={`/sessions/${session.id}`} className="block truncate text-xs text-blue-200 hover:text-white hover:underline">
              {session.title}
            </Link>
          )}
        </div>
      </div>
      {(request.detail || request.content.length > 0) && (
        <div className="space-y-2 px-4 pb-4">
          {request.detail && !request.content.some((c) => c.type === 'text' && c.text === request.detail) && (
            <pre className="glass-field max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl p-3 font-mono text-xs text-slate-100">
              {request.detail}
            </pre>
          )}
          {request.content.map((c, i) =>
            c.type === 'diff' ? (
              <FileDiff key={i} path={c.path} oldText={c.oldText} newText={c.newText} />
            ) : c.type === 'text' ? (
              <pre key={i} className="glass-field max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl p-3 text-xs text-slate-100">
                {c.text}
              </pre>
            ) : null,
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 border-t border-white/10 bg-black/15 p-3 sm:flex sm:flex-wrap">
        {request.options.map((o) => (
          <Button
            key={o.optionId}
            variant={optionVariant(o)}
            disabled={busy !== null}
            onClick={() => respond({ optionId: o.optionId }, o.optionId)}
            className="whitespace-nowrap"
          >
            {busy === o.optionId ? (
              <Spinner />
            ) : o.kind.startsWith('allow') ? (
              <Check className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <X className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {o.name}
          </Button>
        ))}
        <Button
          variant="ghost"
          disabled={busy !== null}
          onClick={() => respond({ cancel: true }, 'cancel')}
          title="Cancel the request"
          className={clsx(request.options.length % 2 === 0 && 'col-span-2')}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
