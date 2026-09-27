import * as THREE from 'three';
import type { BodyPrim, PackageDef } from './packages';

/** Shared material cache (keyed by color + metal flag). */
const materials = new Map<string, THREE.MeshStandardMaterial>();
export const mat = (color: number, metal = false, opacity = 1): THREE.MeshStandardMaterial => {
  const key = `${color}-${metal}-${opacity}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: metal ? 0.7 : 0.05, roughness: metal ? 0.3 : 0.6, transparent: opacity < 1, opacity });
    materials.set(key, m);
  }
  return m;
};

export const primMesh = (p: BodyPrim, segments = 24): THREE.Mesh => {
  let geo: THREE.BufferGeometry;
  if (p.kind === 'box') {
    geo = new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]);
  } else {
    geo = new THREE.CylinderGeometry(p.s[0], p.s[1], p.s[2], segments);
    // three cylinders are along +y; rotate to requested axis
    if ((p.axis ?? 'z') === 'z') geo.rotateX(Math.PI / 2);
    else if (p.axis === 'x') geo.rotateZ(Math.PI / 2);
  }
  const mesh = new THREE.Mesh(geo, mat(p.color, p.metal));
  mesh.position.set(p.c[0], p.c[1], p.c[2]);
  mesh.castShadow = true;
  return mesh;
};

/** Component body (+ optional pad copper) in package coordinates (mm). */
export const packageMesh = (pkg: PackageDef, opts: { pads?: boolean } = {}): THREE.Group => {
  const g = new THREE.Group();
  g.name = pkg.id;
  for (const b of pkg.body) g.add(primMesh(b));
  if (opts.pads) {
    for (const p of pkg.pads) {
      if (p.npth) continue;
      const geo = p.shape === 'circle' ? new THREE.CylinderGeometry(p.w / 2, p.w / 2, 0.035, 20).rotateX(Math.PI / 2) : new THREE.BoxGeometry(p.w, p.h, 0.035);
      const m = new THREE.Mesh(geo, mat(0xd8c07a, true));
      m.position.set(p.x, p.y, 0.0175);
      g.add(m);
    }
  }
  return g;
};

// ------------------------------------------------------------------ assembly-level parts (mm)

export interface MotorDims {
  diameter: number;
  length: number;
  shaft: number;
}

/** Coreless brushed motor (can + shaft + wires) standing on +z. */
export const corelessMotorMesh = (d: MotorDims): THREE.Group => {
  const g = new THREE.Group();
  g.add(primMesh({ kind: 'cyl', c: [0, 0, d.length / 2], s: [d.diameter / 2, d.diameter / 2, d.length], axis: 'z', color: 0xb0b4ba, metal: true }));
  g.add(primMesh({ kind: 'cyl', c: [0, 0, d.length + 0.6], s: [d.diameter / 2 - 1, d.diameter / 2 - 1, 1.2], axis: 'z', color: 0x444444 }));
  g.add(primMesh({ kind: 'cyl', c: [0, 0, d.length + 3], s: [d.shaft / 2, d.shaft / 2, 5], axis: 'z', color: 0xdddddd, metal: true }));
  g.add(primMesh({ kind: 'box', c: [0, 0, -0.8], s: [d.diameter * 0.6, 1.2, 1.6], color: 0x333333 }));
  return g;
};

/** Brushless outrunner (bell + stator base). */
export const brushlessMotorMesh = (d: MotorDims): THREE.Group => {
  const g = new THREE.Group();
  g.add(primMesh({ kind: 'cyl', c: [0, 0, d.length * 0.2], s: [d.diameter / 2 - 1, d.diameter / 2 - 1, d.length * 0.4], axis: 'z', color: 0x333333 }));
  g.add(primMesh({ kind: 'cyl', c: [0, 0, d.length * 0.65], s: [d.diameter / 2, d.diameter / 2, d.length * 0.7], axis: 'z', color: 0x9e9e9e, metal: true }));
  g.add(primMesh({ kind: 'cyl', c: [0, 0, d.length + 4], s: [d.shaft / 2, d.shaft / 2, 8], axis: 'z', color: 0xdddddd, metal: true }));
  return g;
};

/** Two/three-blade propeller with hub, lying in the xy plane. spin +1 = CCW (color-coded). */
export const propellerMesh = (diameter: number, blades: number, spin: 1 | -1): THREE.Group => {
  const g = new THREE.Group();
  const color = spin > 0 ? 0xf0f0f0 : 0xff8a3d;
  const hubR = Math.max(1.5, diameter * 0.035);
  g.add(primMesh({ kind: 'cyl', c: [0, 0, 0], s: [hubR, hubR, 2.5], axis: 'z', color }));
  for (let i = 0; i < blades; i++) {
    const len = diameter / 2 - hubR;
    const chord = diameter * 0.1;
    const shape = new THREE.Shape();
    shape.moveTo(0, -chord * 0.35);
    shape.quadraticCurveTo(len * 0.4, -chord * 0.6, len, -chord * 0.15);
    shape.quadraticCurveTo(len * 1.02, chord * 0.1, len * 0.9, chord * 0.25);
    shape.quadraticCurveTo(len * 0.4, chord * 0.55, 0, chord * 0.35);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
    geo.translate(hubR * 0.8, 0, -0.3);
    const blade = new THREE.Mesh(geo, mat(color, false, 0.95));
    blade.rotation.z = (2 * Math.PI * i) / blades;
    blade.rotation.x = spin * 0.18; // pitch hint
    blade.castShadow = true;
    g.add(blade);
  }
  return g;
};

/** Transparent disk showing the prop sweep. */
export const propDiskMesh = (diameter: number): THREE.Mesh => {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(diameter / 2, 48),
    new THREE.MeshBasicMaterial({ color: 0x9ec5f4, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  );
  return m;
};

/** LiPo pack (soft pouch with lead + connector). */
export const lipoMesh = (l: number, w: number, h: number): THREE.Group => {
  const g = new THREE.Group();
  g.add(primMesh({ kind: 'box', c: [0, 0, h / 2], s: [l, w, h], color: 0x2f5f9f }));
  g.add(primMesh({ kind: 'box', c: [0, 0, h + 0.05], s: [l * 0.7, w * 0.6, 0.1], color: 0xffd54f }));
  g.add(primMesh({ kind: 'box', c: [l / 2 + 3, 0, h / 2], s: [6, 2.5, 1.2], color: 0xd32f2f }));
  g.add(primMesh({ kind: 'box', c: [l / 2 + 7, 0, h / 2], s: [4, 5, 3], color: 0xf5f5f5 }));
  return g;
};

/** Optical-flow + ToF breakout board (sensor facing -z). */
export const flowModuleMesh = (): THREE.Group => {
  const g = new THREE.Group();
  g.add(primMesh({ kind: 'box', c: [0, 0, 0.5], s: [20, 15, 1.0], color: 0x1b5e20 }));
  g.add(primMesh({ kind: 'box', c: [-4, 0, -1.2], s: [6, 6, 2.4], color: 0x222222 }));
  g.add(primMesh({ kind: 'cyl', c: [-4, 0, -2.6], s: [1.6, 1.6, 0.8], axis: 'z', color: 0x555555 }));
  g.add(primMesh({ kind: 'box', c: [5, 0, -0.8], s: [4.9, 2.5, 1.6], color: 0x111111 }));
  return g;
};

/** 4-in-1 ESC board (MOSFETs both sides, motor pads at the corners), bottom at z = 0. */
export const escBoardMesh = (w: number, h: number, height: number): THREE.Group => {
  const g = new THREE.Group();
  const t = 1.0;
  const zb = height / 2 - t / 2;
  g.add(primMesh({ kind: 'box', c: [0, 0, zb + t / 2], s: [w, h, t], color: 0x1a237e }));
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      g.add(primMesh({ kind: 'box', c: [sx * w * 0.22, sy * h * 0.22, zb + t + 0.5], s: [3.3, 3.3, 1.0], color: 0x222222 }));
      g.add(primMesh({ kind: 'box', c: [sx * w * 0.22, sy * h * 0.22, zb - 0.5], s: [3.3, 3.3, 1.0], color: 0x222222 }));
      g.add(primMesh({ kind: 'box', c: [sx * (w / 2 - 1.5), sy * (h / 2 - 5), zb + t + 0.05], s: [2.2, 3.0, 0.1], color: 0xc9a227, metal: true }));
    }
  g.add(primMesh({ kind: 'box', c: [0, 0, zb + t + 0.5], s: [5, 5, 1.0], color: 0x222222 }));
  g.add(primMesh({ kind: 'box', c: [0, -h / 2 - 3, zb + t / 2], s: [6, 6, 3], color: 0xf2c200 }));
  return g;
};

/** GNSS + compass module (ceramic patch on a small PCB), bottom at z = 0. */
export const gnssModuleMesh = (w: number, h: number, height: number): THREE.Group => {
  const g = new THREE.Group();
  g.add(primMesh({ kind: 'box', c: [0, 0, 0.5], s: [w, h, 1.0], color: 0x0d47a1 }));
  const patch = Math.min(w, h) * 0.9;
  const ph = Math.max(1, height - 1.5);
  g.add(primMesh({ kind: 'box', c: [0, 0, 1 + ph / 2], s: [patch, patch, ph], color: 0xe8dcc0 }));
  g.add(primMesh({ kind: 'box', c: [0, 0, 1 + ph + 0.05], s: [patch * 0.7, patch * 0.7, 0.1], color: 0xc9a227, metal: true }));
  return g;
};
