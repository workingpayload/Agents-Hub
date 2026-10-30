import { contextBridge, ipcRenderer } from 'electron';

// Minimal, explicit bridge for the web UI running inside the desktop shell.
contextBridge.exposeInMainWorld('agentHubDesktop', {
  setBadge: (count: number) => ipcRenderer.send('agent-hub:badge', Number(count) || 0),
  flash: () => ipcRenderer.send('agent-hub:flash'),
  fixFirewall: (port: number): Promise<boolean> => ipcRenderer.invoke('agent-hub:fix-firewall', Number(port)),
});
