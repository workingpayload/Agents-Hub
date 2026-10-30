import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHub, type Toast } from '../lib/store';

const TONE: Record<Toast['tone'], { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: 'text-sky-200' },
  success: { icon: CheckCircle2, cls: 'text-emerald-200' },
  warn: { icon: AlertTriangle, cls: 'text-amber-200' },
  error: { icon: XCircle, cls: 'text-red-200' },
};

export function Toasts() {
  const toasts = useHub((s) => s.toasts);
  const dismiss = useHub((s) => s.dismissToast);
  const navigate = useNavigate();
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3 sm:bottom-5 sm:left-auto sm:right-5 sm:top-auto sm:items-end"
    >
      {toasts.map((t) => {
        const tone = TONE[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="glass-strong glass-rim animate-rise pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl px-4 py-3"
          >
            <tone.icon className={clsx('mt-0.5 h-5 w-5 shrink-0', tone.cls)} aria-hidden />
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (t.url) navigate(t.url);
                dismiss(t.id);
              }}
            >
              <p className="text-sm font-semibold text-slate-50">{t.title}</p>
              {t.body && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-slate-300">{t.body}</p>}
            </button>
            <button
              className="-m-1 rounded-full p-1 text-slate-300 transition-colors duration-200 hover:bg-white/10 hover:text-white pointer-coarse:p-2"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
