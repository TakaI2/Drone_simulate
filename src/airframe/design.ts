import type { ManifoldToplevel, Manifold } from 'manifold-3d';
import { manifoldCheck, meshBounds, meshMassProps } from './mesh';
import type { TriMesh } from './mesh';

/** Frame design constants (mm, g). */
export const FRAME_DEFAULTS = {
  plateThickness: 2.0,
  plateCornerRadius: 3,
  armWidth: 5.0,
  armHeight: 4.0,
  tubeWall: 1.2,
  /** Press-fit interference on the motor can (radius) [mm]. */
  tubeFit: 0.1,
  tubeHeight: 10,
  /** Motor top above tube top [mm]. */
  motorAboveTube: 4,
  shaftAboveMotor: 2,
  slitWidth: 1.0,
  standoffHeight: 5,
  standoffRadius: 2.2,
  /** Pilot hole for M2 self-tapping screws [mm]. */
  pilotRadius: 0.8,
  clearanceHoleRadius: 1.1,
  strapWidth: 10,
  strapSlotWidth: 2.0,
  strapSlotMargin: 1.5,
  noseLength: 22,
  noseWidth: 20,
  lighteningHole: 14,
  /** PLA density [g/mm^3] and effective fill of a typical print (2 perimeters, 30 % infill). */
  density: 1.24e-3,
  printFill: 0.8,
  /** Allowable stress of printed PLA (conservative, layer-direction) [MPa]. */
  plaAllowable: 25,
} as const;

export interface AirframeInput {
  rotorCount: number;
  armLength: number;
  motor: { diameter: number; length: number; massG: number };
  prop: { diameter: number; massG: number; blades: number };
  battery: { size: [number, number, number]; massG: number };
  pcb: { w: number; h: number; thickness: number; holes: Array<{ x: number; y: number }>; boardMassG: number; parts: Array<{ ref: string; x: number; y: number; massG: number; height: number }>; antennaOverhang: number };
  flow: { size: [number, number, number]; massG: number };
  miscMassG: number;
  /** Max static thrust per rotor [N] (arm stress check). */
  maxThrustN: number;
}

export interface MassItem {
  name: string;
  massG: number;
  shape: 'box' | 'cyl' | 'point' | 'mesh';
  center: [number, number, number];
  /** box: [sx, sy, sz]; cyl (z axis): [r, r, h]. */
  size: [number, number, number];
  /** mesh-only inertia about its own CG per unit mass [mm^2]. */
  inertiaPerMass?: number[];
  /** Top of the item [mm] (clearance checks). */
  topZ: number;
  /** Horizontal footprint radius around center [mm] (clearance checks). */
  radius: number;
}

export interface Check {
  label: string;
  value: number;
  limit: number;
  unit: string;
  op: 'lt' | 'gte';
  pass: boolean;
  note?: string;
}

export interface AirframeDesign {
  input: AirframeInput;
  frame: TriMesh;
  frameVolumeMm3: number;
  frameMassG: number;
  items: MassItem[];
  massG: number;
  cg: [number, number, number];
  /** Inertia about CG (row-major 3x3) [g mm^2]. */
  inertia: number[];
  battery: { x: number; y: number };
  rotors: Array<{ x: number; y: number; hubZ: number; spin: 1 | -1 }>;
  plate: { minX: number; maxX: number; w: number };
  pcbZ: number;
  checks: Check[];
  iterations: Array<{ iter: number; batteryX: number; batteryY: number; cgX: number; cgY: number; massG: number }>;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  watertight: ReturnType<typeof manifoldCheck>;
  manifoldStatus: string;
}

const deg = (r: number): number => (r * 180) / Math.PI;

export const rotorAngle = (n: number, i: number): number => -Math.PI / 2 + Math.PI / n + (2 * Math.PI * i) / n;

const toTriMesh = (m: Manifold): TriMesh => {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = mesh.vertProperties[i * np];
    positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
};

