/** Triangle-mesh utilities (mm units): volume, centroid, inertia, manifold check, STL. */

export interface TriMesh {
  /** xyz per vertex. */
  positions: Float32Array;
  /** 3 indices per triangle (CCW from outside). */
  indices: Uint32Array;
}

export interface MeshMassProps {
  volume: number;
  centroid: [number, number, number];
  /** Second moment of volume about the centroid (row-major 3x3), i.e. inertia / density. */
  inertiaPerDensity: number[];
  area: number;
}

export const meshMassProps = (m: TriMesh): MeshMassProps => {
  const p = m.positions, ix = m.indices;
  let vol = 0, cx = 0, cy = 0, cz = 0, area = 0;
  // C = ∫ x x^T dV about origin
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < ix.length; t += 3) {
    const a = [p[ix[t] * 3], p[ix[t] * 3 + 1], p[ix[t] * 3 + 2]];
    const b = [p[ix[t + 1] * 3], p[ix[t + 1] * 3 + 1], p[ix[t + 1] * 3 + 2]];
    const c = [p[ix[t + 2] * 3], p[ix[t + 2] * 3 + 1], p[ix[t + 2] * 3 + 2]];
    const v = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    vol += v;
    cx += (v * (a[0] + b[0] + c[0])) / 4;
    cy += (v * (a[1] + b[1] + c[1])) / 4;
    cz += (v * (a[2] + b[2] + c[2])) / 4;
    const s = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) C[i * 3 + j] += (v / 20) * (s[i] * s[j] + a[i] * a[j] + b[i] * b[j] + c[i] * c[j]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    area += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
  }
  const g: [number, number, number] = [cx / vol, cy / vol, cz / vol];
  // shift C to centroid: C_c = C - V g g^T
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] -= vol * g[i] * g[j];
  const tr = C[0] + C[4] + C[8];
  const I = C.map((x, k) => (k % 4 === 0 ? tr - x : -x));
  return { volume: vol, centroid: g, inertiaPerDensity: I, area };
};

/** Every edge shared by exactly two triangles with opposite orientation (closed, oriented 2-manifold). */
export const manifoldCheck = (m: TriMesh, tol = 1e-4): { watertight: boolean; boundaryEdges: number; nonManifoldEdges: number; badOrientation: number } => {
  // weld vertices by position
  const key = (i: number): string => `${Math.round(m.positions[i * 3] / tol)},${Math.round(m.positions[i * 3 + 1] / tol)},${Math.round(m.positions[i * 3 + 2] / tol)}`;
  const weld = new Map<string, number>();
  const id = new Uint32Array(m.positions.length / 3);
  for (let i = 0; i < id.length; i++) {
    const k = key(i);
    if (!weld.has(k)) weld.set(k, weld.size);
    id[i] = weld.get(k)!;
  }
  const edges = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = id[m.indices[t + e]], b = id[m.indices[t + ((e + 1) % 3)]];
      if (a === b) continue;
      const k = `${a}>${b}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0, badOrient = 0;
  for (const [k, n] of edges) {
    const [a, b] = k.split('>');
    const rev = edges.get(`${b}>${a}`) ?? 0;
    if (n > 1) badOrient++;
    if (rev === 0) boundary++;
    else if (n + rev > 2) nonManifold++;
  }
  return { watertight: boundary === 0 && nonManifold === 0 && badOrient === 0, boundaryEdges: boundary, nonManifoldEdges: nonManifold, badOrientation: badOrient };
};

export const meshToStl = (m: TriMesh, name = 'frame'): Uint8Array => {
  const n = m.indices.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const header = new TextEncoder().encode(`binary STL ${name} (mm)`.slice(0, 80));
  new Uint8Array(buf, 0, header.length).set(header);
  dv.setUint32(80, n, true);
  let o = 84;
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]) {
      dv.setFloat32(o, v, true);
      o += 4;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
};

/** Axis-aligned bounding box. */
export const meshBounds = (m: TriMesh): { min: [number, number, number]; max: [number, number, number] } => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], m.positions[i + k]);
      max[k] = Math.max(max[k], m.positions[i + k]);
    }
  return { min, max };
};
