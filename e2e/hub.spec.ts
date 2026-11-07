import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_DATA_DIR } from '../playwright.config';

const token = () => fs.readFileSync(path.join(E2E_DATA_DIR, 'local-token'), 'utf8').trim();
let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  await page.goto(`/login#token=${token()}`);
  await expect(page.getByRole('heading', { name: 'Your agents, in one place' })).toBeVisible();
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

test('start an agent session, approve its permission request and see the result', async ({ page }) => {
  const echo = page.locator('div', { has: page.getByText('Echo Agent (test)', { exact: true }) }).getByRole('button', { name: 'New session' });
  await echo.last().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First prompt (optional)').fill('e2e check /perm');
  await dialog.getByRole('button', { name: 'Start session' }).click();

  await expect(page).toHaveURL(/\/sessions\//);
  await expect(page.getByText('Needs approval')).toBeVisible();
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();

  await expect(page.getByText('Permission granted; command ran.')).toBeVisible();
  await expect(page.getByText('Echo: e2e check /perm')).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();

  await page.getByPlaceholder('Message the agent…').fill('second message');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Echo: second message')).toBeVisible();
});

test('approve a pending request from the approvals inbox', async ({ page, request }) => {
  const auth = { authorization: `Bearer ${token()}` };
  const created = await request.post('/api/sessions', { headers: auth, data: { agentId: 'echo', prompt: 'inbox /perm' } });
  expect(created.status()).toBe(201);
  const session = await created.json();

  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: /Approvals/ }).filter({ visible: true }).first().click();
  // Target this session's request (the permission card is labelled and links to its session).
  const card = page.getByRole('group', { name: /Permission request/ }).filter({ hasText: session.title });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Reject', exact: true }).click();

  await expect
    .poll(async () => {
      const events = await (await request.get(`/api/sessions/${session.id}/events`, { headers: auth })).json();
      return events.some((e: { kind: string; text?: string }) => e.kind === 'agent_message_chunk' && e.text?.includes('Permission denied'));
    })
    .toBe(true);
});
