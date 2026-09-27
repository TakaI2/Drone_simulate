import { describe, expect, it } from 'vitest';
import { combineMass } from '../src/airframe/design';
import type { MassItem } from '../src/airframe/design';
import { manifoldCheck, meshMassProps } from '../src/airframe/mesh';
import type { TriMesh } from '../src/airframe/mesh';
import { PHYSICAL } from '../src/core/presets';
import { findBattery, findMotor, findProp } from '../src/core/propulsion-catalog';
import { buildBreadboard } from '../src/electrical/breadboard';
import { ipc2221Width } from '../src/electrical/calc';
import { generateCircuit } from '../src/electrical/circuit';
import { runStage2 } from '../src/integration/stage2';
import { deriveDroneParams } from '../src/integration/stage5';
import { PACKAGES, getPackage } from '../src/parts3d/packages';
import { runDrc } from '../src/pcb/drc';
import { generateGerbers, zipStore } from '../src/pcb/gerber';
import { routeBoard } from '../src/pcb/router';
import { DEFAULT_RULES } from '../src/pcb/types';
import type { PcbDesign, PlacedPad } from '../src/pcb/types';
import { rotorCoefficients } from '../src/sim/motor';
import { sizePropulsion } from '../src/sizing/propulsion';

describe('T-S sizing', () => {
  it('T-S1 rotor coefficients and hover balance match hand calculation', () => {
    const prop = findProp('prop-65');
    const { kT } = rotorCoefficients(prop, 1.225);
    // kT = CT rho D^4 / (4 pi^2)
    expect(kT).toBeCloseTo((0.1 * 1.225 * 0.065 ** 4) / (4 * Math.PI ** 2), 12);
    const r = sizePropulsion({ rotorCount: 4, motor: findMotor('coreless-0820'), prop, battery: findBattery('lipo-1s-600'), electronicsMass: 0.007 });
    expect(r.hover.thrustPerRotor * 4).toBeCloseTo(r.auw * PHYSICAL.gravity, 6);
    expect(r.flightTimeMin).toBeCloseTo(((0.8 * 0.6) / r.hover.batteryCurrent) * 60, 9);
    expect(r.twr).toBeGreaterThan(1);
  });
});

describe('T-E electrical', () => {
  it('T-E1 every connected pin belongs to a net with at least two pins', () => {
    const c = generateCircuit({ rotorCount: 4 });
    const pinCount = new Map(c.nets.map((n) => [n.name, n.pins.length]));
    for (const comp of c.components) for (const p of comp.pins) if (p.net) expect(pinCount.get(p.net)).toBeGreaterThanOrEqual(2);
    expect(c.components.filter((x) => x.part.category === 'mosfet')).toHaveLength(4);
  });
  it('T-E2 IPC-2221 external trace width for 1 A / 10 °C / 1 oz is about 0.30 mm', () => {
    expect(ipc2221Width(1, 10, 1.378)).toBeCloseTo(0.3, 2);
  });
  it('T-E3 stage-2 pipeline converges and passes all electrical checks', () => {
    const r = runStage2({ rotorCount: 4 });
    expect(r.calc.pass).toBe(true);
    expect(r.iterations.length).toBeLessThanOrEqual(6);
    expect(r.sizing.feasible).toBe(true);
  });
  it('T-E4 breadboard layout has no strip conflicts and all nets are continuous', () => {
    expect(buildBreadboard(4).pass).toBe(true);
  });
});

const pad = (ref: string, num: string, net: string, x: number, y: number, w = 1, h = 1): PlacedPad => ({ ref, num, net, x, y, w, h, shape: 'rect', layers: ['F'] });
const emptyDesign = (over: Partial<PcbDesign>): PcbDesign => ({
  name: 't', board: { w: 10, h: 10, cornerRadius: 1 }, rules: DEFAULT_RULES, placements: [], pads: [], tracks: [], vias: [], zones: [], keepouts: [], layerKeepouts: [], unrouted: [], log: [], ...over,
});

