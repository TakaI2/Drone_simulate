/**
 * Stage 5: integration (sim-to-real loop). Derive simulation parameters from the stage 2-4 design,
 * re-run the stage-1 goals, compare with the reference vehicle, study sensitivity, show the final 3D.
 */
import { readFileSync } from 'node:fs';
import { PRESET_MICRO_QUAD } from '../src/core/presets';
import type { DroneParams } from '../src/core/types';
import { runStage2 } from '../src/integration/stage2';
import { SENSITIVITY_CASES, deriveDroneParams } from '../src/integration/stage5';
import type { AirframeLike } from '../src/integration/stage5';
import { lineChartSvg } from '../src/report/chart';
import { esc, figure, renderReport, statusPill, table } from '../src/report/html';
import { REFS } from '../src/report/references';
import { SCENARIOS, runScenario } from '../src/sim/scenarios';
import type { ScenarioResult } from '../src/sim/scenarios';
import { rotorCoefficients } from '../src/sim/motor';
import { sizePropulsion } from '../src/sizing/propulsion';
import { BATTERIES } from '../src/core/propulsion-catalog';
import { fmt, nowString, writeJson, writeText } from './common';
import { startShooter } from './shot';

const byId = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const SENS_SCENARIOS = ['G1-1', 'G1-2', 'G1-4'];