/** Build the one-piece printable frame for a given battery position. */
const buildFrame = (wasm: ManifoldToplevel, inp: AirframeInput, bx: number): { manifold: Manifold; plate: { minX: number; maxX: number; w: number } } => {
  const F = FRAME_DEFAULTS;
  const { Manifold, CrossSection } = wasm;
  const n = inp.rotorCount;
  const L = inp.armLength;
  const rOut = inp.motor.diameter / 2 + F.tubeWall;
  const rIn = inp.motor.diameter / 2 - F.tubeFit;
  const plateW = inp.pcb.w, plateH = inp.pcb.h;
  const rr = F.plateCornerRadius;
  let solid: Manifold = CrossSection.square([plateW - 2 * rr, plateH - 2 * rr], true).offset(rr, 'Round').extrude(F.plateThickness);
  // nose for the optical-flow module
  const noseX0 = plateW / 2 - rr, noseX1 = plateW / 2 + F.noseLength;
  const nose = CrossSection.square([noseX1 - noseX0 - 2 * 2, F.noseWidth - 2 * 2], true).offset(2, 'Round').extrude(F.plateThickness).translate([(noseX0 + noseX1) / 2, 0, 0]);
  solid = solid.add(nose);
  const parts: Manifold[] = [];
  for (let i = 0; i < n; i++) {
    const th = rotorAngle(n, i);
    const arm = Manifold.cube([L, F.armWidth, F.armHeight]).translate([0, -F.armWidth / 2, 0]).rotate([0, 0, deg(th)]);
    const tube = Manifold.cylinder(F.tubeHeight, rOut, rOut, 48).translate([L * Math.cos(th), L * Math.sin(th), 0]);
    parts.push(arm, tube);
  }
  for (const h of inp.pcb.holes) parts.push(Manifold.cylinder(F.plateThickness + F.standoffHeight, F.standoffRadius, F.standoffRadius, 32).translate([h.x, h.y, 0]));
  solid = Manifold.union([solid, ...parts]);
  // ---- subtractions ----
  const cuts: Manifold[] = [];
  for (let i = 0; i < n; i++) {
    const th = rotorAngle(n, i);
    const cx = L * Math.cos(th), cy = L * Math.sin(th);
    cuts.push(Manifold.cylinder(F.tubeHeight + 2, rIn, rIn, 48).translate([cx, cy, -1]));
    // clamping slit on the outboard side
    cuts.push(Manifold.cube([rOut + 1, F.slitWidth, F.tubeHeight + 2]).translate([0, -F.slitWidth / 2, -1]).rotate([0, 0, deg(th)]).translate([cx, cy, 0]));
  }
  for (const h of inp.pcb.holes) cuts.push(Manifold.cylinder(F.plateThickness + F.standoffHeight + 2, F.pilotRadius, F.pilotRadius, 24).translate([h.x, h.y, -1]));
  // battery strap slots (battery length along y, slides in x/y under the strap)
  const bw = inp.battery.size[1];
  for (const s of [-1, 1]) {
    const x = bx + s * (bw / 2 + F.strapSlotMargin + F.strapSlotWidth / 2);
    cuts.push(Manifold.cube([F.strapSlotWidth, F.strapWidth + 1, F.plateThickness + 2], true).translate([x, 0, F.plateThickness / 2]));
  }
  // lightening window in the plate centre (clear of slots and standoffs)
  const lh = F.lighteningHole;
  cuts.push(CrossSection.square([lh - 4, lh - 4], true).offset(2, 'Round').extrude(F.plateThickness + 2).translate([bx, 0, -1]));
  // flow module screws (M2 clearance) on the nose
  const fx = plateW / 2 + F.noseLength / 2;
  for (const s of [-1, 1]) cuts.push(Manifold.cylinder(F.plateThickness + 2, F.clearanceHoleRadius, F.clearanceHoleRadius, 24).translate([fx, s * (inp.flow.size[1] / 2 - 2), -1]));
  const result = solid.subtract(Manifold.union(cuts));
  return { manifold: result, plate: { minX: -plateW / 2, maxX: noseX1, w: plateW } };
};

const itemInertia = (it: MassItem): number[] => {
  const m = it.massG;
  let Ixx = 0, Iyy = 0, Izz = 0;
  if (it.shape === 'box') {
    const [a, b, c] = it.size;
    Ixx = (m * (b * b + c * c)) / 12;
    Iyy = (m * (a * a + c * c)) / 12;
    Izz = (m * (a * a + b * b)) / 12;
  } else if (it.shape === 'cyl') {
    const r = it.size[0], h = it.size[2];
    Izz = (m * r * r) / 2;
    Ixx = Iyy = (m * (3 * r * r + h * h)) / 12;
  } else if (it.shape === 'mesh' && it.inertiaPerMass) {
    return it.inertiaPerMass.map((v) => v * m);
  }
  return [Ixx, 0, 0, 0, Iyy, 0, 0, 0, Izz];
};

