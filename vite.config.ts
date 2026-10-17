import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/** Generated data, reports and docs the UI loads at run time (copied as-is into the site). */
const STATIC_DIRS = ['out', 'reports', 'docs'];

const MANUAL_CSS = `body{font-family:system-ui,-apple-system,"Segoe UI","Hiragino Sans","Yu Gothic UI",sans-serif;max-width:980px;margin:0 auto;padding:24px 20px 60px;line-height:1.7;color:#1d1d1b;background:#fcfcfb}
img{max-width:100%;border:1px solid #e1e0d9;border-radius:6px}table{border-collapse:collapse;margin:12px 0}th,td{border:1px solid #d6d4cc;padding:4px 10px;text-align:left;vertical-align:top}th{background:#f0efe9}
code{background:#f0efe9;padding:1px 4px;border-radius:3px}pre{background:#f0efe9;padding:12px;overflow:auto}a{color:#1f66c1}header{margin-bottom:16px;font-size:14px}`;

/** Copy the static directories and render docs/manual.md to HTML after the bundle is written. */
const siteContent = (): Plugin => ({
  name: 'dds-site-content',
  apply: 'build',
  closeBundle() {
    for (const d of STATIC_DIRS) if (existsSync(d)) cpSync(d, `dist/${d}`, { recursive: true });
    const md = readFileSync('docs/manual.md', 'utf-8').replace(/\(video\/([^)]+)\.webm\)/g, '(video/$1.webm)');
    const body = marked.parse(md, { async: false });
    writeFileSync(
      'dist/docs/manual.html',
      `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drone Design Studio マニュアル</title><style>${MANUAL_CSS}</style></head><body><header><a href="/">← アプリへ戻る</a> ・ <a href="/reports/index.html">レポート</a> ・ <a href="/notice.html">注意事項・ライセンス</a></header>${body}</body></html>`,
    );
  },
});

export default defineConfig({
  root: '.',
  server: { port: 5173, strictPort: false },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { main: 'index.html', notice: 'notice.html' } },
  },
  plugins: [siteContent()],
});
