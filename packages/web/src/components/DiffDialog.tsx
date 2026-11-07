import { ArrowClockwiseIcon, FloppyDiskIcon, GitMergeIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { SessionInfo, WorkspaceDiff } from '@agent-hub/shared/client';
import { api, post } from '../lib/api';
import { toastError, useHub } from '../lib/store';
import { UnifiedDiff } from './DiffView';
import { Button, Dots, Loading, Modal, Skeleton } from './ui';

type Pending = 'merge' | 'remove' | null;

export function DiffDialog({ open, onClose, session }: { open: boolean; onClose(): void; session: SessionInfo }) {
  const toast = useHub((s) => s.toast);
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Pending>(null);
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
    else setConfirming(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session.id]);

  const action = async (name: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(name);
    setConfirming(null);
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
      <div className="space-y-4">
        <div className="caption-4 flex flex-wrap items-center gap-2 text-neutral-400">
          <code className="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-neutral-200">{diff?.cwd ?? session.cwd}</code>
          {diff?.branch && <span>Branch {diff.branch}</span>}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {loading ? <Dots label="Refreshing" /> : <ArrowClockwiseIcon className="h-4 w-4" />} Refresh
          </Button>
        </div>
        {isWorktree && (
          <div className="surface-inset space-y-3 rounded-xl p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => action('Commit', () => post(`/api/sessions/${session.id}/worktree/commit`, {}), `Committed to ${session.workspace.branch}`)}
              >
                <FloppyDiskIcon className="h-4 w-4" /> Commit to {session.workspace.branch}
              </Button>
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => setConfirming('merge')}>
                <GitMergeIcon className="h-4 w-4" /> Merge into base
              </Button>
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => setConfirming('remove')}>
                <TrashIcon className="h-4 w-4" /> Remove worktree
              </Button>
              {busy && <Dots label={`${busy} in progress`} />}
            </div>
            {confirming && (
              <div role="alertdialog" aria-label={confirming === 'merge' ? 'Confirm merge' : 'Confirm removal'} className="animate-rise space-y-3 rounded-lg bg-surface-3 p-3">
                <p className="body-6 text-neutral-200">
                  {confirming === 'merge'
                    ? `Merge ${session.workspace.branch} into the branch checked out in ${session.workspace.baseCwd}?`
                    : 'Remove the worktree folder? The branch is kept and the session stops.'}
                </p>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                  {confirming === 'merge' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => action('Merge', () => post(`/api/sessions/${session.id}/worktree/merge`, {}), 'Merged into base repository')}
                    >
                      Merge branch
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => action('Remove', () => post(`/api/sessions/${session.id}/worktree/remove`, {}), 'Worktree removed')}
                    >
                      Remove folder
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {loading && !diff && (
          <Loading label="Loading changes" className="space-y-2">
            <Skeleton className="h-8 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </Loading>
        )}
        {diff && !diff.isGitRepo && <p className="body-6 text-neutral-400">This folder is not a git repository, so changes cannot be shown.</p>}
        {diff?.isGitRepo && (
          <>
            <UnifiedDiff diff={diff.diff} />
            {diff.truncated && <p className="caption-4 text-amber-300">Diff truncated.</p>}
            {diff.untracked.length > 0 && (
              <div className="space-y-1">
                <p className="title-5 text-neutral-300">Untracked files</p>
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
