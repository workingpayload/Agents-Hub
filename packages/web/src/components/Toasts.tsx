import { CheckCircleIcon, InfoIcon, WarningIcon, XCircleIcon, XIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useHub, type Toast } from '../lib/store';
import { pressable } from './ui';

const TONE: Record<Toast['tone'], { icon: typeof InfoIcon; cls: string }> = {
  info: { icon: InfoIcon, cls: 'text-sky-300' },
  success: { icon: CheckCircleIcon, cls: 'text-emerald-300' },
  warn: { icon: WarningIcon, cls: 'text-amber-300' },
  error: { icon: XCircleIcon, cls: 'text-red-300' },
};

export function Toasts() {
  const toasts = useHub((s) => s.toasts);
  const dismiss = useHub((s) => s.dismissToast);
  const navigate = useNavigate();
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 bottom-[var(--chrome-bottom)] z-[60] flex flex-col items-center gap-2 px-4 sm:left-auto sm:right-6 sm:items-end"
    >
      {toasts.map((t) => {
        const tone = TONE[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="surface-raised animate-rise pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl p-4"
          >
            <tone.icon className={clsx('h-5 w-5 shrink-0', tone.cls)} weight="fill" aria-hidden />
            <button
              className="min-w-0 flex-1 space-y-1 text-left"
              onClick={() => {
                if (t.url) navigate(t.url);
                dismiss(t.id);
              }}
            >
              <p className="title-4 text-white">{t.title}</p>
              {t.body && <p className="caption-4 line-clamp-3 whitespace-pre-wrap text-neutral-300">{t.body}</p>}
            </button>
            <button
              className={clsx('-m-1 rounded-full p-1 text-neutral-300 hover:bg-surface-3 hover:text-white pointer-coarse:p-2', pressable)}
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
