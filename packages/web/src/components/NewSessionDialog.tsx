import { FolderOpenIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AutoApprove, DelegationPolicy, HubSettings, IsolationMode, SessionInfo, SessionMode } from '@agent-hub/shared/client';
import { api, post } from '../lib/api';
import { toastError, useHub } from '../lib/store';
import { DirectoryPicker } from './DirectoryPicker';
import { Button, Dots, Field, Modal, Select, inputCls, pressable } from './ui';

export function NewSessionDialog({ open, onClose, agentId }: { open: boolean; onClose(): void; agentId?: string }) {
  const agents = useHub((s) => s.agents);
  const navigate = useNavigate();
  const usable = agents.filter((a) => a.enabled && (a.structured.available || a.terminal.available));
  const [agent, setAgent] = useState(agentId ?? '');
  const [mode, setMode] = useState<SessionMode>('structured');
  const [cwd, setCwd] = useState('');
  const [isolation, setIsolation] = useState<IsolationMode>('shared');
  const [autoApprove, setAutoApprove] = useState<AutoApprove>('none');
  const [delegation, setDelegation] = useState<DelegationPolicy>('ask');
  const [prompt, setPrompt] = useState('');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const chosen = agentId ?? usable[0]?.id ?? '';
    setAgent(chosen);
    setPrompt('');
    api<HubSettings>('/api/settings')
      .then((s) => {
        setCwd((c) => c || s.defaultCwd);
        setDelegation(s.orchestration.defaultDelegationPolicy);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId]);

  const info = agents.find((a) => a.id === agent);
  useEffect(() => {
    if (!info) return;
    const preferred = info.defaultMode;
    setMode(info[preferred].available ? preferred : info.structured.available ? 'structured' : 'terminal');
    setAutoApprove(info.autoApprove);
  }, [info?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!agent) return;
    setBusy(true);
    try {
      const s = await post<SessionInfo>('/api/sessions', {
        agentId: agent,
        mode,
        cwd: cwd || undefined,
        isolation,
        autoApprove,
        delegationPolicy: delegation,
        prompt: prompt.trim() || undefined,
      });
      onClose();
      navigate(`/sessions/${s.id}`);
    } catch (err) {
      toastError(err, 'Could not start session');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New agent session">
      <div className="space-y-6">
        <Field label="Agent">
          <Select value={agent} onChange={(e) => setAgent(e.target.value)}>
            {usable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        {info && (
          <Field
            label="Mode"
            hint={
              mode === 'structured'
                ? 'Rich chat with approve and deny buttons, delegation and history.'
                : 'Mirrors the interactive CLI; answer prompts by typing.'
            }
          >
            <div className="grid grid-cols-2 gap-2">
              {(['structured', 'terminal'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={!info[m].available}
                  title={info[m].reason}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={clsx(
                    'title-4 rounded-xl border px-3 py-2',
                    pressable,
                    mode === m ? 'border-white bg-white text-black' : 'border-surface-4 bg-surface-3 text-neutral-200 hover:bg-surface-4',
                  )}
                >
                  {m === 'structured' ? 'Structured (chat)' : 'Terminal'}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Working directory">
          <div className="flex gap-2">
            <input className={clsx(inputCls, 'font-mono')} value={cwd} onChange={(e) => setCwd(e.target.value)} spellCheck={false} />
            <Button onClick={() => setPicker(true)} title="Browse" aria-label="Browse folders">
              <FolderOpenIcon className="h-4 w-4" />
            </Button>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Workspace">
            <Select value={isolation} onChange={(e) => setIsolation(e.target.value as IsolationMode)}>
              <option value="shared">Shared folder</option>
              <option value="worktree">Isolated git worktree</option>
            </Select>
          </Field>
          {mode === 'structured' && (
            <Field label="Auto approve">
              <Select value={autoApprove} onChange={(e) => setAutoApprove(e.target.value as AutoApprove)}>
                <option value="none">Nothing (ask me)</option>
                <option value="read">Reads & searches</option>
                <option value="edits">Reads & edits</option>
                <option value="all">Everything</option>
              </Select>
            </Field>
          )}
          {mode === 'structured' && (
            <Field label="Delegation to other agents">
              <Select value={delegation} onChange={(e) => setDelegation(e.target.value as DelegationPolicy)}>
                <option value="ask">Ask me</option>
                <option value="auto">Allow automatically</option>
                <option value="deny">Not allowed</option>
              </Select>
            </Field>
          )}
        </div>
        <Field label="First prompt (optional)">
          <textarea className={`${inputCls} min-h-24`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should the agent do?" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!agent || busy} onClick={submit}>
            {busy && <Dots label="Starting" />} Start session
          </Button>
        </div>
      </div>
      <DirectoryPicker
        open={picker}
        initial={cwd}
        onClose={() => setPicker(false)}
        onSelect={(p) => {
          setCwd(p);
          setPicker(false);
        }}
      />
    </Modal>
  );
}
