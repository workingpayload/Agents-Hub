import { CheckIcon, GitForkIcon, ShieldWarningIcon, XIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PermissionOption, PermissionRequest } from '@agent-hub/shared/client';
import { ApiError, post } from '../lib/api';
import { agentName, timeAgo } from '../lib/format';
import { toastError, useHub } from '../lib/store';
import { FileDiff } from './DiffView';
import { AgentAvatar, Button, Dots } from './ui';

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
      className="animate-rise space-y-4 rounded-2xl border border-amber-900 bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar agentId={request.agentId} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="caption-4 flex flex-wrap items-center gap-x-2 text-amber-300">
            {isDelegation ? <GitForkIcon className="h-4 w-4" aria-hidden /> : <ShieldWarningIcon className="h-4 w-4" aria-hidden />}
            <span className="caption-3">{isDelegation ? 'Delegation request' : 'Permission request'}</span>
            <span className="text-neutral-300">· {agentName(agents, request.agentId)}</span>
            {request.toolKind && <span className="text-neutral-300">· {request.toolKind}</span>}
            <span className="text-neutral-400">· {timeAgo(request.createdAt)}</span>
          </div>
          <p className="title-3 break-words text-white">{request.title}</p>
          {showSession && session && (
            <Link to={`/sessions/${session.id}`} className="link caption-4 block truncate">
              {session.title}
            </Link>
          )}
        </div>
      </div>
      {(request.detail || request.content.length > 0) && (
        <div className="space-y-2">
          {request.detail && !request.content.some((c) => c.type === 'text' && c.text === request.detail) && (
            <pre className="surface-inset max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl p-3 font-mono text-xs text-neutral-100">
              {request.detail}
            </pre>
          )}
          {request.content.map((c, i) =>
            c.type === 'diff' ? (
              <FileDiff key={i} path={c.path} oldText={c.oldText} newText={c.newText} />
            ) : c.type === 'text' ? (
              <pre key={i} className="surface-inset body-6 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl p-3 font-sans text-neutral-100">
                {c.text}
              </pre>
            ) : null,
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {request.options.map((o) => (
          <Button key={o.optionId} variant={optionVariant(o)} disabled={busy !== null} onClick={() => respond({ optionId: o.optionId }, o.optionId)}>
            {busy === o.optionId ? (
              <Dots label="Sending" />
            ) : o.kind.startsWith('allow') ? (
              <CheckIcon className="h-4 w-4 shrink-0" weight="bold" aria-hidden />
            ) : (
              <XIcon className="h-4 w-4 shrink-0" weight="bold" aria-hidden />
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
