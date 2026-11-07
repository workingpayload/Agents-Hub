import { ArrowClockwiseIcon, CheckCircleIcon, CopyIcon, ShieldWarningIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { NetworkDiagnostics } from '@agent-hub/shared/client';
import { api } from '../lib/api';
import { desktopBridge } from '../lib/format';
import { useHub } from '../lib/store';
import { Button, Dots } from './ui';

/** Checks whether other devices can reach the hub (Windows Firewall) and offers a fix plus troubleshooting tips. */
export function NetworkCheck() {
  const toast = useHub((s) => s.toast);
  const [diag, setDiag] = useState<NetworkDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);

  const check = async () => {
    setLoading(true);
    try {
      setDiag(await api<NetworkDiagnostics>('/api/network/diagnostics'));
    } catch {
      // Older hubs have no diagnostics endpoint; the troubleshooting tips below still apply.
      setDiag(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  const bridge = desktopBridge();
  const fix = async () => {
    if (!bridge?.fixFirewall || !diag) return;
    setFixing(true);
    try {
      const ok = await bridge.fixFirewall(diag.port);
      toast(
        ok
          ? { tone: 'success', title: 'Firewall rule added', body: 'Devices on your private network can now connect.' }
          : { tone: 'warn', title: 'Firewall rule not added', body: 'The administrator prompt was declined.' },
      );
      await check();
    } finally {
      setFixing(false);
    }
  };

  const blocked = diag?.firewall.allowed === false;
  return (
    <div className="body-6 space-y-3">
      {loading && !diag && (
        <p role="status" className="flex items-center gap-2 text-neutral-400">
          <Dots label="Checking" /> Checking network access
        </p>
      )}
      {diag?.firewall.allowed === true && (
        <p className="flex items-start gap-2 text-emerald-300">
          <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Windows Firewall allows connections on port <span className="font-mono">{diag.port}</span>
            {diag.networks[0] && ` (${diag.networks.map((n) => `${n.name} · ${n.category}`).join(', ')})`}.
          </span>
        </p>
      )}
      {blocked && diag && (
        <div className="space-y-3 rounded-xl border border-amber-900 bg-surface-2 p-4">
          <p className="flex items-start gap-2 text-amber-200">
            <ShieldWarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Windows Firewall is blocking other devices on{' '}
              <b className="font-semibold">
                {(diag.firewall.blockedNetworks ?? []).join(', ')} ({diag.networks.map((n) => n.category).join(', ')} network)
              </b>
              . Phones will see “page not reachable” until port {diag.port} is allowed.
            </span>
          </p>
          {bridge?.fixFirewall ? (
            <Button variant="primary" size="sm" onClick={fix} disabled={fixing}>
              {fixing && <Dots label="Allowing" />} Allow through Windows Firewall
            </Button>
          ) : (
            diag.fixCommand && (
              <div className="space-y-2">
                <p className="caption-2 text-neutral-400">Run this in an administrator PowerShell on the host computer:</p>
                <div className="flex items-start gap-2">
                  <code className="caption-3 surface-inset block flex-1 break-all rounded-lg p-2 font-mono text-neutral-200">{diag.fixCommand}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Copy command"
                    onClick={() => navigator.clipboard?.writeText(diag.fixCommand!).then(() => toast({ tone: 'info', title: 'Command copied' }))}
                  >
                    <CopyIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          )}
        </div>
      )}
      {diag?.firewall.checked === false && diag.platform === 'win32' && (
        <p className="caption-2 text-neutral-400">Could not check Windows Firewall: {diag.firewall.error}</p>
      )}
      <details className="caption-2 text-neutral-400">
        <summary className="cursor-pointer select-none text-neutral-200">Phone says “page not reachable”?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>Connect the phone to the same home network as this computer (not mobile data, a guest network or a VPN).</li>
          <li>Use the address that matches your network (usually 192.168.x.x), including https:// and the port.</li>
          <li>Allow the hub through the firewall (see above). On Windows, mark your home network as a Private network.</li>
          <li>Some routers isolate wireless clients (“client isolation”); turn it off for your home network.</li>
        </ul>
        <Button size="sm" variant="ghost" className="mt-2" onClick={check} disabled={loading}>
          <ArrowClockwiseIcon className="h-4 w-4" /> Check again
        </Button>
      </details>
    </div>
  );
}
