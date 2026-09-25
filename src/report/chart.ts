/**
 * DOM-free SVG line chart (used by the UI and by the Node report generator).
 * Follows the dataviz method: one y-axis, <=3 categorical series in fixed order,
 * 2px lines, recessive grid, legend for >=2 series + direct end labels,
 * hover crosshair via `attachChartHover` (browser) or the report's inline script.
 */

export interface ChartSeries {
  name: string;
  points: Array<[number, number]>;
}

export interface ChartRefLine {
  y: number;
  label: string;
}

export interface LineChartOptions {
  title: string;
  xLabel: string;
  yLabel: string;
  series: ChartSeries[];
  width?: number;
  height?: number;
  refLines?: ChartRefLine[];
  yMin?: number;
  yMax?: number;
  /** Max points per series after decimation. */
  maxPoints?: number;
}

/** Categorical slots (reference palette), assigned in fixed order. */
export const SERIES_VARS = ['--series-1', '--series-2', '--series-3'] as const;

/** CSS for chart roles (light + dark), to be embedded once per page. */
export const CHART_CSS = `
.viz-root{color-scheme:light;--surface-1:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--critical:#d03b3b}
@media (prefers-color-scheme: dark){:root:where(:not([data-theme="light"])) .viz-root{color-scheme:dark;--surface-1:#1a1a19;--text-primary:#ffffff;--text-secondary:#c3c2b7;--text-muted:#898781;--grid:#2c2c2a;--axis:#383835;--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70}}
:root[data-theme="dark"] .viz-root{color-scheme:dark;--surface-1:#1a1a19;--text-primary:#ffffff;--text-secondary:#c3c2b7;--text-muted:#898781;--grid:#2c2c2a;--axis:#383835;--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70}
.viz-root{background:var(--surface-1);border-radius:8px;padding:8px 8px 4px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;position:relative}
.viz-root svg{display:block;width:100%;height:auto}
.viz-title{font-size:13px;font-weight:600;fill:var(--text-primary)}
.viz-axis-label,.viz-tick{font-size:10px;fill:var(--text-muted);font-variant-numeric:tabular-nums}
.viz-legend{font-size:11px;fill:var(--text-secondary)}
.viz-direct{font-size:10px;fill:var(--text-secondary)}
.viz-tip{position:absolute;pointer-events:none;background:var(--surface-1);color:var(--text-primary);border:1px solid var(--axis);border-radius:6px;padding:4px 8px;font-size:11px;white-space:nowrap;display:none;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.viz-tip b{font-weight:600}
`;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const niceStep = (range: number, target: number): number => {
  const raw = range / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
};

const fmt = (v: number, step: number): string => {
  const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(Math.min(4, d));
};

const decimate = (pts: Array<[number, number]>, max: number): Array<[number, number]> => {
  if (pts.length <= max) return pts;
  const stride = pts.length / max;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * stride)]);
  out.push(pts[pts.length - 1]);
  return out;
};

