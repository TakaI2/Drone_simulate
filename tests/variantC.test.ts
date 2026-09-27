import { describe, expect, it } from 'vitest';
import { COURSE_OUTDOOR_RTH, ENV_OUTDOOR_C, GAINS_OUTDOOR, PRESET_MICRO_QUAD, SENSORS_GNSS_M10 } from '../src/core/presets';
import { computeElectricalEsc } from '../src/electrical/calc-esc';
import { generateCircuit } from '../src/electrical/circuit';
import { OUTDOOR_SEARCH } from '../src/integration/variantC';
import { createSimulation } from '../src/sim/simulator';
import { searchPropulsion } from '../src/sizing/propulsion';

describe('T-C variant C (outdoor)', () => {
  it('T-C1 outdoor search is separate from the Class A search and has a sub-95 g solution', () => {
    const a = searchPropulsion(4, 0.007);
    expect(a.best?.input.motor.kind).toBe('brushed');
    expect(a.all.every((r) => r.input.battery.cells === 1 || r.input.motor.kind === 'brushless')).toBe(true);
    const c = searchPropulsion(4, 0.007, OUTDOOR_SEARCH);
    expect(c.best).not.toBeNull();
    expect(c.best!.auw).toBeLessThan(0.095);
    expect(c.best!.twr).toBeGreaterThanOrEqual(3);
    expect(c.all.some((r) => r.input.motor.kind === 'brushed')).toBe(false);
  });

  it('T-C2 ESC/buck circuit: no MOSFET drivers, regulator and ESC harness present, electrical checks pass', () => {
    const c = generateCircuit({ rotorCount: 4, gnssConnector: true, power: 'buck', motorDrive: 'esc' });
    expect(c.components.some((x) => x.partId === 'AO3400A' || x.partId === 'MotorPad' || x.partId === 'BatteryPad')).toBe(false);
    expect(c.components.some((x) => x.partId === 'MP2359DJ')).toBe(true);
    expect(c.components.find((x) => x.partId === 'JST-SM08B-ESC')?.pins.filter((p) => p.net?.startsWith('ESC_M'))).toHaveLength(4);
    expect(c.nets.filter((n) => n.pins.length < 2)).toHaveLength(0);
    const sizing = searchPropulsion(4, 0.007, OUTDOOR_SEARCH).best!;
    const calc = computeElectricalEsc(c, sizing);
    expect(calc.checks.filter((x) => !x.pass).map((x) => x.label)).toEqual([]);
    // variant A circuit keeps its motor drivers
    expect(generateCircuit({ rotorCount: 4 }).components.filter((x) => x.partId === 'AO3400A')).toHaveLength(4);
  });

  it('T-C3 link loss triggers return-to-home and a landing near home', () => {
    const params = { ...PRESET_MICRO_QUAD(), sensors: SENSORS_GNSS_M10, gains: GAINS_OUTDOOR };
    const course = { ...COURSE_OUTDOOR_RTH(), waypoints: COURSE_OUTDOOR_RTH().waypoints.map((w) => ({ ...w, z: 4 })), cruiseAltitude: 4, rthAltitude: 5, linkLossAt: 14 };
    const sim = createSimulation({ params, env: ENV_OUTDOOR_C(2, 0.5), course, seed: 3, estimator: 'filter', idealSensors: false });
    sim.runToEnd(120);
    expect(sim.events.some((e) => e.kind === 'failsafe' && e.detail.startsWith('通信断'))).toBe(true);
    expect(sim.samples.some((s) => s.phase === 'rth')).toBe(true);
    expect(sim.samples.some((s) => s.phase === 'landed')).toBe(true);
    const last = sim.samples[sim.samples.length - 1];
    expect(Math.hypot(last.p.x, last.p.y)).toBeLessThan(3);
    expect(sim.crashed()).toBe(false);
  });
});
