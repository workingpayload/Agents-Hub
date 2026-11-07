import { PaperPlaneRightIcon, StopIcon, XIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useState, type KeyboardEvent } from 'react';
import type { SessionInfo } from '@agent-hub/shared/client';
import { isSessionActive } from '@agent-hub/shared/client';
import { del, post } from '../lib/api';
import { toastError } from '../lib/store';
import { Button, Dots, pressable } from './ui';

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
          <p className="caption-4 text-neutral-400">Queued ({session.queue.length}), sent when the agent is free</p>
          {session.queue.map((q) => (
            <div key={q.id} className="surface caption-3 flex items-center gap-2 rounded-xl py-1 pl-3 pr-1 text-neutral-200">
              <span className="min-w-0 flex-1 truncate">{q.text}</span>
              <button
                className={clsx('rounded-full p-1 text-neutral-400 hover:bg-surface-3 hover:text-white pointer-coarse:p-2', pressable)}
                aria-label="Remove queued prompt"
                onClick={() => del(`/api/sessions/${session.id}/queue/${q.id}`).catch((e) => toastError(e))}
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="field flex items-end gap-2 rounded-2xl p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          disabled={!active}
          aria-label="Message"
          placeholder={
            !active
              ? 'Session is not running. Restart it to continue'
              : session.mode === 'terminal'
                ? 'Type into the terminal…'
                : busy
                  ? 'Agent is working. Your message will be queued…'
                  : 'Message the agent…'
          }
          className="body-3 sm:body-6 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-white placeholder:text-neutral-400 focus:outline-none focus-visible:outline-none disabled:opacity-60"
        />
        {busy && session.mode === 'structured' && (
          <Button
            variant="secondary"
            className="h-10 w-10 px-0"
            title="Cancel the current turn"
            aria-label="Cancel the current turn"
            onClick={() => post(`/api/sessions/${session.id}/cancel`).catch((e) => toastError(e))}
          >
            <StopIcon className="h-4 w-4" weight="fill" />
          </Button>
        )}
        <Button
          variant="primary"
          className="h-10 w-10 px-0"
          disabled={!text.trim() || !active || sending}
          onClick={send}
          title="Send"
          aria-label="Send"
        >
          {sending ? <Dots label="Sending" /> : <PaperPlaneRightIcon className="h-4 w-4" weight="fill" />}
        </Button>
      </div>
    </div>
  );
}
