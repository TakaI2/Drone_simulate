/**
 * City simulation (Yokohama Minatomirai): OSM + PLATEAU buildings, urban GNSS degradation, wind profile,
 * route planning among buildings, variant C flights, legal notes, report reports/city.html.
 */
import { readFileSync } from 'node:fs';
import { vDist } from '../src/core/math';
import type { Vec3 } from '../src/core/math';
import { CITY_AREA_MINATOMIRAI as AREA, CITY_PLANNER, GNSS_URBAN, MISSION_DEFAULTS } from '../src/core/presets';
import type { DroneParams } from '../src/core/types';
import { OSM_HEIGHT_RULES as OSM_HEIGHT, polygonArea, toObstacles } from '../src/geo/city';
import { CITY_ROUTE, buildCityModel, cityCourse, cityEnv, cityScenario, citySkyMap, compareHeights, gnssErrorBySky, legalChecks } from '../src/integration/city';
import { lineChartSvg } from '../src/report/chart';
import { renderCityMapSvg } from '../src/report/citymap';
import { esc, figure, renderReport, statusPill, table } from '../src/report/html';
import { createObstacleIndex } from '../src/sim/collision';
import { runScenario } from '../src/sim/scenarios';
import type { ScenarioResult } from '../src/sim/scenarios';
import { createSimulation } from '../src/sim/simulator';
import { fetchOsm, bboxAround, fetchPlateauBuildings } from './city-data';
import { fmt, nowString, writeJson, writeText } from './common';
import { startShooter } from './shot';

const SEEDS = [1, 2, 3, 4, 5];
const ATTRIBUTION = [
  '建物（主）: 「3D 都市モデル（Project PLATEAU）横浜市（2024 年度）」（国土交通省）を加工して作成',
  '建物（比較）・公園: © OpenStreetMap contributors（ODbL）',
];

/** Minimum distance from a polyline (sampled every 1 m) to the obstacles. */
const pathClearance = (pts: Vec3[], idx: ReturnType<typeof createObstacleIndex>): number => {
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const n = Math.max(1, Math.ceil(vDist(pts[i - 1], pts[i])));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t };
      m = Math.min(m, idx.nearest(p).distance);
    }
  }
  return m;
};

const pathLength = (pts: Vec3[]): number => pts.slice(1).reduce((s, p, i) => s + vDist(p, pts[i]), 0);

