/** Render a generated HTML report to PNG (visual QA). Usage: tsx scripts/view-report.ts reports/stage1.html out.png */
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [, , src, dst] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(pathToFileURL(resolve(src)).href);
await page.waitForTimeout(800);
await page.screenshot({ path: dst, fullPage: true });
await browser.close();
