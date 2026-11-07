import {
  ArrowClockwiseIcon,
  BellIcon,
  DesktopIcon,
  DeviceMobileIcon,
  DownloadSimpleIcon,
  FolderOpenIcon,
  PencilSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AgentInfo, AuditEntry, AutoApprove, DelegationPolicy, DeviceInfo, HubSettings, SessionMode } from '@agent-hub/shared/client';
import type { SettingsPatch } from '@agent-hub/shared';
import { DirectoryPicker } from '../components/DirectoryPicker';
import { NetworkCheck } from '../components/NetworkCheck';
import { PairingPanel } from '../components/PairingPanel';
import {
  AgentAvatar,
  Button,
  Card,
  ConfirmDialog,
  Dots,
  Field,
  Loading,
  Modal,
  PageHeader,
  Reveal,
  Select,
  Skeleton,
  Tabs,
  Toggle,
  inputCls,
  pressable,
} from '../components/ui';
import { api, del, patch, post } from '../lib/api';
import { currentPushSubscription, disablePush, enablePush, pushSupported } from '../lib/push';
import { isDesktopShell, timeAgo } from '../lib/format';
import { toastError, useHub } from '../lib/store';

const TABS = ['general', 'orchestration', 'agents', 'devices', 'security'] as const;
type Tab = (typeof TABS)[number];

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Reveal>
      <Card className="space-y-6 p-6">
        <div className="space-y-1">
          <h2 className="heading-6 text-white">{title}</h2>
          {description && <p className="body-6 text-neutral-400">{description}</p>}
        </div>
        {children}
      </Card>
    </Reveal>
  );
}

