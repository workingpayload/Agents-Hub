import { clsx } from 'clsx';
import { BellRing, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PermissionRequest } from '@agent-hub/shared/client';
import { PermissionCard } from '../components/PermissionCard';
import { AgentAvatar, Card, EmptyState, Pill } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useHub } from '../lib/store';

const STATUS_CLS: Record<string, string> = {
  approved: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-300 ring-red-500/30',
  cancelled: 'bg-slate-500/15 text-slate-400 ring-slate-500/30',
  expired: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  pending: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
};

export function ApprovalsPage() {
  const permissions = useHub((s) => s.permissions);
  const sessions = useHub((s) => s.sessions);
  const pending = Object.values(permissions).sort((a, b) => a.createdAt - b.createdAt);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [history, setHistory] = useState<PermissionRequest[]>([]);

  useEffect(() => {
    if (tab === 'history') {
      api<PermissionRequest[]>('/api/permissions?limit=150')
        .then((list) => setHistory(list.filter((p) => p.status !== 'pending')))
        .catch(() => undefined);
    }
  }, [tab, pending.length]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="px-1 text-2xl font-semibold tracking-tight">Approvals</h1>
        <div role="tablist" className="glass ml-auto flex rounded-2xl p-1">
          {(['pending', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              role="tab"
              aria-selected={tab === t}
              className={clsx('min-h-9 rounded-xl px-3.5 py-1.5 text-sm font-medium capitalize transition-colors duration-200 pointer-coarse:min-h-11', tab === t ? 'bg-white/[0.12] text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.22),0_6px_16px_-10px_rgb(59_130_246/0.8)] ring-1 ring-inset ring-white/15' : 'text-slate-300 hover:text-white')}
            >
              {t}
              {t === 'pending' && pending.length > 0 && ` (${pending.length})`}
            </button>
          ))}
        </div>
      </div>

      {tab === 'pending' &&
        (pending.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="Nothing waiting for you">
            When an agent asks for permission or wants to delegate work, it shows up here and on every paired device.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {pending.map((p) => (
              <PermissionCard key={p.id} request={p} showSession />
            ))}
          </div>
        ))}

      {tab === 'history' && (
        <Card>
          {history.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">
              <BellRing className="mx-auto mb-2 h-6 w-6" />
              No decisions yet
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {history.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <AgentAvatar agentId={p.agentId} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.title}</p>
                    <p className="truncate text-xs text-slate-400">
                      {p.resolvedBy?.name ?? '—'} · {timeAgo(p.resolvedAt)}
                      {sessions[p.sessionId] && (
                        <>
                          {' · '}
                          <Link to={`/sessions/${p.sessionId}`} className="text-blue-200 hover:text-white hover:underline">
                            {sessions[p.sessionId].title}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <Pill className={STATUS_CLS[p.status]}>{p.status}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
