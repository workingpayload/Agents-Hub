import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, shell, Tray, utilityProcess, type UtilityProcess } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_ID = 'com.agenthub.desktop';
const LOCAL_PORT = Number(process.env.AGENT_HUB_LOCAL_PORT ?? 7780);

interface HubReady {
  type: 'ready';
  localUrl: string;
  loginUrl: string;
  token: string;
  lanUrls: string[];
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let hubProcess: UtilityProcess | null = null;
let hub: HubReady | null = null;
let quitting = false;
let pendingApprovals = 0;

/** Locations differ between `npm run desktop` (monorepo) and the packaged app (staged next to main.cjs). */
function paths() {
  const packaged = path.join(__dirname, '..', 'hub', 'cli.js');
  if (fs.existsSync(packaged)) {
    return { hubCli: packaged, webDir: path.join(__dirname, '..', 'web'), buildDir: path.join(__dirname, '..', 'build') };
  }
  const root = path.resolve(__dirname, '..', '..');
  return {
    hubCli: path.join(root, 'hub', 'dist', 'cli.js'),
    webDir: path.join(root, 'web', 'dist'),
    buildDir: path.join(root, 'desktop', 'build'),
  };
}

function dataDir(): string {
  if (process.env.AGENT_HUB_DATA_DIR) return process.env.AGENT_HUB_DATA_DIR;
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'AgentHub');
  return path.join(os.homedir(), '.agent-hub');
}

function icon(name: string) {
  return nativeImage.createFromPath(path.join(paths().buildDir, name));
}

function lanPort(): number {
  const fromHub = hub?.lanUrls[0] ? Number(new URL(hub.lanUrls[0]).port) : NaN;
  return Number.isInteger(fromHub) && fromHub > 0 ? fromHub : Number(process.env.AGENT_HUB_PORT ?? 7443);
}

/**
 * Adds an inbound Windows Firewall rule for the hub's LAN port on Private networks (local subnet only).
 * Runs elevated, so Windows shows a UAC prompt; resolves false if the user declines.
 */
function allowThroughFirewall(port: number): Promise<boolean> {
  if (process.platform !== 'win32' || !Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(false);
  const inner =
    "Remove-NetFirewallRule -DisplayName 'Agent Hub (LAN)' -ErrorAction SilentlyContinue; " +
    `New-NetFirewallRule -DisplayName 'Agent Hub (LAN)' -Description 'Lets paired devices on your local network reach Agent Hub.' ` +
    `-Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Private -RemoteAddress LocalSubnet | Out-Null`;
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  const outer =
    `try { $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '-NoProfile','-EncodedCommand','${encoded}'; exit $p.ExitCode } catch { exit 1 }`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], { windowsHide: true }, (err) => resolve(!err));
  });
}

/** Reuses a hub that is already running (e.g. started with `agent-hub serve`) instead of starting a second one. */
async function attachToRunningHub(): Promise<HubReady | null> {
  try {
    const res = await net.fetch(`http://127.0.0.1:${LOCAL_PORT}/api/public/info`);
    const info = (await res.json()) as { name?: string };
    if (info.name !== 'Agent Hub') return null;
    const token = fs.readFileSync(path.join(dataDir(), 'local-token'), 'utf8').trim();
    const localUrl = `http://127.0.0.1:${LOCAL_PORT}`;
    return { type: 'ready', localUrl, loginUrl: `${localUrl}/login#token=${encodeURIComponent(token)}`, token, lanUrls: [] };
  } catch {
    return null;
  }
}

function startHub(): Promise<HubReady> {
  const { hubCli, webDir } = paths();
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(hubCli, ['serve', '--electron', '--web-dir', webDir], {
      serviceName: 'Agent Hub daemon',
      stdio: 'pipe',
      env: { ...process.env, AGENT_HUB_LOCAL_PORT: String(LOCAL_PORT) },
    });
    hubProcess = child;
    let output = '';
    const collect = (d: Buffer) => {
      const text = d.toString();
      output = (output + text).slice(-4000);
      process.stdout.write(text);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('message', (msg: HubReady) => {
      if (msg?.type === 'ready') resolve(msg);
    });
    child.on('exit', (code) => {
      hubProcess = null;
      if (!hub) {
        reject(new Error(`Agent Hub failed to start (exit ${code}).\n\n${output.trim().slice(-1500)}`));
        return;
      }
      if (!quitting) {
        void dialog
          .showMessageBox({
            type: 'error',
            title: 'Agent Hub',
            message: 'The Agent Hub daemon stopped unexpectedly.',
            detail: output.trim().slice(-1500),
            buttons: ['Restart', 'Quit'],
          })
          .then(async ({ response }) => {
            if (response === 1) return app.quit();
            hub = await startHub();
            await win?.loadURL(hub.loginUrl);
          });
      }
    });
  });
}

