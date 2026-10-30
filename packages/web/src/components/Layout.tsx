import { clsx } from 'clsx';
import { Bell, GitBranch, LayoutDashboard, OctagonX, Settings, Wifi, WifiOff } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { post } from '../lib/api';
import { toastError, useHub } from '../lib/store';
import { Button, Modal } from './ui';

const NAV = [
  { to: '/', label: 'Agents', icon: LayoutDashboard, match: (p: string) => p === '/' || p.startsWith('/sessions') },
  { to: '/approvals', label: 'Approvals', icon: Bell, match: (p: string) => p.startsWith('/approvals') },
  { to: '/tasks', label: 'Delegations', icon: GitBranch, match: (p: string) => p.startsWith('/tasks') },
  { to: '/settings', label: 'Settings', icon: Settings, match: (p: string) => p.startsWith('/settings') },
];

/** Ambient iridescent light that the glass surfaces refract. */
export function Aurora() {
  return (
    <div className="aurora" aria-hidden>
      <span className="a1" />
      <span className="a2" />
      <span className="a3" />
      <span className="a4" />
    </div>
  );
}

/** A glass "droplet" that glides to the active nav item. */
function useLiquidIndicator(active: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const el = container.querySelector<HTMLElement>(`[data-nav-index="${active}"]`);
      if (!el || !el.offsetWidth) return setRect(null);
      setRect({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [active]);
  return { containerRef, rect };
}

function LiquidIndicator({ rect, className }: { rect: { x: number; y: number; w: number; h: number } | null; className?: string }) {
  if (!rect) return null;
  return (
    <span
      aria-hidden
      className={clsx(
        'pointer-events-none absolute left-0 top-0 z-0 rounded-2xl bg-white/[0.11] ring-1 ring-inset ring-white/15',
        'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),inset_0_-8px_16px_-12px_rgb(59_130_246/0.6),0_10px_24px_-12px_rgb(59_130_246/0.65)]',
        'transition-[transform,width,height] duration-500 ease-[var(--ease-liquid)]',
        className,
      )}
      style={{ transform: `translate(${rect.x}px, ${rect.y}px)`, width: rect.w, height: rect.h }}
    />
  );
}

function StopAllButton() {
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
  return (
    <>
      <Button variant="ghost" size="sm" className="text-red-200 hover:bg-red-500/15 hover:text-red-100" onClick={() => setOpen(true)} aria-label="Stop all agents">
        <OctagonX className="h-4 w-4" />
        <span className="hidden md:inline">Stop all</span>
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Stop every agent?">
        <p className="text-sm text-slate-300">This kill switch stops all running sessions, cancels delegated tasks and rejects pending approvals.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={stop}>
            Stop everything
          </Button>
        </div>
      </Modal>
    </>
  );
}

function PendingBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={clsx(
        'rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1.5 text-[11px] font-bold leading-[18px] text-amber-950',
        'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.6),0_4px_10px_-4px_rgb(245_158_11/0.9)]',
        className,
      )}
      aria-label={`${count} pending approvals`}
    >
      {count}
    </span>
  );
}

function ConnectionChip({ state }: { state: string }) {
  const open = state === 'open';
  return (
    <span
      role="status"
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset',
        open ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/20' : 'bg-amber-400/10 text-amber-100 ring-amber-300/30',
      )}
    >
      {open ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {open ? 'Connected' : state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
    </span>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const connection = useHub((s) => s.connection);
  const pending = useHub((s) => Object.keys(s.permissions).length);
  const server = useHub((s) => s.server);
  const { pathname } = useLocation();
  const active = Math.max(0, NAV.findIndex((n) => n.match(pathname)));
  const side = useLiquidIndicator(active);
  const bottom = useLiquidIndicator(active);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-blue-600 focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside className="glass glass-rim fixed bottom-4 left-4 top-4 z-30 hidden w-60 flex-col rounded-[28px] p-3 md:flex" aria-label="Main navigation">
        <Link to="/" className="mb-6 flex items-center gap-3 rounded-2xl px-2 pt-1">
          <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-xl shadow-[0_8px_20px_-8px_rgb(59_130_246/0.8)]" />
          <div className="min-w-0">
            <p className="font-display text-[17px] font-semibold leading-tight tracking-tight">Agent Hub</p>
            <p className="truncate text-xs text-slate-400">{server?.hostname ?? '…'}</p>
          </div>
        </Link>
        <nav ref={side.containerRef} className="relative space-y-1">
          <LiquidIndicator rect={side.rect} />
          {NAV.map((n, i) => (
            <Link
              key={n.to}
              to={n.to}
              data-nav-index={i}
              aria-current={i === active ? 'page' : undefined}
              className={clsx(
                'relative z-10 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors duration-200',
                i === active ? 'text-white' : 'text-slate-300 hover:bg-white/[0.04] hover:text-white',
              )}
            >
              <n.icon className={clsx('h-[18px] w-[18px]', i === active && 'text-blue-200')} />
              {n.label}
              {n.to === '/approvals' && <PendingBadge count={pending} className="ml-auto" />}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-2 px-1 text-xs text-slate-400">
          <ConnectionChip state={connection} />
          {server && <p className="truncate px-1">This device: {server.device.name}</p>}
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col md:pl-[17rem]">
        <header className="glass sticky top-3 z-30 mx-3 mt-3 flex items-center gap-2 rounded-2xl px-3 py-2 md:mx-4 md:mr-4">
          <Link to="/" className="flex items-center gap-2 md:hidden">
            <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
            <span className="font-display font-semibold tracking-tight">Agent Hub</span>
          </Link>
          <div className={clsx(connection === 'open' && 'max-md:hidden', 'md:ml-1')}>
            <ConnectionChip state={connection} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <StopAllButton />
          </div>
        </header>
        <main id="main" className="flex-1 px-3 pb-[var(--chrome-bottom)] pt-5 md:px-6">
          {children}
        </main>
      </div>

      <nav
        ref={bottom.containerRef}
        aria-label="Main navigation"
        className="glass-strong glass-rim fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-4 rounded-[26px] p-1.5 md:hidden"
      >
        <LiquidIndicator rect={bottom.rect} className="rounded-[20px]" />
        {NAV.map((n, i) => (
          <Link
            key={n.to}
            to={n.to}
            data-nav-index={i}
            aria-current={i === active ? 'page' : undefined}
            className={clsx(
              'relative z-10 flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[20px] text-[11px] font-medium transition-colors duration-200',
              i === active ? 'text-white' : 'text-slate-300',
            )}
          >
            <n.icon className={clsx('h-5 w-5', i === active && 'text-blue-200')} />
            {n.label}
            {n.to === '/approvals' && <PendingBadge count={pending} className="absolute right-[18%] top-1" />}
          </Link>
        ))}
      </nav>
    </div>
  );
}
