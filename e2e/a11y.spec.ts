import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { E2E_DATA_DIR } from '../playwright.config';

const token = () => fs.readFileSync(path.join(E2E_DATA_DIR, 'local-token'), 'utf8').trim();

// Glass surfaces are translucent, so contrast depends on what sits behind them; keep every screen WCAG 2.1 AA.
test('main screens have no WCAG 2.1 AA violations', async ({ page, request }) => {
  const created = await request.post('/api/sessions', {
    headers: { authorization: `Bearer ${token()}` },
    data: { agentId: 'echo', prompt: 'a11y /plan /edit /perm' },
  });
  const { id } = await created.json();

  await page.goto(`/login#token=${token()}`);
  await expect(page.getByRole('heading', { name: 'Your agents, in one place' })).toBeVisible();

  for (const route of ['/', `/sessions/${id}`, '/approvals', '/tasks', '/settings?tab=general', '/settings?tab=devices', '/pair']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).exclude('.xterm').analyze();
    expect(results.violations.map((v) => `${route} ${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  }

  // Leave no pending approvals behind for other tests.
  await request.post(`/api/sessions/${id}/stop`, { headers: { authorization: `Bearer ${token()}` }, data: {} });
});
