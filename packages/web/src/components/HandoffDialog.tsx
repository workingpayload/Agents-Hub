import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionInfo } from '@agent-hub/shared/client';
import { isSessionActive } from '@agent-hub/shared/client';
import { post } from '../lib/api';
import { agentName } from '../lib/format';
import { toastError, useHub } from '../lib/store';
import { Button, Dots, Field, Modal, Select, inputCls } from './ui';

/** Sends output from one session to another agent (existing session or a new one). */
export function HandoffDialog({
  open,
  onClose,
  session,
  defaultText,
}: {
  open: boolean;
  onClose(): void;
  session: SessionInfo;
  defaultText: string;
}) {
  const agents = useHub((s) => s.agents);
  const sessions = useHub((s) => s.sessions);
  const navigate = useNavigate();
  const targets = Object.values(sessions).filter((s) => s.id !== session.id && isSessionActive(s.status) && s.mode === 'structured');
  const [target, setTarget] = useState('');
  const [text, setText] = useState(defaultText);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setText(defaultText);
      setNote('');
      const other = agents.find((a) => a.id !== session.agentId && a.enabled && a.structured.available);
      setTarget(other ? `new:${other.id}` : targets[0] ? `session:${targets[0].id}` : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      const [kind, id] = target.split(':');
      const res = await post<{ sessionId: string }>(`/api/sessions/${session.id}/handoff`, {
        ...(kind === 'new' ? { agentId: id } : { targetSessionId: id }),
        text,
        note: note.trim() || undefined,
      });
      onClose();
      navigate(`/sessions/${res.sessionId}`);
    } catch (err) {
      toastError(err, 'Handoff failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Hand off to another agent">
      <div className="space-y-6">
        <Field label="Send to">
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <optgroup label="New session">
              {agents
                .filter((a) => a.enabled && a.structured.available)
                .map((a) => (
                  <option key={a.id} value={`new:${a.id}`}>
                    New {a.name} session
                  </option>
                ))}
            </optgroup>
            {targets.length > 0 && (
              <optgroup label="Running sessions">
                {targets.map((s) => (
                  <option key={s.id} value={`session:${s.id}`}>
                    {agentName(agents, s.agentId)}: {s.title}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Field label="Instructions for the receiving agent (optional)">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)}           placeholder="Review this plan and implement step 1" />
        </Field>
        <Field label="Content to hand off">
                    <textarea className={`${inputCls} min-h-48 font-mono !text-xs`} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!target || !text.trim() || busy} onClick={submit}>
                      {busy && <Dots label="Handing off" />} Hand off
          </Button>
        </div>
      </div>
    </Modal>
  );
}
