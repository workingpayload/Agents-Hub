import { CheckCircle2, Copy, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NetworkDiagnostics } from '@agent-hub/shared/client';
import { api } from '../lib/api';
import { desktopBridge } from '../lib/format';
import { useHub } from '../lib/store';
import { Button, Spinner } from './ui';

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
    <div className="space-y-2 text-sm">
      {loading && !diag && (
        <p className="flex items-center gap-2 text-slate-400">
          <Spinner className="h-3.5 w-3.5" /> Checking network access…
        </p>
      )}
      {diag?.firewall.allowed === true && (
        <p className="flex items-center gap-2 text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> Windows Firewall allows connections on port {diag.port}
          {diag.networks[0] && ` (${diag.networks.map((n) => `${n.name} · ${n.category}`).join(', ')})`}.
        </p>
      )}
      {blocked && diag && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="flex items-start gap-2 text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Windows Firewall is blocking other devices on{' '}
              <b>
                {(diag.firewall.blockedNetworks ?? []).join(', ')} ({diag.networks.map((n) => n.category).join(', ')} network)
              </b>
              . Phones will see “page not reachable” until port {diag.port} is allowed.
            </span>
          </p>
          {bridge?.fixFirewall ? (
            <Button variant="primary" size="sm" onClick={fix} disabled={fixing}>
              {fixing && <Spinner className="h-3.5 w-3.5" />} Allow through Windows Firewall
            </Button>
          ) : (
            diag.fixCommand && (
              <div className="space-y-1">
                <p className="text-xs text-slate-400">Run this in an administrator PowerShell on the host computer:</p>
                <div className="flex items-start gap-2">
                  <code className="block flex-1 break-all rounded bg-black/35 p-2 font-mono text-[11px] text-slate-200">{diag.fixCommand}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Copy command"
                    onClick={() => navigator.clipboard?.writeText(diag.fixCommand!).then(() => toast({ tone: 'info', title: 'Copied' }))}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          )}
        </div>
      )}
      {diag?.firewall.checked === false && diag.platform === 'win32' && (
        <p className="text-xs text-slate-400">Could not check Windows Firewall: {diag.firewall.error}</p>
      )}
      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer select-none text-slate-300">Phone says “page not reachable”?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Connect the phone to the same Wi-Fi as this computer (not mobile data, a guest network or a VPN).</li>
          <li>Use the address that matches your Wi-Fi (usually 192.168.x.x), including https:// and the port.</li>
          <li>Allow the hub through the firewall (see above). On Windows, mark your home Wi-Fi as a Private network.</li>
          <li>Some routers isolate wireless clients (“AP/client isolation”); turn it off for your home network.</li>
        </ul>
        <Button size="sm" variant="ghost" className="mt-2" onClick={check} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" /> Re-check
        </Button>
      </details>
    </div>
  );
}