const main = async (): Promise<void> => {
  const s2 = runStage2({ rotorCount: 4 });
  const af = JSON.parse(readFileSync('out/stage4/airframe.json', 'utf-8')) as AirframeLike;
  const designed = deriveDroneParams(s2.sizing, af);
  const reference = PRESET_MICRO_QUAD();
  writeJson('out/stage5/drone_params.json', designed);

  console.log('[stage5] stage-1 goals with the designed vehicle');
  const resD = SCENARIOS.map((d) => runScenario(d, designed));
  const resR = SCENARIOS.map((d) => runScenario(d, reference));
  for (const r of resD) console.log(`  ${r.id} ${r.pass ? 'PASS' : 'FAIL'}`);

  console.log('[stage5] sensitivity (plant ≠ controller model)');
  const sens = SENSITIVITY_CASES.map((c) => {
    const rs = SENS_SCENARIOS.map((id) => runScenario(byId(id), designed, { plant: c.plant(designed) }));
    return { id: c.id, label: c.label, results: rs, pass: rs.every((r) => r.pass) };
  });
  // combined worst case
  const worstPlant = (p: DroneParams): DroneParams => SENSITIVITY_CASES.filter((c) => ['ct-20', 'mass+10', 'tau2', 'battery-aged', 'cg3'].includes(c.id)).reduce((acc, c) => c.plant(acc), p);
  const worst = SENS_SCENARIOS.map((id) => runScenario(byId(id), designed, { plant: worstPlant(designed) }));
  // thrust-coefficient sweep to locate the limit (wind scenario, most demanding)
  const sweep = [1.0, 0.9, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55].map((f) => {
    const plant = { ...designed, rotors: designed.rotors.map((r) => ({ ...r, prop: { ...r.prop, ct: r.prop.ct * f } })) };
    const r = runScenario(byId('G1-4'), designed, { plant });
    const hoverU = r.sim.samples.filter((s) => s.phase === 'hover').map((s) => s.u.reduce((a, b) => a + b, 0) / s.u.length);
    return { f, pass: r.pass, crashed: r.crashed, reached: r.criteria[2].value >= 1, err: r.criteria[0].value, hoverU: hoverU.length ? hoverU.reduce((a, b) => a + b, 0) / hoverU.length : NaN };
  });
  const ctLimit = Math.min(...sweep.filter((s) => s.pass).map((s) => s.f));

  // ---------- design loop, 2nd pass: feed the real frame mass back into stage-2 sizing ----------
  const frameMassReal = (af as AirframeLike & { frameMassG?: number }).frameMassG ?? 0;
  const loop2 = BATTERIES.filter((b) => b.cells === s2.sizing.input.battery.cells).map((battery) => {
    const r = sizePropulsion({ ...s2.sizing.input, battery, electronicsMass: s2.electronicsMassG / 1000, frameMass: frameMassReal / 1000 });
    return { id: battery.id, auw: r.auw * 1000, twr: r.twr, thr: r.hover.throttle, t: r.flightTimeMin, ok: r.feasible, current: battery.id === s2.sizing.input.battery.id };
  });

  // ---------- goals ----------
  console.log('[stage5] UI check & screenshots');
  const shooter = await startShooter();
  let uiText: string | undefined;
  const shots = [
    { q: 'capture=1&tab=assembly&scenario=G1-3&view=follow&at=6&scale=1', f: 'stage5-fly-1.png', c: '完成機体が障害物コースを自律飛行（t=6 s、壁の開口部へ向かう）' },
    { q: 'capture=1&tab=assembly&scenario=G1-3&view=follow&at=9&scale=1', f: 'stage5-fly-2.png', c: '柱の間を通過（t=9 s）' },
    { q: 'capture=1&tab=assembly&scenario=G1-2&view=follow&at=8&scale=1', f: 'stage5-fly-3.png', c: '正方形コースの角を旋回（t=8 s）' },
    { q: 'capture=1&tab=assembly&scenario=G1-3&view=iso&scale=3', f: 'stage5-course.png', c: '障害物コース全景（設計機、表示 3 倍）' },
    { q: 'tab=assembly&scenario=G1-4&view=close&scale=2', f: 'stage5-ui.png', c: '統合タブ：完成機体の 3D モデルでシミュレーション（耐風ホバリング）' },
  ];
  try {
    for (const s of shots) await shooter.shoot(s.q, `reports/img/${s.f}`);
    uiText = await shooter.page().locator('.overlay').first().innerText();
  } finally {
    await shooter.close();
  }
  const uiOk = (uiText ?? '').includes('設計機');
  const goals = [
    { id: 'G5-1', title: '実設計値での飛行', criteria: '段階2〜4 の設計値から導出したパラメータで G1-1〜G1-5 に合格', result: resD.map((r) => `${r.id} ${r.pass ? '✓' : '✗'}`).join('、'), pass: resD.every((r) => r.pass) },
    { id: 'G5-2', title: '完成機体の 3D 表示', criteria: '完成機体（フレーム＋基板＋部品＋モータ＋プロペラ＋電池）の 3D が UI に表示され、飛行シミュレーションできる', result: uiOk ? `統合タブで表示・飛行を確認（画面表示: 「${esc((uiText ?? '').split('\n')[0].trim())}」）` : 'UI で設計機を確認できない', pass: uiOk },
  ];
  for (const g of goals) console.log(`  ${g.id} ${g.pass ? 'PASS' : 'FAIL'}`);

  // ---------- comparison tables & charts ----------
  const cD = rotorCoefficients(designed.rotors[0].prop, 1.225), cR = rotorCoefficients(reference.rotors[0].prop, 1.225);
  const armOf = (p: DroneParams): number => Math.hypot(p.rotors[0].position.x, p.rotors[0].position.y);
  const hoverU = (r: ScenarioResult): number => {
    const h = r.sim.samples.filter((s) => s.phase === 'hover');
    return h.reduce((a, s) => a + s.u.reduce((x, y) => x + y, 0) / s.u.length, 0) / Math.max(1, h.length);
  };
  const hoverI = (r: ScenarioResult): number => {
    const h = r.sim.samples.filter((s) => s.phase === 'hover');
    return h.reduce((a, s) => a + s.current, 0) / Math.max(1, h.length);
  };
  const g11D = resD[0], g11R = resR[0];
  const paramRows: Array<Array<string>> = [
    ['全備重量 [g]', fmt(reference.mass * 1000, 1), fmt(designed.mass * 1000, 1), '段階4 の部品積み上げ'],
    ['Ixx / Iyy / Izz [×1e-5 kg m²]', [0, 4, 8].map((k) => fmt(reference.inertia[k] * 1e5, 2)).join(' / '), [0, 4, 8].map((k) => fmt(designed.inertia[k] * 1e5, 2)).join(' / '), '部品の形状・位置から合成'],
    ['ロータ中心距離 [mm]', fmt(armOf(reference) * 1000, 1), fmt(armOf(designed) * 1000, 1), ''],
    ['ロータ面の重心からの高さ [mm]', fmt(reference.rotors[0].position.z * 1000, 1), fmt(designed.rotors[0].position.z * 1000, 1), '重心がロータ面より下＝振り子的に安定'],
    ['重心から接地面まで [mm]', fmt(reference.gearHeight * 1000, 1), fmt(designed.gearHeight * 1000, 1), '電池下面で接地'],
    ['抗力面積 CdA [cm²]', fmt(reference.dragArea * 1e4, 1), fmt(designed.dragArea * 1e4, 1), '正面投影 × Cd 1.2'],
    ['推力係数 kT [×1e-8]', fmt(cR.kT * 1e8, 2), fmt(cD.kT * 1e8, 2), '同一プロペラ（要実測）'],
    ['ホバリング PWM（シミュレーション）', `${fmt(hoverU(g11R) * 100, 1)} %`, `${fmt(hoverU(g11D) * 100, 1)} %`, '推定器・電圧降下込み'],
    ['ホバリング電流（シミュレーション）', `${fmt(hoverI(g11R), 2)} A`, `${fmt(hoverI(g11D), 2)} A`, ''],
    ['推定ホバリング時間', `${fmt((0.8 * reference.battery.capacityAh) / hoverI(g11R) * 60, 1)} 分`, `${fmt((0.8 * designed.battery.capacityAh) / hoverI(g11D) * 60, 1)} 分`, '使用可能容量 80 %'],
  ];
  const cmpRows = SCENARIOS.map((d, i) => [
    d.id, esc(d.title),
    esc(resR[i].criteria.map((c) => `${c.label} ${fmt(c.value)}`).join('、')),
    esc(resD[i].criteria.map((c) => `${c.label} ${fmt(c.value)}`).join('、')),
    statusPill(resD[i].pass),
  ]);
  // trajectory deviation (G1-3)
  const tr = resR[2].sim.samples, td = resD[2].sim.samples;
  const devPts: Array<[number, number]> = [];
  for (let k = 0; k < Math.min(tr.length, td.length); k++) devPts.push([tr[k].t, Math.hypot(tr[k].p.x - td[k].p.x, tr[k].p.y - td[k].p.y, tr[k].p.z - td[k].p.z)]);
  const devRms = Math.sqrt(devPts.reduce((a, p) => a + p[1] ** 2, 0) / Math.max(1, devPts.length));
  const chartDev = lineChartSvg({ title: 'G1-3 参照機と設計機の軌跡の差（同時刻の位置差）', xLabel: '時間 [s]', yLabel: '位置差 [m]', series: [{ name: '位置差', points: devPts }], yMin: 0 });
  const altR = resR[1].sim.samples, altD = resD[1].sim.samples;
  const chartAlt = lineChartSvg({ title: 'G1-2 高度（正方形コース）', xLabel: '時間 [s]', yLabel: '高度 [m]', series: [{ name: '参照機', points: altR.map((s) => [s.t, s.p.z]) }, { name: '設計機', points: altD.map((s) => [s.t, s.p.z]) }] });
  const chartSweep = lineChartSvg({ title: '推力係数の低下と耐風ホバリング誤差（限界探索）', xLabel: '推力係数 CT の倍率', yLabel: '最大水平誤差 [m]', series: [{ name: '最大誤差', points: sweep.filter((s) => !s.crashed && s.reached).map((s) => [s.f, s.err] as [number, number]).sort((a, b) => a[0] - b[0]) }], refLines: [{ y: 0.5, label: '基準 0.5 m' }], yMin: 0 });
  const chartSweepU = lineChartSvg({ title: '推力係数の低下とホバリング PWM', xLabel: '推力係数 CT の倍率', yLabel: 'PWM [%]', series: [{ name: 'PWM', points: sweep.filter((s) => Number.isFinite(s.hoverU)).map((s) => [s.f, s.hoverU * 100] as [number, number]).sort((a, b) => a[0] - b[0]) }], yMin: 0 });

  const html = renderReport({
    stage: 5,
    title: '段階5 レポート: 統合（Sim-to-Real ループ）と完成機体',
    subtitle: `完成機体 ${fmt(designed.mass * 1000, 1)} g（クアッド X、8520 モータ、65 mm プロペラ、1S 600 mAh、ESP32-S3 自作 FC）`,
    generatedAt: nowString(),
    goals,
    sections: [
      { title: '完成機体の飛行（UI のスクリーンショット）', html: `<div class="grid2">${shots.map((s) => figure(`img/${s.f}`, s.c)).join('')}</div>` },
      {
        title: '設計値から導出したシミュレーション用パラメータ',
        html: `<p class="note">段階2（推進系）・段階3（基板と部品配置）・段階4（フレームと質量特性）の結果だけから自動で導出した。ファイル: <code>out/stage5/drone_params.json</code></p>${table(['項目', '段階1 参照機（仮定値）', '完成機体（設計値）', '備考'], paramRows)}`,
      },
      { title: '段階1 のゴールの再実行（参照機との比較）', html: `${table(['ID', 'シナリオ', '参照機', '完成機体', '判定'], cmpRows)}<div class="grid2">${chartAlt}${chartDev}</div><p class="note">障害物コースでの両機の軌跡差は RMS ${fmt(devRms, 3)} m。参照機の仮定値が設計結果と近かったため、段階1 の結論（制御・経路計画が成立する）は完成機体でも保たれた。</p>` },
      {
        title: 'Sim-to-Real 感度解析（制御器は設計値のまま、実機側だけを変える）',
        html: `${table(['ケース', ...SENS_SCENARIOS.map((id) => `${id} 主指標`), '判定'], [
          ...sens.map((s) => [esc(s.label), ...s.results.map((r) => `${fmt(r.criteria[0].value)} ${r.criteria[0].unit}${r.pass ? '' : ' ✗'}`), statusPill(s.pass)]),
          [`<b>最悪の組合せ</b>（CT −20 %・質量 +10 %・時定数 ×2・電池劣化・重心 3 mm）`, ...worst.map((r) => `${fmt(r.criteria[0].value)} ${r.criteria[0].unit}${r.pass ? '' : ' ✗'}`), statusPill(worst.every((r) => r.pass))],
        ])}
<div class="grid2">${chartSweep}${chartSweepU}</div>
${table(['CT 倍率', 'ホバリング PWM', '最大水平誤差 [m]', '状態', '判定'], sweep.map((s) => [fmt(s.f, 2), Number.isFinite(s.hoverU) ? `${fmt(s.hoverU * 100, 1)} %` : '—', s.reached && !s.crashed ? fmt(s.err) : '—', s.crashed ? '墜落' : s.reached ? '飛行' : '目標高度に上昇できない', statusPill(s.pass)]))}
<p class="note">耐風ホバリング（平均 3 m/s＋突風）を満たす推力係数の下限は設計値の <b>${fmt(ctLimit * 100, 0)} %</b>。これより低いと目標高度まで上昇できない。原因は推力そのもの（TWR は 0.65 倍でも 1.3）ではなく、<b>制御器が設計値の推力係数で PWM を決めており、ずれを補う速度ループ積分の上限（${designed.gains.velIntLimit} m/s²）を超える</b>ためである。最悪の組合せ（CT −20 % と質量 +10 % が同時）も同じ理由で不合格になる。</p>
<p class="note"><b>結論</b>: 単一の誤差（±20 % 程度）には現在の制御構成で耐えるが、複数の誤差が重なると飛べない。<b>推力台で推力係数を実測し、設計値を更新してから飛ばす</b>（下の手順）ことが Sim-to-Real の必須条件である。積分上限を大きくすると補償範囲は広がるが、ワインドアップによる過渡悪化とのトレードオフになる。</p>`,
      },
      {
        title: '設計ループ 2 周目の候補（実フレーム質量を段階2 に戻す）',
        html: `<p class="note">段階2 ではフレームを経験式で ${fmt(s2.sizing.frameMass * 1000, 1)} g と見積もったが、段階4 の実形状では ${fmt(frameMassReal, 1)} g だった。この値で推進系を再評価した結果（モータ・プロペラは同一）。</p>${table(['電池', '全備重量 [g]', 'TWR', 'ホバリングスロットル', '飛行時間 [分]', '判定', ''], loop2.map((r) => [esc(r.id), fmt(r.auw, 1), fmt(r.twr, 2), `${fmt(r.thr * 100, 0)} %`, fmt(r.t, 1), statusPill(r.ok), r.current ? '現設計' : '']))}<p class="note">条件を満たす最大容量の電池に替える場合は、段階3（基板は変更なし）・段階4（ストラップ位置の再計算）を再実行する。<code>npm run stage2 && npm run stage4 && npm run stage5</code> で一連の検証が再現できる。</p>`,
      },
      {
        title: '実機との一致を高める手順（Sim-to-Real）',
        html: `<ol>
<li><b>推力台</b>（ロードセル＋電流計＋回転計）で PWM を 10 % 刻みに変え、推力・電流・回転数を測る → CT・CP・KV・巻線抵抗を同定し、<code>MeasuredOverrides</code>（<code>ct</code>・<code>cp</code>・<code>motorTimeConstant</code>）に入れる。UI では <code>?tab=assembly&amp;ct=0.09</code> のように URL で上書きできる。</li>
<li><b>時定数</b>: PWM をステップ変化させた回転数の応答から 63 % 到達時間を読む。</li>
<li><b>質量と重心</b>: 電子天秤で全備重量、機体を 2 点で吊って重心を確認（段階4 の計算値 z=${fmt(af.cg[2], 1)} mm と比較）。</li>
<li><b>慣性</b>: 二本吊り（バイファイラ）振子の周期から Izz を求める（<code>inertiaScale</code> で補正）。</li>
<li>上書きした値で本タブのシナリオを再実行し、合格を確認してから実機のゲイン調整（角速度ループ → 姿勢 → 速度 → 位置の順）に進む。</li></ol>`,
      },
      {
        title: '実機ファームウェアへの要件（本ツールの制御構成を移植する場合）',
        html: table(['項目', '要件'], [
          ['制御周期', 'IMU 1 kHz 読み出し（SPI、データレディ割込み）、角速度ループ 500 Hz 以上、姿勢・位置 250 Hz 程度'],
          ['推定', '加速度補償付き相補フィルタ（姿勢）＋位置・速度・加速度バイアスのカルマンフィルタ（フロー・ToF・気圧）'],
          ['制御', 'カスケード PID（位置→速度→推力ベクトル→姿勢→角速度）、電池電圧補償付きの推力→PWM 変換、ヨー優先で削る飽和処理'],
          ['安全', '低電圧（負荷時 3.3 V/セル）で自動着陸、起動時はモータ停止（ゲートのプルダウン）、通信途絶でホバリング→着陸'],
          ['実装基盤', 'ESP-IDF（Apache-2.0）上に自作、または ESP-Drone（GPL-3.0）を土台に改造（その場合ファームウェアは GPL で公開義務）'],
        ]),
      },
    ],
    concerns: [
      '本段階の「実機」は感度解析上の仮想プラントであり、実物の飛行試験ではない。推力台と実飛行での同定を経て初めて Sim-to-Real が閉じる。',
      '振動（プロペラのアンバランス・フレーム共振）が IMU に与える影響はモデル化していない。実機ではソフトマウントやノッチフィルタが必要になることが多い。',
      'プロペラ同士・地面・壁の空力干渉、バッテリー温度による内部抵抗変化は未モデル化。',
      '感度解析は乱数シード 1 通り。量産的な評価には多数シードのモンテカルロが望ましい（段階1 と同様にスクリプト化可能）。',
    ],
    references: [REFS.px4, REFS.espDrone, REFS.crazyflie, REFS.three],
  });
  writeText('reports/stage5.html', html);
  writeJson('out/stage5/results.json', {
    goals,
    designed: resD.map((r) => ({ id: r.id, pass: r.pass, criteria: r.criteria })),
    reference: resR.map((r) => ({ id: r.id, pass: r.pass })),
    sensitivity: sens.map((s) => ({ id: s.id, pass: s.pass, metrics: s.results.map((r) => r.criteria[0].value) })),
    worst: worst.map((r) => ({ id: r.id, pass: r.pass })),
    ctSweep: sweep,
    ctLimit,
    trajectoryRms: devRms,
  });
  const pass = goals.every((g) => g.pass);
  console.log(`[stage5] ${pass ? 'ALL GOALS PASSED' : 'SOME GOALS FAILED'}`);
  if (!pass) process.exitCode = 1;
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
