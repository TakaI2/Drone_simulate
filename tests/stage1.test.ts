import { describe, expect, it } from 'vitest';
import {
  m3Inverse,
  m3MulVec,
  matMul,
  matPinvRight,
  qFromAxisAngle,
  qFromEuler,
  qMul,
  qRotate,
  qToEuler,
  v3,
} from '../src/core/math';
import type { Mat3 } from '../src/core/math';
import { ENV_CALM, PRESET_MICRO_HEXA, PRESET_MICRO_QUAD, starRotors } from '../src/core/presets';
import { findMotor, findProp } from '../src/core/propulsion-catalog';
import { createAllocator } from '../src/control/allocation';
import { cellOcv, terminalVoltage } from '../src/sim/battery';
import { distanceToObstacle } from '../src/sim/collision';
import { createDynamics } from '../src/sim/dynamics';
import { rotorCoefficients, steadyOmega, voltageForOmega } from '../src/sim/motor';
import { astar, shortcutPath } from '../src/planning/astar';
import { buildVoxelGrid } from '../src/planning/voxel';

describe('T-M math', () => {
  it('T-M1 quaternion rotation matches axis-angle and euler round-trip', () => {
    const q = qFromAxisAngle(v3(0, 0, 1), Math.PI / 2);
    const r = qRotate(q, v3(1, 0, 0));
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(1, 9);
    const e = qToEuler(qFromEuler(0.1, -0.2, 0.3));
    expect(e.roll).toBeCloseTo(0.1, 9);
    expect(e.pitch).toBeCloseTo(-0.2, 9);
    expect(e.yaw).toBeCloseTo(0.3, 9);
    const a = qFromAxisAngle(v3(1, 0, 0), 0.4);
    const b = qFromAxisAngle(v3(0, 1, 0), -0.7);
    const v = v3(0.3, -1, 2);
    const composed = qRotate(qMul(a, b), v);
    const sequential = qRotate(a, qRotate(b, v));
    expect(composed.x).toBeCloseTo(sequential.x, 12);
    expect(composed.z).toBeCloseTo(sequential.z, 12);
  });
  it('T-M2 inverse and pseudo-inverse', () => {
    const m: Mat3 = [2, 1, 0, 0, 3, 1, 1, 0, 4];
    const inv = m3Inverse(m);
    const x = m3MulVec(m, m3MulVec(inv, v3(1, 2, 3)));
    expect(x.x).toBeCloseTo(1, 12);
    expect(x.z).toBeCloseTo(3, 12);
    const B = [[1, 1, 1, 1], [1, -1, 1, -1], [0.5, 0.2, -0.1, 0.3]];
    const P = matPinvRight(B);
    expect(P).not.toBeNull();
    const I = matMul(B, P as number[][]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(I[i][j]).toBeCloseTo(i === j ? 1 : 0, 9);
  });
});

describe('T-P physics', () => {
  const env = { ...ENV_CALM(), airDensity: ENV_CALM().airDensity };
  it('T-P1 free fall without drag follows 1/2 g t^2', () => {
    const p = { ...PRESET_MICRO_QUAD(), dragArea: 0, rotorDrag: 0 };
    const dyn = createDynamics(p, env);
    let s = { ...dyn.initialState(v3(0, 0, 10)), onGround: false };
    const z0 = s.p.z;
    for (let i = 0; i < 1000; i++) s = dyn.step(s, [0, 0, 0, 0], v3(), 0.001).state;
    expect(z0 - s.p.z).toBeCloseTo(0.5 * env.gravity, 2);
  });
  it('T-P2 hover command gives near-zero vertical acceleration', () => {
    const p = PRESET_MICRO_QUAD();
    const dyn = createDynamics(p, env);
    const c = dyn.coeffs[0];
    const vbat = terminalVoltage(p.battery, 1, 0);
    const u = voltageForOmega(dyn.hoverOmega, p.rotors[0].motor, c.kQ) / vbat;
    let s = { ...dyn.initialState(v3(0, 0, 5)), onGround: false, rotorSpeed: [1, 1, 1, 1].map(() => dyn.hoverOmega) };
    for (let i = 0; i < 20; i++) s = dyn.step(s, [u, u, u, u], v3(), 0.001).state;
    // small residual from battery current sag at first step
    expect(Math.abs(s.accel.z)).toBeLessThan(0.3);
  });
  it('T-P3 CCW rotors produce negative yaw reaction torque', () => {
    const p = PRESET_MICRO_QUAD();
    const dyn = createDynamics(p, env);
    let s = { ...dyn.initialState(v3(0, 0, 5)), onGround: false };
    // rotors 0 and 2 spin CCW (+1): drive them only -> body yaw rate should become negative
    for (let i = 0; i < 50; i++) s = dyn.step(s, [0.6, 0, 0.6, 0], v3(), 0.001).state;
    expect(p.rotors[0].spin).toBe(1);
    expect(s.w.z).toBeLessThan(0);
  });
  it('T-P4 steady motor speed satisfies the voltage equation', () => {
    const m = findMotor('coreless-0820');
    const { kQ } = rotorCoefficients(findProp('prop-65'), 1.225);
    const w = steadyOmega(3.0, m, kQ);
    expect(voltageForOmega(w, m, kQ)).toBeCloseTo(3.0, 6);
  });
  it('T-P5 battery terminal voltage drop', () => {
    const b = PRESET_MICRO_QUAD().battery;
    expect(terminalVoltage(b, 0.5, 2)).toBeCloseTo(cellOcv(0.5) - b.internalResistance * 2, 9);
  });
  it('T-P6 obstacle distance for box and cylinder', () => {
    expect(distanceToObstacle(v3(2, 0, 0.5), { kind: 'box', id: 'b', center: v3(0, 0, 0.5), size: v3(2, 2, 1) })).toBeCloseTo(1, 9);
    expect(distanceToObstacle(v3(0, 0, 0.5), { kind: 'box', id: 'b', center: v3(0, 0, 0.5), size: v3(2, 2, 1) })).toBe(0);
    expect(distanceToObstacle(v3(1, 0, 1), { kind: 'cylinder', id: 'c', base: v3(0, 0, 0), radius: 0.5, height: 2 })).toBeCloseTo(0.5, 9);
    expect(distanceToObstacle(v3(0, 0, 3), { kind: 'cylinder', id: 'c', base: v3(0, 0, 0), radius: 0.5, height: 2 })).toBeCloseTo(1, 9);
  });
});

describe('T-C control allocation', () => {
  it('T-C1 quad and hexa allocation reproduce the wrench', () => {
    for (const p of [PRESET_MICRO_QUAD(), PRESET_MICRO_HEXA()]) {
      const coeffs = p.rotors.map((r) => rotorCoefficients(r.prop, 1.225));
      const a = createAllocator(p.rotors, coeffs);
      expect(a.controllable).toBe(true);
      const big = new Array<number>(p.rotors.length).fill(10);
      const zero = new Array<number>(p.rotors.length).fill(0);
      const w = { thrust: 0.6, tx: 0.002, ty: -0.001, tz: 0.0001 };
      const { thrusts, saturated } = a.allocate(w, zero, big);
      expect(saturated).toBe(false);
      const back = a.B.map((row) => row.reduce((s, x, i) => s + x * thrusts[i], 0));
      expect(back[0]).toBeCloseTo(w.thrust, 9);
      expect(back[1]).toBeCloseTo(w.tx, 9);
      expect(back[2]).toBeCloseTo(w.ty, 9);
      expect(back[3]).toBeCloseTo(w.tz, 9);
    }
  });
  it('T-C2 collinear rotors are flagged as uncontrollable', () => {
    const base = PRESET_MICRO_QUAD().rotors[0];
    const rotors = [-0.1, -0.05, 0.05, 0.1].map((x, i) => ({ ...base, position: v3(x, 0, 0), spin: (i % 2 ? -1 : 1) as 1 | -1 }));
    const coeffs = rotors.map((r) => rotorCoefficients(r.prop, 1.225));
    expect(createAllocator(rotors, coeffs).controllable).toBe(false);
    const tri = starRotors(3, 0.1, base.motor, base.prop);
    expect(createAllocator(tri, tri.map((r) => rotorCoefficients(r.prop, 1.225))).controllable).toBe(false);
  });
  it('T-C3 saturation keeps thrusts in bounds', () => {
    const p = PRESET_MICRO_QUAD();
    const coeffs = p.rotors.map((r) => rotorCoefficients(r.prop, 1.225));
    const a = createAllocator(p.rotors, coeffs);
    const { thrusts, saturated } = a.allocate({ thrust: 1.4, tx: 0.05, ty: 0.05, tz: 0.01 }, [0, 0, 0, 0], [0.4, 0.4, 0.4, 0.4]);
    expect(saturated).toBe(true);
    for (const f of thrusts) {
      expect(f).toBeGreaterThanOrEqual(-1e-12);
      expect(f).toBeLessThanOrEqual(0.4 + 1e-12);
    }
  });
});

describe('T-N planning', () => {
  const grid = buildVoxelGrid(
    [{ kind: 'box', id: 'wall', center: v3(0, -0.5, 1), size: v3(0.2, 3, 2) }],
    { min: v3(-2, -2, 0), max: v3(2, 2, 2), res: 0.1, inflate: 0.2, floor: 0.3, ceilingMargin: 0.2 },
  );
  it('T-N1 A* path avoids occupied cells', () => {
    const plan = astar(grid, v3(-1.5, -1, 1), v3(1.5, -1, 1));
    expect(plan).not.toBeNull();
    for (const p of plan!.path) expect(grid.occupiedAt(p)).toBe(false);
    // must go around the wall end at y > 1.0 + inflate
    expect(Math.max(...plan!.path.map((p) => p.y))).toBeGreaterThan(1.1);
  });
  it('T-N2 shortcut path segments are collision-free', () => {
    const plan = astar(grid, v3(-1.5, -1, 1), v3(1.5, -1, 1))!;
    const s = shortcutPath(grid, plan.path);
    expect(s.length).toBeLessThan(plan.path.length);
    for (let i = 1; i < s.length; i++) expect(grid.lineFree(s[i - 1], s[i])).toBe(true);
  });
});