export const combineMass = (items: MassItem[]): { massG: number; cg: [number, number, number]; inertia: number[] } => {
  const M = items.reduce((s, i) => s + i.massG, 0);
  const cg: [number, number, number] = [0, 0, 0];
  for (const it of items) for (let k = 0; k < 3; k++) cg[k] += (it.massG * it.center[k]) / M;
  const I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const it of items) {
    const own = itemInertia(it);
    const d = [it.center[0] - cg[0], it.center[1] - cg[1], it.center[2] - cg[2]];
    const d2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) I[i * 3 + j] += own[i * 3 + j] + it.massG * ((i === j ? d2 : 0) - d[i] * d[j]);
  }
  return { massG: M, cg, inertia: I };
};

export const designAirframe = (wasm: ManifoldToplevel, inp: AirframeInput): AirframeDesign => {
  const F = FRAME_DEFAULTS;
  const n = inp.rotorCount;
  const L = inp.armLength;
  const pcbZ = F.plateThickness + F.standoffHeight;
  const motorTop = F.tubeHeight + F.motorAboveTube;
  const hubZ = motorTop + F.shaftAboveMotor;
  const [bl, bw, bh] = [inp.battery.size[0], inp.battery.size[1], inp.battery.size[2]];
  const fixedItems = (): MassItem[] => {
    const items: MassItem[] = [];
    for (let i = 0; i < n; i++) {
      const th = rotorAngle(n, i);
      const x = L * Math.cos(th), y = L * Math.sin(th);
      items.push({ name: `モータ ${i + 1}`, massG: inp.motor.massG, shape: 'cyl', center: [x, y, motorTop - inp.motor.length / 2], size: [inp.motor.diameter / 2, inp.motor.diameter / 2, inp.motor.length], topZ: motorTop, radius: inp.motor.diameter / 2 });
      const rEff = inp.prop.diameter / Math.sqrt(6);
      items.push({ name: `プロペラ ${i + 1}`, massG: inp.prop.massG, shape: 'cyl', center: [x, y, hubZ], size: [rEff, rEff, 1], topZ: hubZ + 1, radius: inp.prop.diameter / 2 });
    }
    items.push({ name: '基板（FR-4＋銅箔）', massG: inp.pcb.boardMassG, shape: 'box', center: [0, 0, pcbZ + inp.pcb.thickness / 2], size: [inp.pcb.w, inp.pcb.h, inp.pcb.thickness], topZ: pcbZ + inp.pcb.thickness, radius: Math.hypot(inp.pcb.w, inp.pcb.h) / 2 });
    for (const p of inp.pcb.parts) {
      if (p.massG <= 0) continue;
      items.push({ name: `部品 ${p.ref}`, massG: p.massG, shape: 'point', center: [p.x, p.y, pcbZ + inp.pcb.thickness + p.height / 2], size: [0, 0, 0], topZ: pcbZ + inp.pcb.thickness + p.height, radius: 1 });
    }
    const fx = inp.pcb.w / 2 + F.noseLength / 2;
    items.push({ name: 'フロー＋ToF モジュール', massG: inp.flow.massG, shape: 'box', center: [fx, 0, -inp.flow.size[2] / 2], size: inp.flow.size, topZ: 0, radius: 10 });
    items.push({ name: '配線・ねじ等', massG: inp.miscMassG, shape: 'point', center: [0, 0, F.plateThickness + 1], size: [0, 0, 0], topZ: 0, radius: 0 });
    return items;
  };

  let bx = 0, by = 0;
  const iterations: AirframeDesign['iterations'] = [];
  let built = buildFrame(wasm, inp, bx);
  let frame = toTriMesh(built.manifold);
  let mp = meshMassProps(frame);
  let items: MassItem[] = [];
  let total = { massG: 0, cg: [0, 0, 0] as [number, number, number], inertia: [] as number[] };
  for (let it = 0; it < 6; it++) {
    built = buildFrame(wasm, inp, bx);
    frame = toTriMesh(built.manifold);
    mp = meshMassProps(frame);
    const frameMass = mp.volume * F.density * F.printFill;
    const frameItem: MassItem = {
      name: 'フレーム（3D プリント）', massG: frameMass, shape: 'mesh', center: mp.centroid, size: [0, 0, 0],
      inertiaPerMass: mp.inertiaPerDensity.map((v) => v / mp.volume), topZ: F.tubeHeight, radius: 0,
    };
    const batteryItem: MassItem = { name: '電池', massG: inp.battery.massG, shape: 'box', center: [bx, by, -bh / 2], size: [bw, bl, bh], topZ: 0, radius: Math.hypot(bw, bl) / 2 };
    items = [frameItem, ...fixedItems(), batteryItem];
    total = combineMass(items);
    iterations.push({ iter: it, batteryX: bx, batteryY: by, cgX: total.cg[0], cgY: total.cg[1], massG: total.massG });
    if (Math.hypot(total.cg[0], total.cg[1]) < 0.02) break;
    bx -= (total.cg[0] * total.massG) / inp.battery.massG;
    by -= (total.cg[1] * total.massG) / inp.battery.massG;
  }

  // ---------------- checks ----------------
  const checks: Check[] = [];
  const ck = (label: string, value: number, limit: number, unit: string, op: 'lt' | 'gte', note = ''): void => {
    checks.push({ label, value, limit, unit, op, pass: op === 'lt' ? value < limit : value >= limit, note });
  };
  ck('重心と推力中心の水平ずれ', Math.hypot(total.cg[0], total.cg[1]), 2, 'mm', 'lt', `電池位置 x=${bx.toFixed(1)} mm, y=${by.toFixed(1)} mm で調整`);
  const tipGap = 2 * L * Math.sin(Math.PI / n) - inp.prop.diameter;
  ck('隣接プロペラ先端の隙間', tipGap, 5, 'mm', 'gte');
  // vertical clearance: highest item under each prop disk (excluding its own motor/prop/tube)
  let minVert = Infinity;
  let worst = '';
  const propBottom = hubZ - 1;
  for (let i = 0; i < n; i++) {
    const th = rotorAngle(n, i);
    const px = L * Math.cos(th), py = L * Math.sin(th);
    for (const itx of items) {
      if (itx.name === `モータ ${i + 1}` || itx.name === `プロペラ ${i + 1}` || itx.shape === 'mesh') continue;
      if (itx.name.startsWith('プロペラ')) continue;
      const d = Math.hypot(itx.center[0] - px, itx.center[1] - py);
      let under = d < inp.prop.diameter / 2 + itx.radius;
      if (itx.name.startsWith('基板')) {
        // board rectangle vs disk
        const dx = Math.max(Math.abs(px) - inp.pcb.w / 2, 0), dy = Math.max(Math.abs(py) - inp.pcb.h / 2, 0);
        under = Math.hypot(dx, dy) < inp.prop.diameter / 2;
      }
      if (under && propBottom - itx.topZ < minVert) {
        minVert = propBottom - itx.topZ;
        worst = itx.name;
      }
    }
    // the blade roots sweep over the motor tube top
    if (propBottom - F.tubeHeight < minVert) {
      minVert = propBottom - F.tubeHeight;
      worst = 'モータ固定チューブ上端';
    }
  }
  ck('プロペラ下面と直下の構造物の垂直隙間', minVert, 5, 'mm', 'gte', `最も近い: ${worst || 'フレーム'}`);
  const wt = manifoldCheck(frame);
  ck('STL の閉じた多様体性（境界辺＋非多様体辺）', wt.boundaryEdges + wt.nonManifoldEdges + wt.badOrientation, 1, '本', 'lt', 'manifold-3d のブーリアン演算で生成');
  ck('全備重量', total.massG, 100, 'g', 'lt', '100 g 未満＝模型航空機');
  // arm bending (cantilever, root section)
  const M = inp.maxThrustN * (L / 1000); // N m
  const Wsec = ((F.armWidth / 1000) * (F.armHeight / 1000) ** 2) / 6;
  const sigma = M / Wsec / 1e6;
  ck('腕の曲げ応力の安全率（最大推力）', F.plaAllowable / sigma, 3, '倍', 'gte', `σ=${sigma.toFixed(2)} MPa（PLA 許容 ${F.plaAllowable} MPa）`);
  const bounds = meshBounds(frame);
  ck('造形サイズ（最大辺）', Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]), 180, 'mm', 'lt', '一般的な 3D プリンタのベッド 180 mm');
  const rotors = Array.from({ length: n }, (_, i) => {
    const th = rotorAngle(n, i);
    return { x: L * Math.cos(th), y: L * Math.sin(th), hubZ, spin: (i % 2 === 0 ? 1 : -1) as 1 | -1 };
  });
  return {
    input: inp,
    frame,
    frameVolumeMm3: mp.volume,
    frameMassG: mp.volume * F.density * F.printFill,
    items,
    massG: total.massG,
    cg: total.cg,
    inertia: total.inertia,
    battery: { x: bx, y: by },
    rotors,
    plate: built.plate,
    pcbZ,
    checks,
    iterations,
    bounds,
    watertight: wt,
    manifoldStatus: String(built.manifold.status()),
  };
};