describe('T-B PCB', () => {
  it('T-B1 DRC detects a clearance violation and an open net', () => {
    const d = emptyDesign({
      pads: [pad('A', '1', 'N1', -3, 0), pad('A', '2', 'N1', 3, 0), pad('B', '1', 'N2', 0, 2)],
      tracks: [
        { net: 'N1', layer: 'F', x1: -3, y1: 0, x2: 0, y2: 0, width: 0.2 },
        { net: 'N2', layer: 'F', x1: 0, y1: 2, x2: 0, y2: 0.25, width: 0.2 },
      ],
    });
    const r = runDrc(d);
    expect(r.counts.clearance).toBeGreaterThan(0);
    expect(r.unconnectedNets).toContain('N1');
  });
  it('T-B2 router connects a simple two-pin net with a clean DRC', () => {
    const pads = [pad('A', '1', 'N1', -3, -2), pad('B', '1', 'N1', 3, 2), pad('C', '1', 'N2', 0, 0, 2, 2), pad('C', '2', 'N2', 0, 3.5)];
    const circuit = { name: 't', components: [], gpio: [], nets: [{ name: 'N1', cls: 'signal' as const, pins: [{ ref: 'A', pin: '1' }, { ref: 'B', pin: '1' }] }, { name: 'N2', cls: 'signal' as const, pins: [{ ref: 'C', pin: '1' }, { ref: 'C', pin: '2' }] }] };
    const board = { w: 10, h: 10, cornerRadius: 1 };
    const rr = routeBoard({ circuit, board, rules: DEFAULT_RULES, pads, zones: [], vias: [], keepouts: [], layerKeepouts: [] });
    expect(rr.unrouted).toHaveLength(0);
    const drc = runDrc(emptyDesign({ board, pads, tracks: rr.tracks, vias: rr.vias }));
    expect(drc.violations).toHaveLength(0);
  });
  it('T-B3 Gerber / Excellon files are syntactically framed and zipped', () => {
    const d = emptyDesign({ pads: [pad('A', '1', 'N1', -3, 0), { ...pad('A', '2', 'N1', 3, 0), drill: 0.8, layers: ['F', 'B'] }], tracks: [{ net: 'N1', layer: 'F', x1: -3, y1: 0, x2: 3, y2: 0, width: 0.3 }] });
    const g = generateGerbers(d);
    const copper = Object.entries(g.files).find(([k]) => k.endsWith('.gtl'))![1];
    expect(copper).toContain('%FSLAX46Y46*%');
    expect(copper).toContain('%MOMM*%');
    expect(copper.trim().endsWith('M02*')).toBe(true);
    const drill = Object.entries(g.files).find(([k]) => k.endsWith('PTH.drl') && !k.includes('NPTH'))![1];
    expect(drill).toContain('T1C0.800');
    const zip = zipStore(g.files);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  });
  it('T-B4 no package has overlapping pads', () => {
    for (const id of Object.keys(PACKAGES)) {
      const pads = getPackage(id).pads;
      for (let i = 0; i < pads.length; i++)
        for (let j = i + 1; j < pads.length; j++) {
          const a = pads[i], b = pads[j];
          const gx = Math.abs(a.x - b.x) - (a.w + b.w) / 2, gy = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
          expect(Math.max(gx, gy), `${id} ${a.num}/${b.num}`).toBeGreaterThan(0.09);
        }
    }
  });
});

const cube = (s: number): TriMesh => {
  const v = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return { positions: new Float32Array(v.flat()), indices: new Uint32Array(f.flat()) };
};

describe('T-A airframe', () => {
  it('T-A1 mesh volume / inertia of a cube and combined box inertia match analytic values', () => {
    const mp = meshMassProps(cube(2));
    expect(mp.volume).toBeCloseTo(8, 6);
    expect(mp.centroid[0]).toBeCloseTo(1, 6);
    // I/density about centroid = V (a^2 + a^2)/12
    expect(mp.inertiaPerDensity[0]).toBeCloseTo((8 * (4 + 4)) / 12, 5);
    const items: MassItem[] = [
      { name: 'a', massG: 1, shape: 'box', center: [-1, 0, 0], size: [2, 2, 2], topZ: 0, radius: 0 },
      { name: 'b', massG: 1, shape: 'box', center: [1, 0, 0], size: [2, 2, 2], topZ: 0, radius: 0 },
    ];
    const c = combineMass(items);
    expect(c.cg[0]).toBeCloseTo(0, 12);
    // Iyy = 2 * (m(a^2+c^2)/12 + m d^2) = 2 * (8/12 + 1)
    expect(c.inertia[4]).toBeCloseTo(2 * (8 / 12 + 1), 9);
  });
  it('T-A2 watertight check accepts a closed cube and rejects an open one', () => {
    expect(manifoldCheck(cube(1)).watertight).toBe(true);
    const open = cube(1);
    expect(manifoldCheck({ positions: open.positions, indices: open.indices.slice(0, 33) }).watertight).toBe(false);
  });
});