function createWindow(): void {
  if (!hub) return;
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#020617',
    title: 'Agent Hub',
    icon: icon('icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const origin = new URL(hub.localUrl).origin;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== origin) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
  void win.loadURL(hub.loginUrl);
}

function showWindow(route?: string): void {
  if (!win) createWindow();
  if (!win || !hub) return;
  if (route) void win.loadURL(`${hub.localUrl}${route}`);
  win.show();
  win.focus();
}

async function stopAllAgents(): Promise<void> {
  if (!hub) return;
  const res = await net.fetch(`${hub.localUrl}/api/stop-all`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hub.token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const { stopped } = (await res.json()) as { stopped: number };
  void dialog.showMessageBox({ type: 'info', title: 'Agent Hub', message: `Stopped ${stopped} agent session(s).` });
}

function updateTray(): void {
  if (!tray) return;
  tray.setImage(icon(pendingApprovals > 0 ? 'tray-alert.png' : 'tray.png'));
  tray.setToolTip(pendingApprovals > 0 ? `Agent Hub — ${pendingApprovals} approval(s) waiting` : 'Agent Hub');
  const login = app.getLoginItemSettings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Agent Hub', click: () => showWindow() },
      {
        label: pendingApprovals > 0 ? `Review ${pendingApprovals} approval(s)…` : 'Approvals',
        click: () => showWindow('/approvals'),
      },
      { label: 'Pair a device…', click: () => showWindow('/settings?tab=devices') },
      ...(process.platform === 'win32'
        ? [
            {
              label: 'Allow LAN access in Windows Firewall…',
              click: () =>
                void allowThroughFirewall(lanPort()).then((ok) =>
                  dialog.showMessageBox({
                    type: ok ? 'info' : 'warning',
                    title: 'Agent Hub',
                    message: ok
                      ? `Devices on your private network can now reach Agent Hub on port ${lanPort()}.`
                      : 'The firewall rule was not added (the administrator prompt was declined or failed).',
                  }),
                ),
            },
          ]
        : []),
      { type: 'separator' },
      { label: 'Stop all agents', click: () => void stopAllAgents().catch((e) => dialog.showErrorBox('Agent Hub', String(e))) },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: login.openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
        },
      },
      { type: 'separator' },
      { label: 'Quit Agent Hub', click: () => app.quit() },
    ]),
  );
  if (win && process.platform === 'win32') {
    win.setOverlayIcon(pendingApprovals > 0 ? icon('tray-alert.png') : null, pendingApprovals > 0 ? 'Approvals waiting' : '');
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.setAppUserModelId(APP_ID);

  ipcMain.on('agent-hub:badge', (_e, count: number) => {
    pendingApprovals = Math.max(0, Number(count) || 0);
    updateTray();
  });
  ipcMain.on('agent-hub:flash', () => {
    if (win && !win.isFocused()) win.flashFrame(true);
  });
  ipcMain.handle('agent-hub:fix-firewall', (_e, port: number) => allowThroughFirewall(Number(port) || lanPort()));

  app.whenReady().then(async () => {
    try {
      hub = (await attachToRunningHub()) ?? (await startHub());
    } catch (err) {
      dialog.showErrorBox('Agent Hub', (err as Error).message);
      app.exit(1);
      return;
    }
    tray = new Tray(icon('tray.png'));
    tray.on('click', () => showWindow());
    updateTray();
    createWindow();
    if (process.argv.includes('--hidden')) win?.hide();
  });

  app.on('window-all-closed', () => {
    // Keep running in the tray; agents keep working and remote devices stay connected.
  });

  app.on('before-quit', (e) => {
    if (quitting || !hubProcess) {
      quitting = true;
      return;
    }
    e.preventDefault();
    quitting = true;
    const child = hubProcess;
    const timer = setTimeout(() => {
      child.kill();
      app.quit();
    }, 8000);
    child.once('exit', () => {
      clearTimeout(timer);
      app.quit();
    });
    child.postMessage({ type: 'shutdown' });
  });
}
