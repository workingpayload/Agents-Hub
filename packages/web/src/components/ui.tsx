import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import type { SessionStatus, TaskStatus } from '@agent-hub/shared/client';
import { AGENT_STYLE, STATUS_STYLE, TASK_STYLE } from '../lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const VARIANTS: Record<Variant, string> = {
  primary: 'liquid-primary text-white',
  secondary:
    'bg-white/[0.07] text-slate-100 ring-1 ring-inset ring-white/12 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12)] hover:bg-white/[0.12]',
  ghost: 'text-slate-300 hover:bg-white/[0.07] hover:text-white',
  danger:
    'bg-red-500/80 text-white ring-1 ring-inset ring-red-300/30 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-10px_rgb(239_68_68/0.8)] hover:bg-red-500',
  success:
    'bg-emerald-500/85 text-white ring-1 ring-inset ring-emerald-200/30 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),0_8px_20px_-10px_rgb(16_185_129/0.8)] hover:bg-emerald-500',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-[background,color,box-shadow,opacity] duration-200 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        size === 'sm' && 'rounded-xl px-2.5 py-1.5 text-xs',
        size === 'md' && 'rounded-xl px-3.5 py-2 text-sm',
        size === 'lg' && 'rounded-2xl px-4 py-2.5 text-base',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

/** Top-level glass panel. Nested content should use `glass-inset` rather than another blurred layer. */
export function Card({ className, children, rim = false }: { className?: string; children: ReactNode; rim?: boolean }) {
  return <div className={clsx('glass rounded-3xl', rim && 'glass-rim', className)}>{children}</div>;
}

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const s = STATUS_STYLE[status];
  const live = status === 'running' || status === 'starting' || status === 'awaiting_permission';
  return (
    <Pill className={s.cls}>
      <span className={clsx('h-1.5 w-1.5 rounded-full bg-current', live && 'status-dot-live')} aria-hidden />
      {s.label}
    </Pill>
  );
}

export function TaskBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STYLE[status];
  return <Pill className={s.cls}>{s.label}</Pill>;
}

export function AgentAvatar({ agentId, size = 'md' }: { agentId: string; size?: 'sm' | 'md' | 'lg' }) {
  const style = AGENT_STYLE[agentId] ?? { color: 'from-slate-400 to-slate-600', short: agentId.slice(0, 2) };
  return (
    <span
      aria-hidden
      className={clsx(
        'relative inline-flex shrink-0 items-center justify-center bg-gradient-to-br font-display font-bold text-white',
        'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.45),inset_0_-4px_8px_-4px_rgb(0_0_0/0.35),0_6px_16px_-8px_rgb(0_0_0/0.8)]',
        style.color,
        size === 'sm' && 'h-7 w-7 rounded-[10px] text-[10px]',
        size === 'md' && 'h-9 w-9 rounded-xl text-xs',
        size === 'lg' && 'h-12 w-12 rounded-2xl text-sm',
      )}
    >
      {style.short}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={clsx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-200">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/** Text inputs: 16px on phones so iOS doesn't zoom on focus. */
export const inputCls =
  'glass-field w-full rounded-xl px-3.5 py-2.5 text-base text-slate-100 placeholder:text-slate-400 transition-[border-color,box-shadow] duration-200 sm:text-sm';

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(inputCls, 'pr-8', className)} {...props} />;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-7 w-12 shrink-0 rounded-full ring-1 ring-inset transition-colors duration-300 ease-out',
        checked ? 'bg-blue-500/80 ring-blue-300/40' : 'bg-white/10 ring-white/15',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-6 w-6 rounded-full bg-gradient-to-b from-white to-slate-200 shadow-[0_2px_6px_rgb(0_0_0/0.45),inset_0_-1px_1px_rgb(0_0_0/0.1)]',
          'transition-[left] duration-300 ease-[var(--ease-liquid)]',
          checked ? 'left-[1.375rem]' : 'left-0.5',
        )}
      />
    </button>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible dialog: traps focus while open and returns it to the opener on close. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(`.modal-body ${FOCUSABLE.split(', ').join(', .modal-body ')}`);
    (first ?? dialog)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#02040c]/60 backdrop-blur-[2px] sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'glass-strong glass-rim animate-rise flex max-h-[92dvh] w-full flex-col rounded-t-[28px] sm:rounded-[28px]',
          wide ? 'sm:max-w-4xl' : 'sm:max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            className="rounded-full p-1.5 text-slate-300 transition-colors duration-200 hover:bg-white/10 hover:text-white pointer-coarse:p-2.5"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="modal-body overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="glass-inset flex flex-col items-center justify-center gap-2 rounded-3xl border-dashed px-6 py-12 text-center">
      {icon && (
        <div className="glass-rim relative mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] text-slate-300">
          {icon}
        </div>
      )}
      <p className="font-display font-medium text-slate-100">{title}</p>
      {children && <div className="max-w-md text-sm text-slate-400">{children}</div>}
    </div>
  );
}