export const lineChartSvg = (o: LineChartOptions): string => {
  const W = o.width ?? 640;
  const H = o.height ?? 240;
  const series = o.series.slice(0, SERIES_VARS.length).map((s) => ({ ...s, points: decimate(s.points, o.maxPoints ?? 600) }));
  const legendH = series.length >= 2 ? 18 : 0;
  const m = { l: 52, r: 70, t: 28 + legendH, b: 36 };
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p[0]);
  const ys = [...all.map((p) => p[1]), ...(o.refLines ?? []).map((r) => r.y)];
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = o.yMin ?? Math.min(...ys), yMax = o.yMax ?? Math.max(...ys);
  if (yMax - yMin < 1e-9) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.06;
  if (o.yMin === undefined) yMin -= yPad;
  if (o.yMax === undefined) yMax += yPad;
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const sx = (x: number): number => m.l + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * pw;
  const sy = (y: number): number => m.t + (1 - (y - yMin) / (yMax - yMin)) * ph;
  const parts: string[] = [];
  parts.push(`<text class="viz-title" x="${m.l}" y="16">${esc(o.title)}</text>`);
  if (series.length >= 2) {
    let lx = m.l;
    series.forEach((s, i) => {
      parts.push(`<line x1="${lx}" y1="${28}" x2="${lx + 16}" y2="${28}" stroke="var(${SERIES_VARS[i]})" stroke-width="2" stroke-linecap="round"/>`);
      parts.push(`<text class="viz-legend" x="${lx + 20}" y="${32}">${esc(s.name)}</text>`);
      lx += 28 + s.name.length * 11;
    });
  }
  const yStep = niceStep(yMax - yMin, 5);
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) {
    parts.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${sy(y).toFixed(1)}" y2="${sy(y).toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>`);
    parts.push(`<text class="viz-tick" x="${m.l - 6}" y="${(sy(y) + 3).toFixed(1)}" text-anchor="end">${fmt(y, yStep)}</text>`);
  }
  const xStep = niceStep(xMax - xMin, 8);
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-9; x += xStep) {
    parts.push(`<text class="viz-tick" x="${sx(x).toFixed(1)}" y="${m.t + ph + 14}" text-anchor="middle">${fmt(x, xStep)}</text>`);
  }
  parts.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="var(--axis)" stroke-width="1"/>`);
  parts.push(`<text class="viz-axis-label" x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle">${esc(o.xLabel)}</text>`);
  parts.push(`<text class="viz-axis-label" transform="translate(12 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle">${esc(o.yLabel)}</text>`);
  for (const r of o.refLines ?? []) {
    parts.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${sy(r.y).toFixed(1)}" y2="${sy(r.y).toFixed(1)}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4 3"/>`);
    parts.push(`<text class="viz-direct" x="${m.l + pw + 4}" y="${(sy(r.y) + 3).toFixed(1)}">${esc(r.label)}</text>`);
  }
  series.forEach((s, i) => {
    if (s.points.length === 0) return;
    const d = s.points.map((p, k) => `${k ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
    parts.push(`<path d="${d}" fill="none" stroke="var(${SERIES_VARS[i]})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    if (series.length >= 2 && series.length <= 4) {
      const last = s.points[s.points.length - 1];
      parts.push(`<text class="viz-direct" x="${(sx(last[0]) + 4).toFixed(1)}" y="${(sy(last[1]) + 3 + i * 11).toFixed(1)}">${esc(s.name)}</text>`);
    }
  });
  // hover layer payload
  const payload = {
    m, pw, ph, xMin, xMax, yMin, yMax, W, H,
    series: series.map((s, i) => ({ name: s.name, color: SERIES_VARS[i], points: s.points.map((p) => [+p[0].toFixed(4), +p[1].toFixed(4)]) })),
    xLabel: o.xLabel, yLabel: o.yLabel,
  };
  parts.push(`<line class="viz-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="var(--text-muted)" stroke-width="1" visibility="hidden"/>`);
  parts.push(`<rect class="viz-hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`);
  return `<div class="viz-root" data-chart='${esc(JSON.stringify(payload)).replace(/'/g, '&#39;')}'><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title)}">${parts.join('')}</svg><div class="viz-tip"></div></div>`;
};

/** Hover script source (browser). Embedded verbatim in reports; UI calls attachChartHover. */
export const CHART_HOVER_JS = `
(function(){
  function attach(root){
    if(root.__vizBound) return; root.__vizBound=true;
    var data=JSON.parse(root.getAttribute('data-chart'));
    var svg=root.querySelector('svg'), hit=root.querySelector('.viz-hit'), cross=root.querySelector('.viz-cross'), tip=root.querySelector('.viz-tip');
    var dots=data.series.map(function(s){var c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('r','4');c.setAttribute('fill','var('+s.color+')');c.setAttribute('stroke','var(--surface-1)');c.setAttribute('stroke-width','2');c.setAttribute('visibility','hidden');svg.appendChild(c);return c;});
    function nearest(pts,x){var lo=0,hi=pts.length-1;while(hi-lo>1){var mid=(lo+hi)>>1;if(pts[mid][0]<x)lo=mid;else hi=mid;}return Math.abs(pts[lo][0]-x)<Math.abs(pts[hi][0]-x)?pts[lo]:pts[hi];}
    hit.addEventListener('mousemove',function(ev){
      var r=svg.getBoundingClientRect(), k=data.W/r.width, px=(ev.clientX-r.left)*k;
      var x=data.xMin+(px-data.m.l)/data.pw*(data.xMax-data.xMin);
      var sx=function(v){return data.m.l+(v-data.xMin)/(data.xMax-data.xMin)*data.pw}, sy=function(v){return data.m.t+(1-(v-data.yMin)/(data.yMax-data.yMin))*data.ph};
      cross.setAttribute('x1',px);cross.setAttribute('x2',px);cross.setAttribute('visibility','visible');
      var html='<b>'+data.xLabel+': '+x.toFixed(2)+'</b>';
      data.series.forEach(function(s,i){if(!s.points.length)return;var p=nearest(s.points,x);dots[i].setAttribute('cx',sx(p[0]));dots[i].setAttribute('cy',sy(p[1]));dots[i].setAttribute('visibility','visible');html+='<br><span style="color:var('+s.color+')">&#9679;</span> '+s.name+': '+p[1].toFixed(3);});
      tip.innerHTML=html;tip.style.display='block';
      var left=(ev.clientX-root.getBoundingClientRect().left)+12; if(left>root.clientWidth-160) left-=180; tip.style.left=left+'px';tip.style.top='36px';
    });
    hit.addEventListener('mouseleave',function(){cross.setAttribute('visibility','hidden');tip.style.display='none';dots.forEach(function(d){d.setAttribute('visibility','hidden')});});
  }
  window.__attachVizHover=function(scope){(scope||document).querySelectorAll('.viz-root[data-chart]').forEach(attach);};
  window.__attachVizHover(document);
})();
`;
