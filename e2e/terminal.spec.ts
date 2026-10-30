import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR, E2E_PORT } from '../playwright.config';

const token = () => fs.readFileSync(path.join(E2E_DATA_DIR, 'local-token'), 'utf8').trim();

/** Terminal grid as rendered, and whether it fits inside its container without clipping. */
async function terminalLayout(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('.xterm')!.parentElement as HTMLElement;
    const screen = document.querySelector('.xterm-screen')!.getBoundingClientRect();
    const viewport = document.querySelector('.xterm-viewport') as HTMLElement;
    const scrollbar = viewport.offsetWidth - viewport.clientWidth;
    return {
      label: document.querySelector('[data-testid="pty-size"]')?.textContent ?? '',
      fits: screen.width <= host.clientWidth - scrollbar + 0.5 && screen.height <= host.clientHeight + 0.5,
      overflow: host.style.overflow,
      atBottom: host.scrollHeight - host.scrollTop - host.clientHeight < 2,
    };
  });
}

async function openTerminal(page: Page, sessionId: string) {
  await page.goto(`/login#token=${token()}`);
  await expect(page.getByRole('heading', { name: 'Your agents, in one place' })).toBeVisible();
  await page.goto(`/sessions/${sessionId}`);
  await expect(page.locator('.xterm-screen')).toBeVisible();
}

test('terminal stays readable when another device takes over its size', async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'opens its own desktop and phone contexts');
  const created = await request.post('/api/sessions', {
    headers: { authorization: `Bearer ${token()}` },
    data: { agentId: 'echo', mode: 'terminal', prompt: 'a long line that wraps differently on a phone than on a wide desktop screen' },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const desktop = await desktopCtx.newPage();
  const phone = await phoneCtx.newPage();

  await openTerminal(desktop, id);
  await expect(desktop.getByTestId('pty-size')).toContainText('sized for this screen');
  await expect(desktop.locator('.xterm-rows')).toContainText('Echo: a long line');

  // Opening it on the phone sizes the PTY for the phone; the desktop renders that exact grid.
  await openTerminal(phone, id);
  await expect(phone.getByTestId('pty-size')).toContainText('sized for this screen');
  const phoneLabel = (await phone.getByTestId('pty-size').textContent())!;
  const phoneGrid = phoneLabel.split(' ')[0];
  await expect(desktop.getByTestId('pty-size')).toContainText(`${phoneGrid} · sized for This computer`);
  await expect(desktop.getByRole('button', { name: 'Fit to this screen' })).toBeVisible();
  expect((await terminalLayout(desktop)).fits).toBe(true);
  expect((await terminalLayout(phone)).fits).toBe(true);

  // Taking it back on the desktop: the phone follows the same grid, shrinking its font to fit or, if even the
  // smallest font is too wide, scrolling with the prompt in view.
  await desktop.getByRole('button', { name: 'Fit to this screen' }).click();
  await expect(desktop.getByTestId('pty-size')).toContainText('sized for this screen');
  await expect(phone.getByRole('button', { name: 'Fit to this screen' })).toBeVisible();
  const desktopGrid = (await desktop.getByTestId('pty-size').textContent())!.split(' ')[0];
  await expect(phone.getByTestId('pty-size')).toContainText(`${desktopGrid} · sized for This computer`);
  await expect
    .poll(async () => {
      const l = await terminalLayout(phone);
      return l.fits || (l.overflow === 'auto' && l.atBottom);
    })
    .toBe(true);
  await expect(phone.locator('.xterm-rows')).toContainText('Echo: a long line that wraps differently');

  // A grid too large even for the smallest font becomes scrollable, with the prompt kept in view.
  const ws = new WebSocket(`ws://127.0.0.1:${E2E_PORT}/ws`);
  await new Promise((resolve) => (ws.onopen = resolve));
  ws.send(JSON.stringify({ type: 'auth', token: token() }));
  await new Promise((r) => setTimeout(r, 300));
  ws.send(JSON.stringify({ type: 'subscribe', sessionId: id, sinceSeq: 1_000_000 }));
  await new Promise((r) => setTimeout(r, 300));
  ws.send(JSON.stringify({ type: 'pty_resize', sessionId: id, cols: 300, rows: 150, claim: true }));
  await expect(phone.getByTestId('pty-size')).toContainText('300×150');
  await expect.poll(async () => (await terminalLayout(phone)).overflow).toBe('auto');
  await expect.poll(async () => (await terminalLayout(phone)).atBottom).toBe(true);

  // When that device leaves, control returns to the most recently active remaining viewer.
  ws.close();
  await expect(desktop.getByTestId('pty-size')).toContainText('sized for this screen');

  await desktopCtx.close();
  await phoneCtx.close();
});
