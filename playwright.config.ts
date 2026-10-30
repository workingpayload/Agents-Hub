import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

export const E2E_DATA_DIR = path.join(os.tmpdir(), 'agent-hub-e2e');
export const E2E_PORT = 17790;

// Uses an installed Edge/Chrome by default so no browser download is required.
const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome');

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    channel,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel } },
    { name: 'phone', use: { ...devices['Pixel 7'], channel } },
  ],
  webServer: {
    command: `node packages/hub/dist/cli.js serve --no-lan --test-agent --local-port ${E2E_PORT} --data-dir "${E2E_DATA_DIR}" --log-level warn`,
    url: `http://127.0.0.1:${E2E_PORT}/api/public/info`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