/** A settings row; the whole row is a <label> so the control inside gets its accessible name. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="min-w-0 flex-1 basis-56 space-y-0.5">
        <span className="title-4 block text-neutral-100">{label}</span>
        {hint && <span className="caption-5 block text-neutral-400">{hint}</span>}
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
      className={clsx(inputCls, '!w-28 text-right font-mono tabular-nums')}
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
    return <p className="body-6 text-neutral-400">The desktop app shows native notifications while it runs in the tray.</p>;
  }
  if (!pushSupported()) {
    return (
      <p className="surface-inset body-6 rounded-xl p-3 text-amber-300">
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
              toast({ tone: 'success', title: 'Notifications turned on for this device' });
            }
          } catch (err) {
            toastError(err, 'Could not change notifications');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Dots /> : <BellIcon className="h-4 w-4" />} {enabled ? 'Turn off on this device' : 'Turn on for this device'}
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
    <Reveal>
      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <AgentAvatar agentId={agent.id} />
          <div className="min-w-0 flex-1">
            <p className="title-3 text-white">{agent.name}</p>
            <p className="caption-4 truncate text-neutral-400">
              {agent.version ?? 'Not detected'} {agent.terminal.command && `· ${agent.terminal.command}`}
            </p>
          </div>
          <Toggle checked={agent.enabled} onChange={(v) => saveAgent({ enabled: v })} label={`${agent.name} enabled`} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default mode">
            <Select value={agent.defaultMode} onChange={(e) => saveAgent({ defaultMode: e.target.value as SessionMode })}>
              <option value="structured">Structured (chat)</option>
              <option value="terminal">Terminal</option>
            </Select>
          </Field>
          <Field label="Auto approve by default">
            <Select value={agent.autoApprove} onChange={(e) => saveAgent({ autoApprove: e.target.value as AutoApprove })}>
              <option value="none">Nothing (ask me)</option>
              <option value="read">Reads & searches</option>
              <option value="edits">Reads & edits</option>
              <option value="all">Everything</option>
            </Select>
          </Field>
        </div>
        {!agent.structured.available && agent.structured.reason && <p className="caption-4 text-amber-300">{agent.structured.reason}</p>}
        <button className="link button-sm min-h-8" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          {advanced ? 'Hide' : 'Show'} advanced launch options
        </button>
        {advanced && (
          <div className="surface-inset animate-rise space-y-4 rounded-xl p-4">
            <Field label="ACP command override" hint="Leave empty to use the default launcher.">
              <input className={inputCls} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="copilot" />
            </Field>
            <Field label="Arguments (space separated)">
              <input className={inputCls} value={args} onChange={(e) => setArgs(e.target.value)} placeholder="--acp" />
            </Field>
            <Field label="Environment variables" hint="One KEY=value per line, for example GEMINI_API_KEY=… (stored on the hub).">
              <textarea className={clsx(inputCls, 'min-h-20 font-mono !text-xs')} value={env} onChange={(e) => setEnv(e.target.value)} />
            </Field>
            <Button
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
    </Reveal>
  );
}

function Devices() {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [renaming, setRenaming] = useState<{ device: DeviceInfo; name: string } | null>(null);
  const [revoking, setRevoking] = useState<DeviceInfo | null>(null);
  const load = () => api<DeviceInfo[]>('/api/devices').then(setDevices).catch((e) => toastError(e));
  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-6">
      <Section title="Pair a device" description="Phones, tablets and other computers on your network can prompt agents and answer approvals.">
        <PairingPanel />
      </Section>
      <Section title="Paired devices">
        {devices === null ? (
          <Loading label="Loading devices" className="space-y-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </Loading>
        ) : (
          <ul className="space-y-2">
            {devices.map((d) => (
              <li key={d.id} className="surface-inset flex items-center gap-3 rounded-xl p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-neutral-300">
                  {d.isLocal ? <DesktopIcon className="h-4 w-4" /> : <DeviceMobileIcon className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="title-4 truncate text-white">
                    {d.name} {d.current && <span className="caption-3 text-neutral-400">(this device)</span>}
                  </p>
                  <p className="caption-4 text-neutral-400">
                    Paired {timeAgo(d.createdAt)} · last seen {timeAgo(d.lastSeenAt)} {d.pushEnabled && '· notifications on'}
                  </p>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Rename ${d.name}`} onClick={() => setRenaming({ device: d, name: d.name })}>
                  <PencilSimpleIcon className="h-4 w-4" />
                </Button>
                {!d.isLocal && (
                  <Button size="sm" variant="ghost" className="text-red-300 hover:text-red-200" aria-label={`Revoke ${d.name}`} onClick={() => setRevoking(d)}>
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Modal open={renaming !== null} onClose={() => setRenaming(null)} title="Rename device">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            const name = renaming?.name.trim();
            if (!renaming || !name) return;
            void patch(`/api/devices/${renaming.device.id}`, { name })
              .then(load)
              .then(() => setRenaming(null))
              .catch((err) => toastError(err));
          }}
        >
          <Field label="Device name">
            <input
              className={inputCls}
              value={renaming?.name ?? ''}
              maxLength={80}
              onChange={(e) => setRenaming((r) => r && { ...r, name: e.target.value })}
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!renaming?.name.trim()}>
              Save name
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Revoke this device?"
        confirmLabel="Revoke access"
        onConfirm={() => {
          const d = revoking;
          setRevoking(null);
          if (d) void del(`/api/devices/${d.id}`).then(load).catch((e) => toastError(e));
        }}
      >
        “{revoking?.name}” loses access right away. You can pair it again later with a new PIN.
      </ConfirmDialog>
    </div>
  );
}

function Security() {
  const server = useHub((s) => s.server);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    api<AuditEntry[]>('/api/audit?limit=100')
      .then(setAudit)
      .catch(() => setAudit([]));
  }, []);
  return (
    <div className="space-y-6">
      <Section title="Network" description="Paired devices connect to these addresses over HTTPS.">
        <ul className="body-6 space-y-1 font-mono text-neutral-200">
          {server?.lanUrls.map((u) => (
            <li key={u}>{u}</li>
          ))}
          {!server?.lanUrls.length && <li className="text-neutral-400">LAN access is turned off</li>}
          <li className="text-neutral-400">{server?.localUrl} (this computer only)</li>
        </ul>
        {Boolean(server?.lanUrls.length) && <NetworkCheck />}
      </Section>
      <Section
        title="Hub certificate"
        description="Install this certificate authority on each device once so the HTTPS connection is trusted. Notifications and installing the app both need it."
      >
        <p className="caption-4 break-all font-mono text-neutral-400">SHA-256 {server?.caFingerprint}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/ca.crt"
            download
            className={clsx('button-sm inline-flex items-center gap-2 rounded-xl border border-surface-4 bg-surface-3 px-3 py-2 text-white hover:bg-surface-4', pressable)}
          >
            <DownloadSimpleIcon className="h-4 w-4" /> Download CA certificate
          </a>
          <Link to="/setup" className={clsx('button-sm inline-flex items-center rounded-xl px-3 py-2 text-neutral-300 hover:bg-surface-3 hover:text-white', pressable)}>
            Setup instructions
          </Link>
        </div>
      </Section>
      <Section title="Audit log" description="Approvals, pairing and configuration changes.">
        {audit === null ? (
          <Loading label="Loading audit log" className="space-y-2">
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
          </Loading>
        ) : audit.length === 0 ? (
          <p className="body-6 text-neutral-400">Nothing recorded yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="caption-4 w-full border-separate border-spacing-y-1 text-left">
              <thead className="sr-only">
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="bg-surface-2">
                    <td className="whitespace-nowrap rounded-l-lg py-2 pl-3 pr-2 font-mono text-neutral-400">{new Date(a.ts).toLocaleString()}</td>
                    <td className="py-2 pr-2 text-neutral-200">{a.actor}</td>
                    <td className="py-2 pr-2 font-mono text-blue-300">{a.action}</td>
                    <td className="max-w-64 truncate rounded-r-lg py-2 pr-3 text-neutral-400" title={a.detail}>
                      {a.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <Loading label="Loading settings" className="space-y-6">
      {[0, 1].map((i) => (
        <div key={i} className="surface space-y-4 rounded-2xl p-6">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
      ))}
    </Loading>
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
    <div className="mx-auto max-w-4xl space-y-8 pt-8">
      <div className="animate-rise space-y-6">
        <PageHeader title="Settings" description="Configure this hub, its agents and the devices paired with it." />
        <Tabs label="Settings sections" tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t })} />
      </div>

      {!settings && tab !== 'devices' && tab !== 'security' && <SettingsSkeleton />}

      {settings && tab === 'general' && (
        <div className="space-y-6">
          <Section title="Workspace">
            <Field label="Default working directory">
              <div className="flex gap-2">
                <input className={clsx(inputCls, 'font-mono')} value={settings.defaultCwd} readOnly />
                <Button onClick={() => setPicker(true)} aria-label="Choose folder" title="Choose folder">
                  <FolderOpenIcon className="h-4 w-4" />
                </Button>
              </div>
            </Field>
          </Section>
          <Section title="Notifications" description="Choose what triggers a notification on paired devices.">
            <PushControls />
            <div className="space-y-4">
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
        <Section title="Delegation between agents" description="Guardrails for agents delegating work to each other through the hub MCP tools.">
          <div className="space-y-6">
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
          </div>
        </Section>
      )}

      {settings && tab === 'agents' && (
        <div className="space-y-4">
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
              {refreshing ? <Dots label="Detecting agents" /> : <ArrowClockwiseIcon className="h-4 w-4" />} Detect agents again
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
