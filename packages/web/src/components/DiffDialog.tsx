import { GitMerge, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SessionInfo, WorkspaceDiff } from '@agent-hub/shared/client';
import { api, post } from '../lib/api';
import { toastError, useHub } from '../lib/store';
import { UnifiedDiff } from './DiffView';
import { Button, Modal, Spinner } from './ui';

export function DiffDialog({ open, onClose, session }: { open: boolean; onClose(): void; session: SessionInfo }) {
  const toast = useHub((s) => s.toast);
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isWorktree = session.workspace.type === 'worktree';

  const load = async () => {
    setLoading(true);
    try {
      setDiff(await api<WorkspaceDiff>(`/api/sessions/${session.id}/diff`));
    } catch (err) {
      toastError(err, 'Could not load changes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session.id]);

  const action = async (name: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(name);
    try {
      await fn();
      toast({ tone: 'success', title: success });
      await load();
    } catch (err) {
      toastError(err, `${name} failed`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Workspace changes" wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <code className="rounded bg-white/[0.08] px-1.5 py-0.5">{diff?.cwd ?? session.cwd}</code>
          {diff?.branch && <span>branch {diff.branch}</span>}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        {isWorktree && (
          <div className="flex flex-wrap gap-2 rounded-lg border border-white/10 bg-black/25 p-2">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                action('Commit', () => post(`/api/sessions/${session.id}/worktree/commit`, {}), `Committed to ${session.workspace.branch}`)
              }
            >
              <Save className="h-3.5 w-3.5" /> Commit to {session.workspace.branch}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy !== null}
              onClick={() => {
                if (confirm(`Merge ${session.workspace.branch} into the branch checked out in ${session.workspace.baseCwd}?`)) {
                  void action('Merge', () => post(`/api/sessions/${session.id}/worktree/merge`, {}), 'Merged into base repository');
                }
              }}
            >
              <GitMerge className="h-3.5 w-3.5" /> Merge into base
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy !== null}
              onClick={() => {
                if (confirm('Remove the worktree folder? The branch is kept. The session will stop.')) {
                  void action('Remove', () => post(`/api/sessions/${session.id}/worktree/remove`, {}), 'Worktree removed');
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove worktree
            </Button>
            {busy && <Spinner className="self-center" />}
          </div>
        )}
        {loading && !diff && (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        )}
        {diff && !diff.isGitRepo && <p className="text-sm text-slate-400">This folder is not a git repository, so changes cannot be shown.</p>}
        {diff?.isGitRepo && (
          <>
            <UnifiedDiff diff={diff.diff} />
            {diff.truncated && <p className="text-xs text-amber-300">Diff truncated.</p>}
            {diff.untracked.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-400">Untracked files</p>
                <ul className="space-y-0.5 font-mono text-xs text-emerald-300">
                  {diff.untracked.map((f) => (
                    <li key={f}>+ {f}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
