import { clsx } from 'clsx';
import { Bell, Download, FolderOpen, Laptop, Pencil, RefreshCw, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AgentInfo, AuditEntry, AutoApprove, DelegationPolicy, DeviceInfo, HubSettings, SessionMode } from '@agent-hub/shared/client';
import type { SettingsPatch } from '@agent-hub/shared';
import { DirectoryPicker } from '../components/DirectoryPicker';
import { NetworkCheck } from '../components/NetworkCheck';
import { PairingPanel } from '../components/PairingPanel';
import { AgentAvatar, Button, Card, Field, Select, Spinner, Toggle, inputCls } from '../components/ui';
import { api, del, patch, post } from '../lib/api';
import { currentPushSubscription, disablePush, enablePush, pushSupported } from '../lib/push';
import { isDesktopShell, timeAgo } from '../lib/format';
import { toastError, useHub } from '../lib/store';

const TABS = ['general', 'orchestration', 'agents', 'devices', 'security'] as const;
type Tab = (typeof TABS)[number];

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-slate-400">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

/** A settings row; the whole row is a <label> so the control inside gets its accessible name. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl py-1">
      <span className="min-w-0 flex-1 basis-56">
        <span className="block text-sm text-slate-100">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <span className="flex shrink-0 justify-end">{children}</span>
    </label>
  );
}

function NumberInput({ value, onCommit, min, max }: { value: number; onCommit(v: number): void; min: number; max: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <input
      type="number"
      className={clsx(inputCls, '!w-28 text-right tabular-nums')}
      value={v}
      min={min}
      max={max}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = Number(v);
        if (Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(n);
        else setV(String(value));
      }}
    />
  );
}

function PushControls() {
  const server = useHub((s) => s.server);
  const toast = useHub((s) => s.toast);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    currentPushSubscription()
      .then((s) => setEnabled(Boolean(s)))
      .catch(() => setEnabled(false));
  }, []);
  if (isDesktopShell()) {
    return <p className="text-sm text-slate-400">The desktop app shows native notifications while it runs in the tray.</p>;
  }
  if (!pushSupported()) {
    return (
      <p className="text-sm text-amber-300/90">
        Push notifications need this page to be opened over trusted HTTPS. Install the hub certificate (see Security) and open the LAN
        address, or add the app to your home screen on iOS.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={enabled ? 'secondary' : 'primary'}
        disabled={busy || enabled === null}
        onClick={async () => {
          setBusy(true);
          try {
            if (enabled) {
              await disablePush();
              setEnabled(false);
            } else {
              await enablePush(server!.vapidPublicKey);
              setEnabled(true);
              toast({ tone: 'success', title: 'Notifications enabled on this device' });
            }
          } catch (err) {
            toastError(err, 'Could not change notifications');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Bell className="h-4 w-4" /> {enabled ? 'Disable on this device' : 'Enable on this device'}
      </Button>
      {enabled && (
        <Button
          variant="ghost"
          onClick={() =>
            post<{ delivered: number }>('/api/push/test')
              .then((r) => toast({ tone: 'info', title: `Test sent (${r.delivered} delivered)` }))
              .catch((e) => toastError(e))
          }
        >
          Send test
        </Button>
      )}
    </div>
  );
}

function AgentSettingsCard({ agent, settings, save }: { agent: AgentInfo; settings: HubSettings; save(p: SettingsPatch): void }) {
  const s = settings.agents[agent.id] ?? {};
  const [advanced, setAdvanced] = useState(false);
  const [command, setCommand] = useState(s.command ?? '');
  const [args, setArgs] = useState((s.args ?? []).join(' '));
  const [env, setEnv] = useState(
    Object.entries(s.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  );
  const saveAgent = (p: Record<string, unknown>) => save({ agents: { [agent.id]: p } });
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <AgentAvatar agentId={agent.id} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{agent.name}</p>
          <p className="truncate text-xs text-slate-400">
            {agent.version ?? 'not detected'} {agent.terminal.command && `· ${agent.terminal.command}`}
          </p>
        </div>
        <Toggle checked={agent.enabled} onChange={(v) => saveAgent({ enabled: v })} label="Enabled" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Default mode">
          <Select value={agent.defaultMode} onChange={(e) => saveAgent({ defaultMode: e.target.value as SessionMode })}>
            <option value="structured">Structured (chat)</option>
            <option value="terminal">Terminal</option>
          </Select>
        </Field>
        <Field label="Auto-approve by default">
          <Select value={agent.autoApprove} onChange={(e) => saveAgent({ autoApprove: e.target.value as AutoApprove })}>
            <option value="none">Nothing (ask me)</option>
            <option value="read">Reads & searches</option>
            <option value="edits">Reads & edits</option>
            <option value="all">Everything</option>
          </Select>
        </Field>
      </div>
      {!agent.structured.available && agent.structured.reason && <p className="text-xs text-amber-300">{agent.structured.reason}</p>}
      <button className="min-h-8 text-xs font-medium text-blue-200 hover:text-white hover:underline" onClick={() => setAdvanced(!advanced)}>
        {advanced ? 'Hide' : 'Show'} advanced launch options
      </button>
      {advanced && (
        <div className="space-y-3">
          <Field label="ACP command override" hint="Leave empty to use the built-in launcher.">
            <input className={inputCls} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. copilot" />
          </Field>
          <Field label="Arguments (space separated)">
            <input className={inputCls} value={args} onChange={(e) => setArgs(e.target.value)} placeholder="e.g. --acp" />
          </Field>
          <Field label="Environment variables" hint="One KEY=value per line, e.g. GEMINI_API_KEY=… (stored on the hub).">
            <textarea className={clsx(inputCls, 'min-h-20 font-mono text-xs')} value={env} onChange={(e) => setEnv(e.target.value)} />
          </Field>
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              saveAgent({
                command: command.trim(),
                args: args.trim() ? args.trim().split(/\s+/) : [],
                env: Object.fromEntries(
                  env
                    .split('\n')
                    .map((l) => l.trim())
                    .filter((l) => l.includes('='))
                    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1)]),
                ),
              })
            }
          >
            Save launch options
          </Button>
        </div>
      )}
    </Card>
  );
}

function Devices() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const load = () => api<DeviceInfo[]>('/api/devices').then(setDevices).catch((e) => toastError(e));
  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-4">
      <Section title="Pair a device" description="Phones, tablets and other computers on your network can prompt agents and answer approvals.">
        <PairingPanel />
      </Section>
      <Section title="Paired devices">
        <ul className="divide-y divide-white/[0.06]">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              {d.isLocal ? <Laptop className="h-5 w-5 text-slate-400" /> : <Smartphone className="h-5 w-5 text-slate-400" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {d.name} {d.current && <span className="text-xs text-blue-200">(this device)</span>}
                </p>
                <p className="text-xs text-slate-400">
                  Paired {timeAgo(d.createdAt)} · last seen {timeAgo(d.lastSeenAt)} {d.pushEnabled && '· notifications on'}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Rename"
                onClick={() => {
                  const name = prompt('Device name', d.name);
                  if (name?.trim()) void patch(`/api/devices/${d.id}`, { name: name.trim() }).then(load).catch((e) => toastError(e));
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {!d.isLocal && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-300"
                  aria-label="Revoke"
                  onClick={() => {
                    if (confirm(`Revoke access for "${d.name}"?`)) void del(`/api/devices/${d.id}`).then(load).catch((e) => toastError(e));
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Security() {
  const server = useHub((s) => s.server);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  useEffect(() => {
    api<AuditEntry[]>('/api/audit?limit=100').then(setAudit).catch(() => undefined);
  }, []);
  return (
    <div className="space-y-4">
      <Section title="Network" description="Paired devices connect to these addresses over HTTPS.">
        <ul className="space-y-1 font-mono text-sm">
          {server?.lanUrls.map((u) => (
            <li key={u}>{u}</li>
          ))}
          {!server?.lanUrls.length && <li className="text-slate-400">LAN access disabled</li>}
          <li className="text-slate-400">{server?.localUrl} (this computer only)</li>
        </ul>
        {Boolean(server?.lanUrls.length) && <NetworkCheck />}
      </Section>
      <Section
        title="Hub certificate"
        description="Install this certificate authority on each device once so the HTTPS connection is trusted (required for notifications and installing the app)."
      >
        <p className="break-all font-mono text-xs text-slate-400">SHA-256 {server?.caFingerprint}</p>
        <div className="flex flex-wrap gap-2">
          <a href="/ca.crt" download className="inline-flex">
            <Button>
              <Download className="h-4 w-4" /> Download CA certificate
            </Button>
          </a>
          <a href="/setup" className="inline-flex">
            <Button variant="ghost">Setup instructions</Button>
          </a>
        </div>
      </Section>
      <Section title="Audit log" description="Approvals, pairing and configuration changes.">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-white/[0.06]">
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-slate-400">{new Date(a.ts).toLocaleString()}</td>
                  <td className="py-1.5 pr-2">{a.actor}</td>
                  <td className="py-1.5 pr-2 font-mono text-blue-200">{a.action}</td>
                  <td className="max-w-[16rem] truncate py-1.5 text-slate-400" title={a.detail}>
                    {a.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'general') as Tab;
  const agents = useHub((s) => s.agents);
  const [settings, setSettings] = useState<HubSettings | null>(null);
  const [picker, setPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    api<HubSettings>('/api/settings').then(setSettings).catch((e) => toastError(e));
  }, []);

  const save = async (p: SettingsPatch) => {
    try {
      setSettings(await patch<HubSettings>('/api/settings', p));
    } catch (err) {
      toastError(err, 'Could not save settings');
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="px-1 text-2xl font-semibold tracking-tight">Settings</h1>
      <div role="tablist" className="glass flex gap-1 overflow-x-auto rounded-2xl p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setParams({ tab: t })}
            role="tab"
            aria-selected={tab === t}
            className={clsx('min-h-9 shrink-0 rounded-xl px-3.5 py-1.5 text-sm font-medium capitalize transition-colors duration-200 pointer-coarse:min-h-11', tab === t ? 'bg-white/[0.12] text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.22),0_6px_16px_-10px_rgb(59_130_246/0.8)] ring-1 ring-inset ring-white/15' : 'text-slate-300 hover:text-white')}
          >
            {t}
          </button>
        ))}
      </div>

      {!settings && tab !== 'devices' && tab !== 'security' && (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      )}

      {settings && tab === 'general' && (
        <div className="space-y-4">
          <Section title="Workspace">
            <Field label="Default working directory">
              <div className="flex gap-2">
                <input className={inputCls} value={settings.defaultCwd} readOnly />
                <Button onClick={() => setPicker(true)}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </Field>
          </Section>
          <Section title="Notifications" description="Choose what triggers a notification on paired devices.">
            <PushControls />
            <div className="space-y-3 pt-2">
              {(
                [
                  ['permission', 'Agent needs approval'],
                  ['turnEnd', 'Agent finished responding'],
                  ['task', 'Delegated task finished'],
                  ['error', 'Agent crashed or failed'],
                ] as const
              ).map(([key, label]) => (
                <Row key={key} label={label}>
                  <Toggle checked={settings.notifications[key]} onChange={(v) => save({ notifications: { [key]: v } })} label={label} />
                </Row>
              ))}
            </div>
          </Section>
          <Section title="Approvals">
            <Row label="Approval timeout (seconds)" hint="0 waits forever. When it expires the request is rejected.">
              <NumberInput value={settings.permissions.timeoutSec} min={0} max={86400} onCommit={(v) => save({ permissions: { timeoutSec: v } })} />
            </Row>
          </Section>
        </div>
      )}

      {settings && tab === 'orchestration' && (
        <Section title="Agent-to-agent delegation" description="Guardrails for agents delegating work to each other through the hub MCP tools.">
          <Row label="Default delegation policy" hint="Applied to new sessions; each session can override it.">
            <Select
              className="!w-48"
              value={settings.orchestration.defaultDelegationPolicy}
              onChange={(e) => save({ orchestration: { defaultDelegationPolicy: e.target.value as DelegationPolicy } })}
            >
              <option value="ask">Ask me</option>
              <option value="auto">Allow automatically</option>
              <option value="deny">Not allowed</option>
            </Select>
          </Row>
          <Row label="Maximum delegation depth" hint="How many levels of agents delegating to agents.">
            <NumberInput value={settings.orchestration.maxDepth} min={0} max={10} onCommit={(v) => save({ orchestration: { maxDepth: v } })} />
          </Row>
          <Row label="Maximum concurrent sessions">
            <NumberInput
              value={settings.orchestration.maxConcurrentSessions}
              min={1}
              max={64}
              onCommit={(v) => save({ orchestration: { maxConcurrentSessions: v } })}
            />
          </Row>
          <Row label="Task time limit (seconds)">
            <NumberInput
              value={settings.orchestration.taskTimeoutSec}
              min={30}
              max={86400}
              onCommit={(v) => save({ orchestration: { taskTimeoutSec: v } })}
            />
          </Row>
          <Row label="Loop detection" hint="Reject delegations that repeat an ancestor's prompt to the same agent.">
            <Toggle checked={settings.orchestration.loopDetection} onChange={(v) => save({ orchestration: { loopDetection: v } })} />
          </Row>
        </Section>
      )}

      {settings && tab === 'agents' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await post('/api/agents/refresh').catch((e) => toastError(e));
                setRefreshing(false);
              }}
            >
              <RefreshCw className={clsx('h-4 w-4', refreshing && 'animate-spin')} /> Re-detect agents
            </Button>
          </div>
          {agents.map((a) => (
            <AgentSettingsCard key={a.id} agent={a} settings={settings} save={save} />
          ))}
        </div>
      )}

      {tab === 'devices' && <Devices />}
      {tab === 'security' && <Security />}

      {settings && (
        <DirectoryPicker
          open={picker}
          initial={settings.defaultCwd}
          onClose={() => setPicker(false)}
          onSelect={(p) => {
            setPicker(false);
            void save({ defaultCwd: p });
          }}
        />
      )}
    </div>
  );
}
