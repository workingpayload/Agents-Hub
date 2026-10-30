import { SendHorizonal, Square, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { SessionInfo } from '@agent-hub/shared/client';
import { isSessionActive } from '@agent-hub/shared/client';
import { del, post } from '../lib/api';
import { toastError } from '../lib/store';
import { Button, Spinner } from './ui';

export function Composer({ session }: { session: SessionInfo }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const active = isSessionActive(session.status);
  const busy = session.status === 'running' || session.status === 'awaiting_permission';

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await post(`/api/sessions/${session.id}/prompt`, { text: value });
      setText('');
    } catch (err) {
      toastError(err, 'Could not send prompt');
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.innerWidth >= 640) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="space-y-2">
      {session.queue.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-slate-400">Queued ({session.queue.length}) — sent when the agent is free</p>
          {session.queue.map((q) => (
            <div key={q.id} className="glass-inset flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs text-slate-200">
              <span className="min-w-0 flex-1 truncate">{q.text}</span>
              <button
                className="rounded-full p-1 text-slate-400 transition-colors duration-200 hover:bg-white/10 hover:text-slate-100 pointer-coarse:p-2"
                aria-label="Remove queued prompt"
                onClick={() => del(`/api/sessions/${session.id}/queue/${q.id}`).catch((e) => toastError(e))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="glass glass-rim flex items-end gap-2 rounded-[22px] p-1.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          disabled={!active}
          aria-label="Message"
          placeholder={
            !active
              ? 'Session is not running — restart it to continue'
              : session.mode === 'terminal'
                ? 'Type into the terminal…'
                : busy
                  ? 'Agent is working — your message will be queued…'
                  : 'Message the agent…'
          }
          className="min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-base text-slate-100 placeholder:text-slate-400 focus:outline-none focus-visible:outline-none disabled:opacity-60 sm:text-sm"
        />
        {busy && session.mode === 'structured' && (
          <Button
            variant="secondary"
            size="lg"
            className="h-11 w-11 rounded-2xl px-0"
            title="Cancel the current turn"
            aria-label="Cancel the current turn"
            onClick={() => post(`/api/sessions/${session.id}/cancel`).catch((e) => toastError(e))}
          >
            <Square className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="primary"
          size="lg"
          className="h-11 w-11 rounded-2xl px-0"
          disabled={!text.trim() || !active || sending}
          onClick={send}
          title="Send"
          aria-label="Send"
        >
          {sending ? <Spinner /> : <SendHorizonal className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
