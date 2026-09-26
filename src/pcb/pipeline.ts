import type { Circuit } from '../electrical/circuit';
import { runDrc } from './drc';
import type { DrcResult } from './drc';
import { placeComponents } from './placement';
import { pourGround } from './pour';
import { routeBoard } from './router';
import type { GndStrategy } from './router';
import { DEFAULT_RULES } from './types';
import type { Board, DesignRules, PcbDesign } from './types';

export interface PcbAttempt {
  attempt: number;
  board: string;
  gnd: GndStrategy;
  priority: string[];
  placementFailures: number;
  unrouted: number;
  drcViolations: number;
  tracks: number;
  vias: number;
  timeMs: number;
  note: string;
}

export interface PcbPipelineResult {
  design: PcbDesign;
  drc: DrcResult;
  attempts: PcbAttempt[];
  stats: {
    trackLengthMm: number;
    viaCount: Record<string, number>;
    pourAreaMm2: { F: number; B: number };
    neckdowns: Array<{ net: string; width: number }>;
    removedIslands: number;
    isolatedGndPads: string[];
  };
  success: boolean;
}

export interface PcbPipelineOptions {
  rotorAngles: number[];
  rules?: DesignRules;
  /** Candidate board sizes tried in order [mm]. */
  boardSizes?: number[];
  cornerRadius?: number;
  maxRerouteAttempts?: number;
  name?: string;
}

const GND_STRATEGIES: GndStrategy[] = ['tree-first', 'split', 'first'];

export const designPcb = (circuit: Circuit, o: PcbPipelineOptions): PcbPipelineResult => {
  const rules = o.rules ?? DEFAULT_RULES;
  const sizes = o.boardSizes ?? [38, 40, 42, 44];
  const attempts: PcbAttempt[] = [];
  let best: PcbPipelineResult | null = null;
  let n = 0;
  for (const size of sizes) {
    const board: Board = { w: size, h: size, cornerRadius: o.cornerRadius ?? 2 };
    const t0 = Date.now();
    const pl = placeComponents(circuit, { board, rules, rotorAngles: o.rotorAngles });
    if (pl.failures.length) {
      attempts.push({ attempt: ++n, board: `${size}×${size}`, gnd: 'split', priority: [], placementFailures: pl.failures.length, unrouted: 0, drcViolations: 0, tracks: 0, vias: 0, timeMs: Date.now() - t0, note: `配置失敗: ${pl.failures.join(' / ')}` });
      continue;
    }
    for (const gnd of GND_STRATEGIES) {
    let priority: string[] = [];
    for (let k = 0; k < (o.maxRerouteAttempts ?? 2); k++) {
      const t1 = Date.now();
      const anchor = pl.pads.find((p) => p.net === 'GND' && p.drill) ?? pl.pads.find((p) => p.net === 'GND') ?? null;
      const routeInput = { circuit, board, rules, pads: pl.pads, zones: pl.zones, vias: pl.vias, keepouts: pl.keepouts, layerKeepouts: pl.layerKeepouts, priority, gndStrategy: gnd, preTracks: pl.fanoutTracks, viaKeepouts: pl.viaKeepouts, fanoutOrder: pl.fanoutOrder };
      let rr = routeBoard(routeInput);
      let pour = pourGround(rr.raster, rr.netIds.get('GND') ?? -1, rules, pl.pads, rr.vias, anchor);
      let repaired = false;
      if (pour.isolatedPads.length > 0 || rr.unrouted.some((u) => u.net === 'GND')) {
        // plane repair pass: identical signal routing (deterministic), ground islands may land on the kept pour
        const rr2 = routeBoard({ ...routeInput, gndPourTargets: pour.masks });
        const pour2 = pourGround(rr2.raster, rr2.netIds.get('GND') ?? -1, rules, pl.pads, rr2.vias, anchor);
        if (pour2.isolatedPads.length + rr2.unrouted.length < pour.isolatedPads.length + rr.unrouted.length) {
          rr = rr2;
          pour = pour2;
          repaired = true;
        }
      }
      const design: PcbDesign = {
        name: o.name ?? circuit.name,
        board,
        rules,
        placements: pl.placements,
        pads: pl.pads,
        tracks: rr.tracks,
        vias: [...rr.vias, ...pour.stitchVias],
        zones: [...pl.zones, ...pour.zones],
        keepouts: pl.keepouts,
        layerKeepouts: pl.layerKeepouts,
        unrouted: [...rr.unrouted, ...pour.isolatedPads.map((p) => ({ net: 'GND', detail: `ベタに接続されない GND パッド ${p}` }))],
        log: [...pl.log, ...rr.log, ...pour.log],
      };
      const drc = runDrc(design);
      const viaCount: Record<string, number> = {};
      for (const v of design.vias) viaCount[v.kind] = (viaCount[v.kind] ?? 0) + 1;
      const result: PcbPipelineResult = {
        design,
        drc,
        attempts,
        stats: {
          trackLengthMm: design.tracks.reduce((s, t) => s + Math.hypot(t.x2 - t.x1, t.y2 - t.y1), 0),
          viaCount,
          pourAreaMm2: pour.areaMm2,
          neckdowns: rr.neckdowns,
          removedIslands: pour.removedIslands,
          isolatedGndPads: pour.isolatedPads,
        },
        success: design.unrouted.length === 0 && drc.violations.length === 0,
      };
      attempts.push({
        attempt: ++n,
        board: `${size}×${size}`,
        gnd,
        priority: [...priority],
        placementFailures: 0,
        unrouted: design.unrouted.length,
        drcViolations: drc.violations.length,
        tracks: design.tracks.length,
        vias: design.vias.length,
        timeMs: Date.now() - t1,
        note: (repaired ? '[ベタ補修] ' : '') + (result.success ? '成功' : [...design.unrouted.map((u) => `${u.net}: ${u.detail}`), ...Object.entries(drc.counts).filter(([, c]) => c).map(([k, c]) => `DRC ${k} ${c}`)].slice(0, 4).join(' / ')),
      });
      const score = (x: PcbPipelineResult): number => x.design.unrouted.length * 1000 + x.drc.violations.length;
      if (!best || score(result) < score(best)) best = result;
      if (result.success) return { ...result, attempts };
      // rip-up & reroute: failed nets first next time
      const failed = [...new Set(design.unrouted.map((u) => u.net))].filter((x) => x !== 'GND');
      if (failed.length === 0) break;
      priority = [...new Set([...failed, ...priority])];
    }
    }
  }
  if (!best) throw new Error('基板設計に失敗しました（配置不能）');
  return { ...best, attempts };
};
