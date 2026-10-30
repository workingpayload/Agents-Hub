import { execFile } from 'node:child_process';
import type { NetworkDiagnostics } from '@agent-hub/shared';

const PROFILE_BITS: [number, string][] = [
  [1, 'Domain'],
  [2, 'Private'],
  [4, 'Public'],
];
const CATEGORY_NAME: Record<string, string> = { DomainAuthenticated: 'Domain', Private: 'Private', Public: 'Public' };

function powershell(script: string, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout.toString())),
    );
  });
}

function profilesFromMask(mask: number): string[] {
  return PROFILE_BITS.filter(([bit]) => (mask & bit) !== 0).map(([, name]) => name);
}

/**
 * Windows only: reports the active networks and whether Windows Firewall lets other devices reach the
 * hub's LAN port. Windows creates program rules only for the network profile that was active the first
 * time the app listened, which is the most common reason a phone cannot connect.
 * Uses the HNetCfg.FwPolicy2 COM API because it can read every rule without administrator rights.
 */
export async function diagnoseNetwork(port: number, exePath: string): Promise<NetworkDiagnostics> {
  if (process.platform !== 'win32') {
    return { platform: process.platform, port, networks: [], firewall: { checked: false, allowed: null } };
  }
  const exe = exePath.replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$fw = New-Object -ComObject HNetCfg.FwPolicy2
$active = [int]$fw.CurrentProfileTypes
$disabled = 0
foreach ($bit in 1, 2, 4) { if (($active -band $bit) -and -not $fw.FirewallEnabled($bit)) { $disabled = $disabled -bor $bit } }
$allowMask = 0
foreach ($r in $fw.Rules) {
  if (-not $r.Enabled -or $r.Direction -ne 1 -or $r.Action -ne 1) { continue }
  if ($r.Protocol -ne 6 -and $r.Protocol -ne 256) { continue }
  $portOk = $false
  foreach ($p in ([string]$r.LocalPorts -split ',')) {
    $p = $p.Trim()
    if ($p -eq '*' -or $p -eq '${port}') { $portOk = $true }
    elseif ($p -match '^(\\d+)-(\\d+)$' -and [int]$matches[1] -le ${port} -and [int]$matches[2] -ge ${port}) { $portOk = $true }
  }
  if (-not $portOk) { continue }
  $app = [string]$r.ApplicationName
  if ($app -and ([Environment]::ExpandEnvironmentVariables($app) -ne '${exe}')) { continue }
  $allowMask = $allowMask -bor [int]$r.Profiles
}
$nets = @(Get-NetConnectionProfile | ForEach-Object { @{ name = [string]$_.Name; interface = [string]$_.InterfaceAlias; category = [string]$_.NetworkCategory } })
@{ active = $active; disabled = $disabled; allow = $allowMask; networks = $nets } | ConvertTo-Json -Depth 4 -Compress
`;
  try {
    const raw = JSON.parse((await powershell(script)).trim() || '{}') as {
      active?: number;
      disabled?: number;
      allow?: number;
      networks?: { name: string; interface: string; category: string }[] | { name: string; interface: string; category: string };
    };
    const networks = (Array.isArray(raw.networks) ? raw.networks : raw.networks ? [raw.networks] : []).map((n) => ({
      ...n,
      category: CATEGORY_NAME[n.category] ?? n.category,
    }));
    const okProfiles = new Set(profilesFromMask((raw.allow ?? 0) | (raw.disabled ?? 0)));
    const blockedNetworks = networks.filter((n) => !okProfiles.has(n.category)).map((n) => n.name || n.interface);
    return {
      platform: process.platform,
      port,
      networks,
      firewall: {
        checked: true,
        allowed: networks.length > 0 ? blockedNetworks.length === 0 : profilesFromMask(raw.active ?? 0).every((p) => okProfiles.has(p)),
        profiles: [...okProfiles],
        blockedNetworks,
      },
    };
  } catch (err) {
    return { platform: process.platform, port, networks: [], firewall: { checked: false, allowed: null, error: (err as Error).message } };
  }
}

/** PowerShell command that adds the recommended rule (needs an elevated prompt). */
export function firewallFixCommand(port: number): string {
  return (
    `New-NetFirewallRule -DisplayName 'Agent Hub (LAN)' -Direction Inbound -Protocol TCP -LocalPort ${port} ` +
    `-Action Allow -Profile Private -RemoteAddress LocalSubnet`
  );
}
