import { XIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import {
  createElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import type { SessionStatus, TaskStatus } from '@agent-hub/shared/client';
import { AGENT_STYLE, STATUS_STYLE, TASK_STYLE } from '../lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-white text-black hover:bg-neutral-200',
  secondary: 'border border-surface-4 bg-surface-3 text-white hover:bg-surface-4',
  ghost: 'text-neutral-300 hover:bg-surface-3 hover:text-white',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800',
};

/** Shared interaction states: hover shift, pressed scale, disabled. Focus ring comes from :focus-visible. */
export const pressable =
  'transition-[background-color,color,transform,opacity] duration-300 ease-base active:scale-[0.98] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-40';

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
        'inline-flex items-center justify-center gap-2 whitespace-nowrap pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        pressable,
        size === 'sm' && 'button-sm rounded-lg px-2 py-1',
        size === 'md' && 'button-sm rounded-xl px-3 py-2',
        size === 'lg' && 'button-md rounded-xl px-4 py-2',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

/** Top level panel. Nested blocks use `surface-inset`. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('surface rounded-2xl', className)}>{children}</div>;
}

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={clsx('caption-4 inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5', className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const s = STATUS_STYLE[status];
  const live = status === 'running' || status === 'starting' || status === 'awaiting_permission';
  return (
    <Pill className={s.cls}>
      <span className={clsx('h-2 w-2 rounded-full bg-current', live && 'live-dot')} aria-hidden />
      {s.label}
    </Pill>
  );
}

export function TaskBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STYLE[status];
  return <Pill className={s.cls}>{s.label}</Pill>;
}

export function AgentAvatar({ agentId, size = 'md' }: { agentId: string; size?: 'sm' | 'md' | 'lg' }) {
  const style = AGENT_STYLE[agentId] ?? { color: 'bg-neutral-600', short: agentId.slice(0, 2) };
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex shrink-0 items-center justify-center font-mono text-white',
        style.color,
        size === 'sm' && 'caption-3 h-6 w-6 rounded-md',
        size === 'md' && 'caption-3 h-8 w-8 rounded-lg',
        size === 'lg' && 'body-4 h-10 w-10 rounded-xl',
      )}
    >
      {style.short}
    </span>
  );
}

/** Inline busy indicator for buttons and short inline waits. */
export function Dots({ className, label = 'Working' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={clsx('dots', className)}>
      <span />
      <span />
      <span />
    </span>
  );
}

/** Placeholder block shaped like the content it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('skeleton rounded-lg', className)} />;
}

/** Wraps skeleton blocks so assistive tech hears one "Loading" announcement. */
export function Loading({ label = 'Loading', className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-label={label} className={className}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="title-4 block text-neutral-100">{label}</span>
      {children}
      {hint && <span className="caption-5 block text-neutral-400">{hint}</span>}
    </label>
  );
}

/** Text inputs: 16px on phones so iOS doesn't zoom on focus. */
export const inputCls = 'field body-3 w-full rounded-xl px-3 py-2 text-white placeholder:text-neutral-400 sm:body-6';

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
        'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-[background-color] duration-300 ease-base',
        checked ? 'bg-white' : 'bg-surface-4 hover:bg-surface-3',
      )}
    >
      <span
        className={clsx(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-[transform,background-color] duration-500 ease-base',
          checked ? 'translate-x-5 bg-black' : 'translate-x-0 bg-neutral-300',
        )}
      />
    </button>
  );
}

/** Segmented tab strip used for page level tabs. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
  render,
}: {
  tabs: readonly T[];
  value: T;
  onChange(v: T): void;
  label: string;
  className?: string;
  render?(t: T): ReactNode;
}) {
  return (
    <div role="tablist" aria-label={label} className={clsx('surface flex gap-1 overflow-x-auto rounded-xl p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          role="tab"
          aria-selected={value === t}
          className={clsx(
            'title-4 min-h-8 shrink-0 rounded-lg px-3 py-1 capitalize pointer-coarse:min-h-11',
            pressable,
            value === t ? 'bg-surface-4 text-white' : 'text-neutral-400 hover:bg-surface-3 hover:text-white',
          )}
        >
          {render ? render(t) : t}
        </button>
      ))}
    </div>
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
    <div className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'surface-raised animate-rise flex max-h-[92dvh] w-full flex-col rounded-t-3xl sm:rounded-3xl',
          wide ? 'sm:max-w-4xl' : 'sm:max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-6 pb-4 pt-6">
          <h2 id={titleId} className="heading-6 text-white">
            {title}
          </h2>
          <button
            className={clsx('rounded-full p-2 text-neutral-300 hover:bg-surface-3 hover:text-white', pressable)}
            onClick={onClose}
            aria-label="Close"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="modal-body overflow-y-auto px-6 pb-[max(24px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

/** In app replacement for window.confirm with a specific, calm message. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="body-6 text-neutral-300">{children}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={tone} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="surface flex flex-col items-center justify-center gap-2 rounded-2xl px-6 py-12 text-center">
      {icon && <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-3 text-neutral-200">{icon}</div>}
      <p className="title-3 text-white">{title}</p>
      {children && <div className="body-6 max-w-md text-neutral-400">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Rises 32px and fades in once when it first enters the viewport (B7). */
export function Reveal({
  as = 'div',
  className,
  children,
  ...rest
}: {
  as?: 'div' | 'section' | 'article' | 'aside';
  className?: string;
  children: ReactNode;
  'aria-labelledby'?: string;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return createElement(as, { ref, className: clsx('reveal', visible && 'is-visible', className), ...rest }, children);
}

/** Page heading block shared by the main pages. */
export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[680px] space-y-2">
        <h1 className="heading-5 sm:heading-4 text-white">{title}</h1>
        {description && <p className="body-6 text-neutral-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Section heading inside a page. */
export function SectionTitle({ id, children, action }: { id?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id={id} className="heading-6 text-white">
        {children}
      </h2>
      {action}
    </div>
  );
}
