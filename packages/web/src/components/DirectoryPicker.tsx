import { ChevronUp, Folder, GitBranch, HardDrive } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DirectoryListing } from '@agent-hub/shared/client';
import { api } from '../lib/api';
import { Button, Modal, Spinner, inputCls } from './ui';

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
      <div className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(manual);
          }}
        >
          <input className={inputCls} value={manual} onChange={(e) => setManual(e.target.value)} spellCheck={false} />
          <Button type="submit">Go</Button>
        </form>
        {listing && (
          <div className="flex flex-wrap gap-1.5">
            {listing.roots.map((r) => (
              <button key={r} onClick={() => load(r)} className="inline-flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.12]">
                <HardDrive className="h-3 w-3" /> {r}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="max-h-[45dvh] overflow-y-auto rounded-lg border border-white/10">
          {loading && (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          )}
          {!loading && listing && (
            <ul className="divide-y divide-white/[0.06]">
              {listing.parent && (
                <li>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[0.06]" onClick={() => load(listing.parent)}>
                    <ChevronUp className="h-4 w-4 text-slate-400" /> ..
                  </button>
                </li>
              )}
              {listing.entries.map((e) => (
                <li key={e.path}>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[0.06]" onClick={() => load(e.path)}>
                    {e.isGitRepo ? <GitBranch className="h-4 w-4 text-emerald-400" /> : <Folder className="h-4 w-4 text-slate-400" />}
                    <span className="truncate">{e.name}</span>
                  </button>
                </li>
              ))}
              {listing.entries.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-400">No sub-folders</li>}
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
