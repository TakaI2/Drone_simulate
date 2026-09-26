import * as THREE from 'three';
import { mat, packageMesh } from '../parts3d/models';
import type { PcbDesign } from './types';

export interface Board3dOptions {
  /** Draw copper tracks on top (thin boxes). */
  tracks?: boolean;
  maskColor?: number;
}

/** Assembled PCB in mm (board bottom at z = 0, top copper at z = thickness). */
export const buildBoard3d = (d: PcbDesign, o: Board3dOptions = {}): THREE.Group => {
  const g = new THREE.Group();
  g.name = 'pcb';
  const t = d.rules.boardThickness;
  const hw = d.board.w / 2, hh = d.board.h / 2, r = d.board.cornerRadius;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(hw, hh - r);
  shape.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw + r, hh);
  shape.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-hw, -hh + r);
  shape.absarc(-hw + r, -hh + r, r, Math.PI, 1.5 * Math.PI, false);
  for (const p of d.pads) {
    if (!p.drill) continue;
    const h = new THREE.Path();
    h.absarc(p.x, p.y, p.drill / 2, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const boardGeo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 12 });
  const board = new THREE.Mesh(boardGeo, mat(o.maskColor ?? 0x14532d));
  board.receiveShadow = true;
  board.castShadow = true;
  g.add(board);
  // copper pads (ENIG gold look)
  const padMat = mat(0xd4af37, true);
  for (const p of d.pads) {
    if (p.npth) continue;
    const geo = p.shape === 'circle' ? new THREE.CylinderGeometry(p.w / 2, p.w / 2, 0.04, 20).rotateX(Math.PI / 2) : new THREE.BoxGeometry(p.w, p.h, 0.04);
    const m = new THREE.Mesh(geo, padMat);
    m.position.set(p.x, p.y, t + 0.02);
    g.add(m);
    if (p.drill) {
      const mb = m.clone();
      mb.position.z = -0.02;
      g.add(mb);
    }
  }
  if (o.tracks !== false) {
    const tm = { F: mat(0x1f7a3f), B: mat(0x1f7a3f) };
    for (const tr of d.tracks) {
      const len = Math.hypot(tr.x2 - tr.x1, tr.y2 - tr.y1);
      if (len < 1e-6) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(len + tr.width, tr.width, 0.03), tm[tr.layer]);
      m.position.set((tr.x1 + tr.x2) / 2, (tr.y1 + tr.y2) / 2, tr.layer === 'F' ? t + 0.015 : -0.015);
      m.rotation.z = Math.atan2(tr.y2 - tr.y1, tr.x2 - tr.x1);
      g.add(m);
    }
  }
  const viaMat = mat(0xc0c0c0, true);
  for (const v of d.vias) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(v.d / 2, v.d / 2, t + 0.08, 12).rotateX(Math.PI / 2), viaMat);
    m.position.set(v.x, v.y, t / 2);
    g.add(m);
  }
  // components
  for (const pl of d.placements) {
    if (pl.pkg.body.length === 0) continue;
    const m = packageMesh(pl.pkg);
    m.position.set(pl.x, pl.y, t);
    m.rotation.z = (pl.rot * Math.PI) / 180;
    m.name = pl.ref;
    g.add(m);
  }
  return g;
};