const main = async (): Promise<void> => {
  const t0 = Date.now();
  // ---------------- data ----------------
  console.log('[city] OSM (Overpass) and PLATEAU (range reads from the city ZIP)…');
  const osm = await fetchOsm(AREA.overpass, bboxAround(AREA.origin.lat, AREA.origin.lon, AREA.halfSize));
  const gml = await fetchPlateauBuildings(AREA.plateau.url, AREA.meshes);
  const m = buildCityModel(AREA, gml, osm.elements);
  console.log(`  PLATEAU ${m.plateau.length} buildings, OSM ${m.osm.length} buildings, parks ${m.parks.length}, ground ${fmt(m.groundElevation, 2)} m`);
  const out = 'out/city';
  writeJson(`${out}/buildings_plateau.json`, { attribution: ATTRIBUTION[0], origin: m.area.origin, buildings: m.plateau });
  writeJson(`${out}/buildings_osm.json`, { attribution: ATTRIBUTION[1], origin: m.area.origin, buildings: m.osm, parks: m.parks });
  const matches = compareHeights(m).filter((x) => x.plateau > 30);
  const named = ['横浜ランドマークタワー', 'クイーンズタワーA棟', 'クイーンズタワーB棟', 'クイーンズタワーC棟', '横浜銀行本店ビル'];
  const landmark = matches.find((x) => x.name === '横浜ランドマークタワー');
  const tagged = matches.filter((x) => x.osmSource === 'tag');
  const heightErr = tagged.map((x) => Math.abs(x.osm - x.plateau));

  // ---------------- sky map / environments ----------------
  const tSky = Date.now();
  const sky = citySkyMap(m);
  const skyMs = Date.now() - tSky;
  const pC = JSON.parse(readFileSync('out/variantC/drone_params.json', 'utf-8')) as DroneParams;

  // ---------------- planning ----------------
  console.log('[city] planning…');
  const idxPlateau = createObstacleIndex(toObstacles(m.plateau), MISSION_DEFAULTS.obstacleIndexCell, MISSION_DEFAULTS.obstacleIndexRange);
  const plan = (source: 'plateau' | 'osm', margin: number) => {
    const t = Date.now();
    const sim = createSimulation({ params: pC, env: cityEnv(m, { profile: false }), course: cityCourse(m, source, margin), seed: 1, estimator: 'filter', idealSensors: false });
    return { source, margin, path: sim.path, ms: Date.now() - t, event: sim.events.find((e) => e.kind === 'plan')?.detail ?? '', clearance: pathClearance(sim.path, idxPlateau), length: pathLength(sim.path) };
  };
  const plans = [plan('plateau', CITY_PLANNER.safetyMarginOpen), plan('plateau', CITY_PLANNER.safetyMarginUrban), plan('osm', CITY_PLANNER.safetyMarginUrban)];
  for (const p of plans) console.log(`  ${p.source} margin ${p.margin}: ${fmt(p.length, 0)} m, clearance to PLATEAU ${fmt(p.clearance, 2)} m, ${p.ms} ms`);

  // ---------------- flights ----------------
  console.log('[city] flights (open-sky GNSS / urban GNSS + wind profile)…');
  const defs = [
    { id: 'GY-3', title: '開けた空の GNSS（安全余裕 3 m）', description: 'GNSS 誤差は屋外の標準（約 1 m）。風 3 m/s 一様', margin: CITY_PLANNER.safetyMarginOpen, urban: false },
    { id: 'GY-4a', title: '都市の GNSS 劣化＋高さの風（安全余裕 3 m、試行）', description: '天空見通しで GNSS 誤差が拡大・ビル谷間で測位断。風は高さのべき乗則', margin: CITY_PLANNER.safetyMarginOpen, urban: true },
    { id: 'GY-4', title: '都市の GNSS 劣化＋高さの風（安全余裕 8 m）', description: 'GY-4a の結果から安全余裕を GNSS 誤差（ビル近傍で数 m）に合わせて拡大', margin: CITY_PLANNER.safetyMarginUrban, urban: true },
  ];
  const courseOf = (d: (typeof defs)[number]) => () => cityCourse(m, 'plateau', d.margin);
  const envOf = (d: (typeof defs)[number]) => () => cityEnv(m, d.urban ? { sky, profile: true } : { profile: false });
  const runs: Array<{ def: (typeof defs)[number]; runs: ScenarioResult[] }> = defs.map((d) => ({ def: d, runs: SEEDS.map((seed) => runScenario(cityScenario(d.id, d.title, d.description, courseOf(d), envOf(d)), pC, { seed })) }));
  for (const r of runs) console.log(`  ${r.def.id} ${r.runs.filter((x) => x.pass).length}/${r.runs.length}`);
  const errBands = gnssErrorBySky(runs[2].runs[0].sim, sky);
  const legal = legalChecks(m, plans[1].path, pC.mass * 1000);

  // ---------------- UI scene ----------------
  writeJson(`${out}/scene.json`, {
    name: m.area.name,
    attribution: ATTRIBUTION,
    scenarios: defs.map((d) => ({ id: d.id, title: d.title, description: d.description, course: courseOf(d)(), env: envOf(d)() })),
  });

  // ---------------- goals ----------------
  const allPass = (id: string): boolean => runs.find((r) => r.def.id === id)!.runs.every((r) => r.pass);
  const count = (id: string): string => `${runs.find((r) => r.def.id === id)!.runs.filter((r) => r.pass).length}/${SEEDS.length}`;
  const p8 = plans[1];
  const goals = [
    { id: 'GY-1', title: '都市データ', criteria: 'OSM・PLATEAU の建物を取得・変換、ランドマークタワーの高さが両データで 5 % 以内', result: `PLATEAU ${m.plateau.length} 棟・OSM ${m.osm.length} 棟、ランドマーク PLATEAU ${fmt(landmark?.plateau ?? NaN, 1)} m / OSM ${fmt(landmark?.osm ?? NaN, 1)} m`, pass: m.plateau.length > 50 && m.osm.length > 50 && !!landmark && Math.abs(landmark.osm - landmark.plateau) / landmark.plateau < 0.05 },
    { id: 'GY-2', title: '建物群の経路計画', criteria: `高度 ${CITY_ROUTE.cruiseAltitude} m 前後、建物までの距離 ≥ 安全余裕 − 格子 ${CITY_PLANNER.resolution / 2} m`, result: `経路 ${fmt(p8.length, 0)} m、最小距離 ${fmt(p8.clearance, 2)} m（余裕 ${p8.margin} m）、計画 ${p8.ms} ms`, pass: p8.path.length > 1 && p8.clearance >= p8.margin - CITY_PLANNER.resolution / 2 },
    { id: 'GY-3', title: '飛行（開けた空の GNSS）', criteria: `${SEEDS.length} シードすべて衝突なし・着陸`, result: count('GY-3'), pass: allPass('GY-3') },
    { id: 'GY-4', title: '飛行（都市の GNSS 劣化＋高さの風）', criteria: `安全余裕 ${CITY_PLANNER.safetyMarginUrban} m で ${SEEDS.length} シードすべて衝突なし・着陸`, result: `余裕 3 m（試行）${count('GY-4a')} → 余裕 8 m ${count('GY-4')}`, pass: allPass('GY-4') },
    { id: 'GY-5', title: '法規チェック', criteria: '高度・公園・DID 等の確認結果を出力', result: legal.map((l) => `${l.item.split('（')[0]}: ${l.status}`).join('、'), pass: legal.length > 0 && legal[0].status === 'ok' },
  ];

  // ---------------- screenshots ----------------
  const shooter = await startShooter();
  const shots = [
    { q: 'capture=1&tab=city&scenario=GY-4&view=iso&scale=40', f: 'city-iso.png', c: 'みなとみらい（PLATEAU LOD1）と版 C の飛行軌跡（機体は表示 40 倍）' },
    { q: 'capture=1&tab=city&scenario=GY-4&view=top&scale=40', f: 'city-top.png', c: '上面：計画経路（オレンジ破線）と実軌跡（青）' },
    { q: 'capture=1&tab=city&scenario=GY-4&view=follow&at=150&scale=1', f: 'city-follow.png', c: '追従視点：高層ビルの間を飛ぶ版 C' },
  ];
  let shotOk = true;
  try {
    for (const s of shots) await shooter.shoot(s.q, `reports/img/${s.f}`, { timeoutMs: 300000 });
  } catch (e) {
    shotOk = false;
    console.error('[city] screenshot failed', e);
  } finally {
    await shooter.close();
  }
  goals.push({ id: 'GY-6', title: 'UI 表示', criteria: '都市タブで都市と飛行を 3D 表示（スクリーンショット）', result: shotOk ? `${shots.length} 枚撮影` : '撮影失敗', pass: shotOk });
  for (const g of goals) console.log(`  ${g.id} ${g.pass ? 'PASS' : 'FAIL'} ${g.result}`);

  // ---------------- figures ----------------
  const hIdx = GNSS_URBAN.heights.indexOf(CITY_ROUTE.cruiseAltitude);
  const flown = runs[2].runs[0].sim.samples.map((s) => s.p);
  const crashRun = runs[1].runs.find((r) => r.crashed);
  writeText('reports/img/city-map-plateau.svg', renderCityMapSvg({
    title: `PLATEAU 建物（${m.plateau.length} 棟）と計画経路`, halfSize: m.area.halfSize, buildings: m.plateau, parks: m.parks,
    paths: [{ name: `安全余裕 ${plans[0].margin} m`, pts: plans[0].path, color: '#eb6834', dashed: true }, { name: `安全余裕 ${p8.margin} m`, pts: p8.path, color: '#2a78d6' }],
    markers: [{ p: CITY_ROUTE.start, label: 'S' }, { p: CITY_ROUTE.goal, label: 'G' }],
  }));
  writeText('reports/img/city-map-osm.svg', renderCityMapSvg({
    title: `OSM 建物（${m.osm.length} 棟、高さタグ ${m.osm.filter((b) => b.heightSource === 'tag').length} 棟）`, halfSize: m.area.halfSize, buildings: m.osm, parks: m.parks,
    paths: [{ name: 'OSM で計画（余裕 8 m）', pts: plans[2].path, color: '#1baf7a' }],
    markers: [{ p: CITY_ROUTE.start, label: 'S' }, { p: CITY_ROUTE.goal, label: 'G' }],
  }));
  writeText('reports/img/city-map-sky.svg', renderCityMapSvg({
    title: `天空見通し率（高度 ${GNSS_URBAN.heights[hIdx]} m、濃いほど空が狭い）と GY-4 の実軌跡`, halfSize: m.area.halfSize, buildings: m.plateau,
    sky: { map: sky, heightIndex: Math.max(0, hIdx) },
    paths: [{ name: 'GY-4 実軌跡', pts: flown, color: '#eb6834' }, ...(crashRun ? [{ name: 'GY-4a 接触した試行', pts: crashRun.sim.samples.map((s) => s.p), color: '#d03b3b', dashed: true }] : [])],
  }));
  const S = runs[2].runs[0].sim.samples.filter((s) => s.phase !== 'arming');
  const chartErr = lineChartSvg({ title: 'GY-4 位置推定誤差（推定 − 真値）', xLabel: '時間 [s]', yLabel: '誤差 [m]', series: [{ name: '水平誤差', points: S.map((s) => [s.t, Math.hypot(s.estP.x - s.p.x, s.estP.y - s.p.y)]) }], yMin: 0 });
  const chartClr = lineChartSvg({ title: 'GY-4 建物までの距離（機体外周から）', xLabel: '時間 [s]', yLabel: '距離 [m]', series: [{ name: '最小距離', points: S.filter((s) => Number.isFinite(s.clearance)).map((s) => [s.t, Math.min(s.clearance, 60)]) }], yMin: 0 });
  const skyStats = GNSS_URBAN.heights.map((h, k) => {
    const layer = sky.data.slice(k * sky.nx * sky.ny, (k + 1) * sky.nx * sky.ny).filter((v) => v > 0).sort((a, b) => a - b);
    return [h, fmt(layer[Math.floor(layer.length * 0.1)], 2), fmt(layer[Math.floor(layer.length / 2)], 2), `${fmt((layer.filter((v) => v < GNSS_URBAN.fMin).length / layer.length) * 100, 1)} %`];
  });

  // ---------------- report ----------------
  const html = renderReport({
    stage: 8,
    title: '都市シミュレーション: 横浜・みなとみらい',
    subtitle: 'PLATEAU と OpenStreetMap の建物を読み込み、ビル街の GNSS 劣化と高さで変わる風の中で版 C の経路計画・飛行を検証',
    generatedAt: nowString(),
    goals,
    sections: [
      { title: '3D 表示', html: `<div class="grid2">${shots.map((s) => figure(`img/${s.f}`, s.c)).join('')}</div>` },
      {
        title: '都市データ',
        html: `${table(['データ', '内容', '取得方法'], [
          ['PLATEAU 横浜市（2024 年度）', `建築物 LOD1（3 次メッシュ ${AREA.meshes.join('・')}、${gml.map((g) => `${fmt(g.bytes / 1e6, 1)} MB`).join(' + ')}）`, '市全体 2.7 GB の ZIP から HTTP Range で該当ファイルだけ取得'],
          ['OpenStreetMap', `建物 ${m.osm.length} 棟（高さタグ ${m.osm.filter((b) => b.heightSource === 'tag').length}、階数から推定 ${m.osm.filter((b) => b.heightSource === 'levels').length}、既定 ${OSM_HEIGHT.defaultHeight} m ${m.osm.filter((b) => b.heightSource === 'default').length}）、公園 ${m.parks.length}`, `Overpass API（${osm.fromCache ? 'キャッシュ' : '取得'}）`],
        ])}
<p>範囲：原点 ${AREA.origin.lat}°N ${AREA.origin.lon}°E を中心に ±${AREA.halfSize} m。地表の基準は PLATEAU 建物の下端標高の中央値（${fmt(m.groundElevation, 2)} m）とし、埋立地で平坦とみなした。</p>
<div class="grid2">${figure('img/city-map-plateau.svg', 'PLATEAU（主データ）')}${figure('img/city-map-osm.svg', 'OSM（比較）')}</div>
<h3>同じ建物の高さ比較（30 m 超）</h3>
${table(['建物', 'PLATEAU [m]', 'OSM [m]', 'OSM の高さの出所'], matches.filter((x) => named.includes(x.name) || x.plateau > 100).slice(0, 14).map((x) => [esc(x.name), fmt(x.plateau, 1), fmt(x.osm, 1), x.osmSource === 'tag' ? '高さタグ' : x.osmSource === 'levels' ? `階数 × ${OSM_HEIGHT.storeyHeight} m` : `既定 ${OSM_HEIGHT.defaultHeight} m`]))}
<p class="note">高さタグのある ${tagged.length} 棟の差：中央値 ${fmt([...heightErr].sort((a, b) => a - b)[Math.floor(heightErr.length / 2)] ?? NaN, 1)} m、最大 ${fmt(Math.max(...heightErr), 1)} m。OSM は高さの欠落を階数や既定値で補うため、低層部・付属棟で誤差が大きい。</p>`,
      },
      {
        title: '経路計画',
        html: `${table(['建物データ', '安全余裕 [m]', '経路長 [m]', '最高高度 [m]', 'PLATEAU 建物までの最小距離 [m]', '計画時間 [ms]', 'A*'], plans.map((p) => [p.source === 'plateau' ? 'PLATEAU' : 'OSM', p.margin, fmt(p.length, 0), fmt(Math.max(...p.path.map((q) => q.z)), 0), fmt(p.clearance, 2), p.ms, esc(p.event)]))}
<p>ボクセル ${CITY_PLANNER.resolution} m、建物は角柱として列単位で膨張（機体半径 ＋ 安全余裕）。巡航高度 ${CITY_ROUTE.cruiseAltitude} m では高層ビルを避けて迂回し、低い建物は上を越える経路になる。${plans[2].clearance < CITY_PLANNER.safetyMarginUrban - 1 ? `<b>OSM で計画した経路を PLATEAU の建物で検証すると、最小距離は ${fmt(plans[2].clearance, 1)} m に減る</b>（OSM の高さ欠落・外形の違い）。` : ''}</p>`,
      },
      {
        title: 'ビル街の GNSS 劣化モデル',
        html: `<p>地点ごとに 24 方位へ光線を伸ばし、建物に遮られない空の割合（天空見通し率 f、仰角 ${GNSS_URBAN.elevationMask}° 以上）を求めた。GNSS の誤差は ${GNSS_URBAN.gain}·(1 − f) だけ拡大し、f < ${GNSS_URBAN.fMin} では測位できないとした（反射波の物理計算ではなく、都市峡谷で数 m〜10 m 超の誤差が出るという報告に合わせた経験的なモデル）。計算 ${skyMs} ms。</p>
${figure('img/city-map-sky.svg', '天空見通し率と飛行軌跡')}
${table(['高度 [m]', '見通し率 下位 10 %', '中央値', '測位断の割合'], skyStats)}
${table(['見通し率', 'サンプル数', '位置推定誤差 RMS [m]'], errBands.map((b) => [esc(b.band), b.n, fmt(b.rms, 2)]))}`,
      },
      {
        title: '飛行',
        html: `${table(['ID', '条件', '乱数', '結果', '判定'], runs.flatMap((r) => r.runs.map((x, i) => [r.def.id, esc(r.def.title), SEEDS[i], esc(x.criteria.map((c) => `${c.label} ${fmt(c.value, 2)}`).join('、')), statusPill(x.pass)])))}
<div class="grid2">${chartErr}${chartClr}</div>
<p><b>試行経過</b>：開けた空を仮定すると安全余裕 3 m で問題なく飛べた（GY-3）が、同じ余裕で都市の GNSS 劣化を入れると ${runs[1].runs.filter((r) => r.crashed).length} / ${SEEDS.length} のシードで建物に接触した（GY-4a）。ビル近傍では位置誤差が数 m に拡大するため、安全余裕を ${CITY_PLANNER.safetyMarginUrban} m に広げて再計画し、全シードで接触なしになった（GY-4）。つまり都市での経路計画の余裕は「機体の大きさ」ではなく「測位誤差」で決まる。</p>
<p class="note">この試行の途中で、長距離飛行後のホバリングで姿勢推定の傾きがずれ、推定速度に 1.4 m/s の偽の値が乗って着陸できない不具合を見つけた。GNSS 補助の傾き補正からジャイロのバイアスも推定するように推定器を修正し、版 A〜C の全ゴールを再検証した。</p>`,
      },
      {
        title: '法規チェック（計画経路・版 C）',
        html: `${table(['項目', '状態', '内容'], legal.map((l) => [esc(l.item), l.status === 'ok' ? statusPill(true) : l.status === 'warn' ? '<span class="pill ng">要注意</span>' : '参考', esc(l.detail)]))}
<p class="note">シミュレーション上の確認であり、実際の飛行可否の判断ではない。実飛行前に最新の法令・条例・施設の規則を必ず確認すること。</p>`,
      },
    ],
    concerns: [
      'GNSS の都市劣化は天空見通し率による経験的なモデル。マルチパス（反射波）の実際の誤差は建物の材質・配置・衛星配置で大きく変わる。実測ログで係数を合わせる必要がある。',
      'ビル風（剥離・吹き下ろし・谷間の加速）は再現していない。高さのべき乗則のみ。高層ビル周辺では局所的に平均風の 1.5〜2 倍の突風があり得る。',
      '樹木・電線・街灯・看板・橋などは建物データに含まれない。低高度の飛行では別途の確認（目視・ToF・カメラ）が必要。',
      `OSM の建物は高さの欠落を推定値（階数 × ${OSM_HEIGHT.storeyHeight} m、既定 ${OSM_HEIGHT.defaultHeight} m）で補っており、経路計画には PLATEAU を使うべき。PLATEAU も年度により更新範囲が異なる。`,
      '水面（運河・海）や地形の起伏は扱っていない（みなとみらいは平坦な埋立地のため影響は小さい）。',
      'みなとみらいは人口が集中し、公園の多くは市の規則でドローン飛行が制限される。本シミュレーションは実際の飛行を勧めるものではない。',
    ],
  });
  writeText('reports/city.html', html);
  writeJson(`${out}/results.json`, { goals, plans: plans.map((p) => ({ source: p.source, margin: p.margin, length: p.length, clearance: p.clearance, ms: p.ms })), flights: runs.map((r) => ({ id: r.def.id, pass: r.runs.map((x) => x.pass), crashed: r.runs.map((x) => x.crashed) })), errBands, legal, buildingArea: m.plateau.reduce((s, b) => s + polygonArea(b.footprint), 0) });
  const pass = goals.every((g) => g.pass);
  console.log(`[city] ${pass ? 'ALL GOALS PASSED' : 'SOME GOALS FAILED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!pass) process.exitCode = 1;
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