describe('T-I integration', () => {
  it('T-I1 derived parameters put rotors relative to the CG and convert units', () => {
    const r = runStage2({ rotorCount: 4 });
    const af = {
      massG: 50,
      cg: [1, 0, 3] as [number, number, number],
      inertia: [40000, 0, 0, 0, 40000, 0, 0, 0, 80000],
      rotors: [{ x: 38, y: -38, hubZ: 16, spin: 1 as const }, { x: 38, y: 38, hubZ: 16, spin: -1 as const }, { x: -38, y: 38, hubZ: 16, spin: 1 as const }, { x: -38, y: -38, hubZ: 16, spin: -1 as const }],
      input: { rotorCount: 4, armLength: 53.7, motor: { diameter: 8.5, length: 20, massG: 5 }, prop: { diameter: 65, massG: 0.5, blades: 2 }, battery: { size: [50, 25, 7] as [number, number, number], massG: 15 }, pcb: { w: 40, h: 40, thickness: 0.8, holes: [], boardMassG: 3, parts: [], antennaOverhang: 6 }, flow: { size: [20, 15, 4] as [number, number, number], massG: 2 }, miscMassG: 3, maxThrustN: 0.3 },
      pcbZ: 7,
    };
    const p = deriveDroneParams(r.sizing, af);
    expect(p.mass).toBeCloseTo(0.05, 9);
    expect(p.rotors[0].position.x).toBeCloseTo(0.037, 9);
    expect(p.rotors[0].position.z).toBeCloseTo(0.013, 9);
    expect(p.inertia[8]).toBeCloseTo(8e-5, 12);
    expect(p.gearHeight).toBeCloseTo(0.01, 9);
  });
});

import { generateFlowBoard } from '../src/electrical/flowboard';
import { createRng } from '../src/core/rng';
import { createSensors } from '../src/sim/sensors';
import { SENSORS_GNSS_M10, PRESET_MICRO_QUAD } from '../src/core/presets';
import { createDynamics } from '../src/sim/dynamics';
import { ENV_CALM as ENV_CALM_B } from '../src/core/presets';
import { v3 as v3b } from '../src/core/math';

describe('T-V variant B', () => {
  it('T-V1 sensor sub-board netlist: every connected pin is on a net with >= 2 pins', () => {
    const c = generateFlowBoard();
    const pinCount = new Map(c.nets.map((n) => [n.name, n.pins.length]));
    for (const comp of c.components) for (const p of comp.pins) if (p.net) expect(pinCount.get(p.net), `${comp.ref}.${p.num}`).toBeGreaterThanOrEqual(2);
    expect(c.nets.find((n) => n.name === '1V8')).toBeDefined();
  });
  it('T-V2 GNSS port is optional and leaves variant A unchanged', () => {
    const a = generateCircuit({ rotorCount: 4 });
    const b = generateCircuit({ rotorCount: 4, gnssConnector: true });
    expect(a.components.map((c) => c.ref)).toEqual(b.components.map((c) => c.ref).filter((r) => r !== 'J8'));
    expect(b.nets.find((n) => n.name === 'GNSS_TX')?.pins).toHaveLength(2);
    expect(a.nets.find((n) => n.name === 'GNSS_TX')).toBeUndefined();
  });
  it('T-V3 GNSS Gauss-Markov error has the configured spread', () => {
    const dyn = createDynamics(PRESET_MICRO_QUAD(), ENV_CALM_B());
    const s = { ...dyn.initialState(v3b(0, 0, 0)) };
    const sens = createSensors({ ...SENSORS_GNSS_M10, posStd: 0 }, createRng(7));
    const all: number[] = [];
    for (let i = 0; i < 600_000; i++) {
      const r = sens.read(s, 9.81, 0.01);
      if (r.pos) all.push(r.pos.x);
    }
    const xs = all.filter((_, i) => i % 10 === 0);
    expect(xs.length).toBeGreaterThan(1000);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    expect(sd).toBeGreaterThan(0.5);
    expect(sd).toBeLessThan(1.6);
  });
});
