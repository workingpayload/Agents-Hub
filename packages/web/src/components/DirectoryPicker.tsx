import { ArrowUpIcon, FolderIcon, GitBranchIcon, HardDrivesIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import type { DirectoryListing } from '@agent-hub/shared/client';
import { api } from '../lib/api';
import { Button, Loading, Modal, Skeleton, inputCls, pressable } from './ui';

const rowCls = 'body-6 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-neutral-200 transition-[background-color] duration-300 hover:bg-surface-3 hover:text-white';

export function DirectoryPicker({
  open,
  initial,
  onClose,
  onSelect,
}: {
  open: boolean;
  initial?: string;
  onClose(): void;
  onSelect(path: string): void;
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState('');

  const load = async (p?: string) => {
    setLoading(true);
    setError(null);
    try {
      const l = await api<DirectoryListing>(`/api/fs/list${p ? `?path=${encodeURIComponent(p)}` : ''}`);
      setListing(l);
      setManual(l.path);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Choose working directory">
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(manual);
          }}
        >
          <input
            className={clsx(inputCls, 'font-mono')}
            aria-label="Folder path"
            aria-invalid={Boolean(error)}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            spellCheck={false}
          />
          <Button type="submit">Go</Button>
        </form>
        {error && (
          <p role="alert" className="body-6 text-red-300">
            {error}
          </p>
        )}
        {listing && (
          <div className="flex flex-wrap gap-2">
            {listing.roots.map((r) => (
              <button
                key={r}
                onClick={() => load(r)}
                className={clsx('caption-3 inline-flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 font-mono text-neutral-200 hover:bg-surface-4', pressable)}
              >
                <HardDrivesIcon className="h-3 w-3" /> {r}
              </button>
            ))}
          </div>
        )}
        <div className="surface-inset max-h-[45dvh] overflow-y-auto rounded-xl p-1">
          {loading && (
            <Loading label="Loading folders" className="space-y-1 p-1">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </Loading>
          )}
          {!loading && listing && (
            <ul className="space-y-0.5">
              {listing.parent && (
                <li>
                  <button className={rowCls} onClick={() => load(listing.parent)}>
                    <ArrowUpIcon className="h-4 w-4 text-neutral-400" /> Up one level
                  </button>
                </li>
              )}
              {listing.entries.map((e) => (
                <li key={e.path}>
                  <button className={rowCls} onClick={() => load(e.path)}>
                    {e.isGitRepo ? <GitBranchIcon className="h-4 w-4 text-emerald-400" /> : <FolderIcon className="h-4 w-4 text-neutral-400" />}
                    <span className="truncate">{e.name}</span>
                  </button>
                </li>
              ))}
              {listing.entries.length === 0 && <li className="body-6 px-3 py-4 text-center text-neutral-400">No subfolders</li>}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!listing} onClick={() => listing && onSelect(listing.path)}>
            Use this folder
          </Button>
        </div>
      </div>
    </Modal>
  );
}
