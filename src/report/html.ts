import { CHART_CSS, CHART_HOVER_JS } from './chart';

export interface GoalRow {
  id: string;
  title: string;
  criteria: string;
  result: string;
  pass: boolean;
}

export interface ReportSection {
  title: string;
  html: string;
}

export interface ReportPage {
  stage: number;
  title: string;
  subtitle: string;
  generatedAt: string;
  goals: GoalRow[];
  sections: ReportSection[];
  concerns: string[];
  references?: Array<{ name: string; url: string; license: string; usage: string }>;
}

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Status is never color-alone: icon + label. */
export const statusPill = (pass: boolean): string =>
  `<span class="pill ${pass ? 'pass' : 'fail'}">${pass ? '✔ 合格' : '✖ 不合格'}</span>`;

export const table = (head: string[], rows: Array<Array<string | number>>): string =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${typeof c === 'number' ? c : c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;

export const figure = (src: string, caption: string): string =>
  `<figure><img src="${src}" alt="${esc(caption)}"><figcaption>${esc(caption)}</figcaption></figure>`;

const PAGE_CSS = `
:root{--page:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--line:#e1e0d9;--card:#fcfcfb;--good:#0ca30c;--good-text:#006300;--critical:#d03b3b;--accent:#2a78d6}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI","Yu Gothic UI",sans-serif;line-height:1.65;font-size:14px}
header{background:#0d0d0d;color:#fff;padding:18px 32px}
header h1{margin:0;font-size:20px}
header p{margin:4px 0 0;color:#c3c2b7;font-size:13px}
nav.stages{display:flex;gap:6px;padding:8px 32px;background:#1a1a19}
nav.stages a{color:#c3c2b7;text-decoration:none;font-size:12px;padding:4px 10px;border-radius:6px}
nav.stages a.cur{background:#383835;color:#fff}
main{max-width:1180px;margin:0 auto;padding:20px 32px 60px}
h2{font-size:17px;margin:28px 0 10px;padding-bottom:4px;border-bottom:1px solid var(--line)}
h3{font-size:14px;margin:18px 0 6px;color:var(--ink2)}
table{border-collapse:collapse;margin:8px 0 14px;font-size:12.5px;background:var(--card)}
th,td{border:1px solid var(--line);padding:5px 9px;text-align:left;vertical-align:top;font-variant-numeric:tabular-nums}
th{background:#f0efec;color:var(--ink2);font-weight:600}
.pill{display:inline-block;padding:1px 9px;border-radius:10px;font-size:12px;font-weight:600;border:1px solid currentColor;white-space:nowrap}
.pill.pass{color:var(--good-text)}
.pill.fail{color:var(--critical)}
.summary{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:160px}
.tile .v{font-size:26px;font-weight:700}
.tile .l{font-size:12px;color:var(--ink2)}
figure{margin:10px 0 18px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px}
figure img{width:100%;display:block;border-radius:6px}
figcaption{font-size:12px;color:var(--ink2);padding:6px 4px 0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.concern li{margin:4px 0}
code,pre{font-family:ui-monospace,Consolas,monospace;font-size:12px}
pre{background:#f0efec;padding:10px;border-radius:6px;overflow:auto}
.note{color:var(--ink2);font-size:12.5px}
.viz-root{max-width:760px}
.svgbox{background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px;overflow:auto}
`;

const STAGE_NAMES = ['総合', '1 シミュレーション', '2 推進・電気', '3 部品・基板', '4 機体', '5 統合'];

export const renderReport = (r: ReportPage): string => {
  const passCount = r.goals.filter((g) => g.pass).length;
  const allPass = passCount === r.goals.length;
  const nav = STAGE_NAMES.map((n, i) => `<a href="${i === 0 ? 'index.html' : `stage${i}.html`}" class="${i === r.stage ? 'cur' : ''}">${n}</a>`).join('');
  const goals = table(
    ['ID', 'ゴール', '合格基準', '結果', '判定'],
    r.goals.map((g) => [esc(g.id), esc(g.title), esc(g.criteria), esc(g.result), statusPill(g.pass)]),
  );
  const refs = r.references?.length
    ? `<h2>参考にした OSS・資料</h2>${table(['名称', 'ライセンス', '利用方法'], r.references.map((x) => [`<a href="${x.url}">${esc(x.name)}</a>`, esc(x.license), esc(x.usage)]))}`
    : '';
  return `<!doctype html><html lang="ja" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title)}</title><style>${PAGE_CSS}${CHART_CSS}</style></head><body>
<header><h1>${esc(r.title)}</h1><p>${esc(r.subtitle)} | 生成: ${esc(r.generatedAt)}</p></header>
<nav class="stages">${nav}</nav>
<main>
<div class="summary"><div class="tile"><div class="v">${passCount} / ${r.goals.length}</div><div class="l">ゴール合格数</div></div>
<div class="tile"><div class="v">${statusPill(allPass)}</div><div class="l">段階判定</div></div></div>
<h2>ゴール判定</h2>${goals}
${r.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.html}`).join('\n')}
<h2>懸念点・今後の課題</h2><ul class="concern">${r.concerns.map((c) => `<li>${c}</li>`).join('')}</ul>
${refs}
</main><script>${CHART_HOVER_JS}</script></body></html>`;
};
