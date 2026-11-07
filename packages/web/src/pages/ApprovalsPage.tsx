import { ClockCounterClockwiseIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PermissionRequest } from '@agent-hub/shared/client';
import { PermissionCard } from '../components/PermissionCard';
import { AgentAvatar, Card, EmptyState, Loading, PageHeader, Pill, Reveal, Skeleton, Tabs } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useHub } from '../lib/store';

const STATUS: Record<string, { label: string; cls: string }> = {
  approved: { label: 'Approved', cls: 'text-emerald-300' },
  rejected: { label: 'Rejected', cls: 'text-red-300' },
  cancelled: { label: 'Cancelled', cls: 'text-neutral-300' },
  expired: { label: 'Expired', cls: 'text-amber-300' },
  pending: { label: 'Pending', cls: 'text-amber-300' },
};

const TABS = ['pending', 'history'] as const;

export function ApprovalsPage() {
  const permissions = useHub((s) => s.permissions);
  const sessions = useHub((s) => s.sessions);
  const pending = Object.values(permissions).sort((a, b) => a.createdAt - b.createdAt);
  const [tab, setTab] = useState<(typeof TABS)[number]>('pending');
  const [history, setHistory] = useState<PermissionRequest[] | null>(null);

  useEffect(() => {
    if (tab === 'history') {
      api<PermissionRequest[]>('/api/permissions?limit=150')
        .then((list) => setHistory(list.filter((p) => p.status !== 'pending')))
        .catch(() => setHistory([]));
    }
  }, [tab, pending.length]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 pt-8">
      <div className="animate-rise space-y-6">
        <PageHeader title="Approvals" description="Actions your agents want to take. Decide here or on any paired device." />
        <Tabs<(typeof TABS)[number]>
          label="Approvals"
          tabs={TABS}
          value={tab}
          onChange={setTab}
          className="w-fit"
          render={(t) => (t === 'pending' && pending.length > 0 ? `Pending (${pending.length})` : t)}
        />
      </div>

      {tab === 'pending' &&
        (pending.length === 0 ? (
          <EmptyState
            icon={<ShieldCheckIcon className="h-6 w-6" />}
            title="Nothing waiting for you"
            action={
              <Link to="/" className="link button-sm">
                Go to your agents
              </Link>
            }
          >
            When an agent asks for permission or wants to delegate work, it shows up here and on every paired device.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {pending.map((p) => (
              <Reveal key={p.id}>
                <PermissionCard request={p} showSession />
              </Reveal>
            ))}
          </div>
        ))}

      {tab === 'history' &&
        (history === null ? (
          <Loading label="Loading history" className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-2xl" />
            ))}
          </Loading>
        ) : history.length === 0 ? (
          <EmptyState icon={<ClockCounterClockwiseIcon className="h-6 w-6" />} title="No decisions yet">
            Approvals and rejections from every device are listed here once you make them.
          </EmptyState>
        ) : (
          <Card className="p-2">
            <ul className="space-y-1">
              {history.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-xl px-3 py-2 transition-[background-color] duration-300 hover:bg-surface-3">
                  <AgentAvatar agentId={p.agentId} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="title-4 truncate text-white">{p.title}</p>
                    <p className="caption-4 truncate text-neutral-400">
                      {p.resolvedBy?.name ?? 'Unknown'} · {timeAgo(p.resolvedAt)}
                      {sessions[p.sessionId] && (
                        <>
                          {' · '}
                          <Link to={`/sessions/${p.sessionId}`} className="link">
                            {sessions[p.sessionId].title}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <Pill className={STATUS[p.status]?.cls}>{STATUS[p.status]?.label ?? p.status}</Pill>
                </li>
              ))}
            </ul>
          </Card>
        ))}
    </div>
  );
}
