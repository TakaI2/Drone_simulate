/** Screenshot helper: starts a Vite dev server and captures pages with the installed Chrome. */
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { existsSync } from 'node:fs';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH ?? '',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export interface Shooter {
  shoot: (query: string, file: string, opts?: { width?: number; height?: number; selector?: string; timeoutMs?: number }) => Promise<void>;
  page: () => Page;
  close: () => Promise<void>;
}

export const startShooter = async (): Promise<Shooter> => {
  const server: ViteDevServer = await createServer({ server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer?.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5173;
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('Chrome/Edge が見つかりません。CHROME_PATH を設定してください。');
  const browser: Browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
  const shoot: Shooter['shoot'] = async (query, file, opts = {}) => {
    await page.setViewportSize({ width: opts.width ?? 1500, height: opts.height ?? 900 });
    await page.goto(`http://localhost:${port}/?${query}`);
    await page.waitForSelector('body[data-ready="1"]', { timeout: opts.timeoutMs ?? 120000 });
    await page.waitForTimeout(400);
    if (opts.selector) await page.locator(opts.selector).first().screenshot({ path: file });
    else await page.screenshot({ path: file });
  };
  return { shoot, page: () => page, close: async () => { await browser.close(); await server.close(); } };
};
