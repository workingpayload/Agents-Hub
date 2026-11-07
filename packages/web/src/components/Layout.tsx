import {
  BellIcon,
  GearSixIcon,
  GitForkIcon,
  SquaresFourIcon,
  StopCircleIcon,
} from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { post } from '../lib/api';
import { toastError, useHub } from '../lib/store';
import { ConfirmDialog, pressable } from './ui';

const NAV = [
  { to: '/', label: 'Agents', icon: SquaresFourIcon, match: (p: string) => p === '/' || p.startsWith('/sessions') },
  { to: '/approvals', label: 'Approvals', icon: BellIcon, match: (p: string) => p.startsWith('/approvals') },
  { to: '/tasks', label: 'Delegations', icon: GitForkIcon, match: (p: string) => p.startsWith('/tasks') },
  { to: '/settings', label: 'Settings', icon: GearSixIcon, match: (p: string) => p.startsWith('/settings') },
];

function useStopAll() {
  const [open, setOpen] = useState(false);
  const toast = useHub((s) => s.toast);
  const stop = async () => {
    try {
      const r = await post<{ stopped: number }>('/api/stop-all');
      toast({ tone: 'warn', title: 'All agents stopped', body: `${r.stopped} session(s) stopped, pending approvals cancelled.` });
      setOpen(false);
    } catch (err) {
      toastError(err);
    }
  };
  const dialog = (
    <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={stop} title="Stop every agent?" confirmLabel="Stop everything">
      This stops all running sessions, cancels delegated tasks and rejects pending approvals.
    </ConfirmDialog>
  );
  return { openDialog: () => setOpen(true), dialog };
}

function PendingBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={clsx('caption-3 rounded-full bg-amber-400 px-2 text-black', className)} aria-label={`${count} pending approvals`}>
      {count}
    </span>
  );
}

function ConnectionDot({ state }: { state: string }) {
  const open = state === 'open';
  const label = open ? 'Connected' : state === 'connecting' ? 'Connecting' : 'Reconnecting';
  return (
    <span role="status" className="caption-4 inline-flex items-center gap-2 text-neutral-300" title={label}>
      <span className={clsx('h-2 w-2 rounded-full', open ? 'bg-emerald-400' : 'live-dot bg-amber-400 text-amber-400')} aria-hidden />
      <span className={clsx(open && 'sr-only')}>{label}</span>
    </span>
  );
}

/** Two bars that fold into an X; only transform and opacity animate. */
function MenuToggle({ open, onClick }: { open: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls="mobile-menu"
      aria-label={open ? 'Close menu' : 'Open menu'}
      className={clsx('relative h-11 w-11 rounded-xl hover:bg-surface-3', pressable)}
    >
      <span
        aria-hidden
        className={clsx(
          'absolute left-3 top-1/2 h-0.5 w-5 rounded-full bg-white transition-transform duration-500 ease-base',
          open ? 'translate-y-0 rotate-45' : '-translate-y-1',
        )}
      />
      <span
        aria-hidden
        className={clsx(
          'absolute left-3 top-1/2 h-0.5 w-5 rounded-full bg-white transition-transform duration-500 ease-base',
          open ? 'translate-y-0 -rotate-45' : 'translate-y-1',
        )}
      />
    </button>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const connection = useHub((s) => s.connection);
  const pending = useHub((s) => Object.keys(s.permissions).length);
  const server = useHub((s) => s.server);
  const { pathname } = useLocation();
  const active = Math.max(0, NAV.findIndex((n) => n.match(pathname)));
  const [menuOpen, setMenuOpen] = useState(false);
  const stopAll = useStopAll();

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="button-sm sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-white focus:px-3 focus:py-2 focus:text-black"
      >
        Skip to content
      </a>

      <header className="fixed inset-x-4 top-4 z-40 flex justify-center">
        <div className="flex w-full items-center gap-2 rounded-2xl border border-surface-4 bg-surface/80 p-2 backdrop-blur-xl md:w-auto">
          <Link to="/" className={clsx('flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-surface-3', pressable)}>
            <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
            <span className="title-4 text-white">Agent Hub</span>
          </Link>

          <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
            {NAV.map((n, i) => (
              <Link
                key={n.to}
                to={n.to}
                aria-current={i === active ? 'page' : undefined}
                className={clsx(
                  'title-4 flex items-center gap-2 rounded-xl px-3 py-2',
                  pressable,
                  i === active ? 'bg-surface-4 text-white' : 'text-neutral-300 hover:bg-surface-3 hover:text-white',
                )}
              >
                <n.icon className="h-4 w-4" weight={i === active ? 'fill' : 'regular'} />
                {n.label}
                {n.to === '/approvals' && <PendingBadge count={pending} />}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-2">
            <ConnectionDot state={connection} />
            <button
              type="button"
              onClick={stopAll.openDialog}
              aria-label="Stop all agents"
              className={clsx('button-sm hidden items-center gap-2 rounded-xl px-3 py-2 text-red-300 hover:bg-red-950 md:inline-flex', pressable)}
            >
              <StopCircleIcon className="h-4 w-4" />
              Stop all
            </button>
            <div className="relative md:hidden">
              <MenuToggle open={menuOpen} onClick={() => setMenuOpen((o) => !o)} />
              {!menuOpen && pending > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-400" aria-hidden />}
            </div>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div id="mobile-menu" className="animate-fade fixed inset-0 z-30 flex flex-col bg-black/90 px-4 pb-[var(--chrome-bottom)] pt-[var(--chrome-top)] backdrop-blur-2xl md:hidden">
          <nav aria-label="Main navigation" className="flex flex-col gap-2 pt-4">
            {NAV.map((n, i) => (
              <Link
                key={n.to}
                to={n.to}
                aria-current={i === active ? 'page' : undefined}
                style={{ ['--delay' as string]: `${Math.min(i * 60, 400)}ms` }}
                className={clsx(
                  'menu-item heading-5 flex items-center gap-4 rounded-2xl px-4 py-3',
                  i === active ? 'bg-surface-3 text-white' : 'text-neutral-300',
                )}
              >
                <n.icon className="h-6 w-6" weight={i === active ? 'fill' : 'regular'} />
                {n.label}
                {n.to === '/approvals' && <PendingBadge count={pending} className="ml-auto" />}
              </Link>
            ))}
          </nav>
          <div className="menu-item mt-auto space-y-4" style={{ ['--delay' as string]: `${Math.min(NAV.length * 60, 400)}ms` }}>
            {server && <p className="caption-4 px-4 text-neutral-400">This device: {server.device.name}</p>}
            <button
              type="button"
              onClick={stopAll.openDialog}
              className={clsx('button-md flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-white hover:bg-red-800', pressable)}
            >
              <StopCircleIcon className="h-5 w-5" />
              Stop all agents
            </button>
          </div>
        </div>
      )}

      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-[var(--chrome-bottom)] pt-[var(--chrome-top)] md:px-6">
        {children}
      </main>
      {stopAll.dialog}
    </div>
  );
}
