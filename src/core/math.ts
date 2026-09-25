/** Minimal allocation-light vector / quaternion / matrix helpers (SI, right-handed). */

export interface Vec3 { x: number; y: number; z: number }
export interface Quat { w: number; x: number; y: number; z: number }
/** Row-major 3x3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vScale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vCross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vLen = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const vNorm = (a: Vec3): Vec3 => {
  const l = vLen(a);
  return l > 1e-12 ? vScale(a, 1 / l) : v3();
};
export const vMul = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x * b.x, y: a.y * b.y, z: a.z * b.z });
export const vDist = (a: Vec3, b: Vec3): number => vLen(vSub(a, b));
export const vLerp = (a: Vec3, b: Vec3, t: number): Vec3 => vAdd(a, vScale(vSub(b, a), t));
export const vClampLen = (a: Vec3, max: number): Vec3 => {
  const l = vLen(a);
  return l > max && l > 0 ? vScale(a, max / l) : a;
};
export const vHoriz = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: 0 });

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;
export const wrapPi = (a: number): number => {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
};

// ---------- Quaternion (body -> world) ----------
export const qIdentity = (): Quat => ({ w: 1, x: 0, y: 0, z: 0 });
export const qMul = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
export const qConj = (q: Quat): Quat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });
export const qNorm = (q: Quat): Quat => {
  const n = Math.hypot(q.w, q.x, q.y, q.z);
  return n > 0 ? { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n } : qIdentity();
};
export const qFromAxisAngle = (axis: Vec3, angle: number): Quat => {
  const a = vNorm(axis);
  const s = Math.sin(angle / 2);
  return { w: Math.cos(angle / 2), x: a.x * s, y: a.y * s, z: a.z * s };
};
/** ZYX (yaw-pitch-roll) euler to quaternion. */
export const qFromEuler = (roll: number, pitch: number, yaw: number): Quat => {
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  return {
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
  };
};
export const qToEuler = (q: Quat): { roll: number; pitch: number; yaw: number } => {
  const roll = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
  const pitch = Math.asin(clamp(2 * (q.w * q.y - q.z * q.x), -1, 1));
  const yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  return { roll, pitch, yaw };
};
/** Rotate vector by quaternion (body -> world when q is attitude). */
export const qRotate = (q: Quat, v: Vec3): Vec3 => {
  // t = 2 * cross(q.xyz, v); v' = v + w t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
};
export const qRotateInv = (q: Quat, v: Vec3): Vec3 => qRotate(qConj(q), v);
/** Quaternion derivative integration step for body rates omega over dt (exact exponential map). */
export const qIntegrate = (q: Quat, omega: Vec3, dt: number): Quat => {
  const angle = vLen(omega) * dt;
  if (angle < 1e-12) return q;
  return qNorm(qMul(q, qFromAxisAngle(omega, angle)));
};
/** Shortest rotation taking unit vector a to unit vector b. */
export const qFromTwoVectors = (a: Vec3, b: Vec3): Quat => {
  const d = vDot(a, b);
  if (d < -0.999999) {
    const ortho = Math.abs(a.x) < 0.9 ? vCross(a, v3(1, 0, 0)) : vCross(a, v3(0, 1, 0));
    return qFromAxisAngle(ortho, Math.PI);
  }
  const c = vCross(a, b);
  return qNorm({ w: 1 + d, x: c.x, y: c.y, z: c.z });
};

// ---------- Mat3 ----------
export const m3Identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const m3Diag = (a: number, b: number, c: number): Mat3 => [a, 0, 0, 0, b, 0, 0, 0, c];
export const m3MulVec = (m: Mat3, v: Vec3): Vec3 => ({
  x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
  y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
  z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
});
export const m3Add = (a: Mat3, b: Mat3): Mat3 => a.map((x, i) => x + b[i]) as Mat3;
export const m3Scale = (a: Mat3, s: number): Mat3 => a.map((x) => x * s) as Mat3;
export const m3Det = (m: Mat3): number =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
export const m3Inverse = (m: Mat3): Mat3 => {
  const d = m3Det(m);
  if (Math.abs(d) < 1e-18) throw new Error('Singular 3x3 matrix');
  const id = 1 / d;
  return [
    (m[4] * m[8] - m[5] * m[7]) * id,
    (m[2] * m[7] - m[1] * m[8]) * id,
    (m[1] * m[5] - m[2] * m[4]) * id,
    (m[5] * m[6] - m[3] * m[8]) * id,
    (m[0] * m[8] - m[2] * m[6]) * id,
    (m[2] * m[3] - m[0] * m[5]) * id,
    (m[3] * m[7] - m[4] * m[6]) * id,
    (m[1] * m[6] - m[0] * m[7]) * id,
    (m[0] * m[4] - m[1] * m[3]) * id,
  ];
};

// ---------- Generic dense matrices (for control allocation) ----------
export type Matrix = number[][];
export const matMul = (a: Matrix, b: Matrix): Matrix =>
  a.map((row) => b[0].map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0)));
export const matT = (a: Matrix): Matrix => a[0].map((_, j) => a.map((row) => row[j]));
export const matVec = (a: Matrix, v: number[]): number[] => a.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));
/** Gauss-Jordan inverse with partial pivoting. Returns null if singular. */
export const matInverse = (a: Matrix): Matrix | null => {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    const pv = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row) => row.slice(n));
};
export const matDet = (a: Matrix): number => {
  const n = a.length;
  const m = a.map((r) => [...r]);
  let det = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-15) return 0;
    if (p !== c) {
      [m[c], m[p]] = [m[p], m[c]];
      det = -det;
    }
    det *= m[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let j = c; j < n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return det;
};
/** Right pseudo-inverse B^T (B B^T)^-1 for a full-row-rank wide matrix. */
export const matPinvRight = (b: Matrix): Matrix | null => {
  const bt = matT(b);
  const inv = matInverse(matMul(b, bt));
  return inv ? matMul(bt, inv) : null;
};
