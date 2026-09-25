import * as THREE from 'three';
import type { Vec3 } from '../core/math';
import type { CourseSpec, EnvironmentSpec, Obstacle } from '../core/types';

export const obstacleMesh = (o: Obstacle): THREE.Mesh => {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.8, transparent: true, opacity: 0.9 });
  let mesh: THREE.Mesh;
  if (o.kind === 'box') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(o.size.x, o.size.y, o.size.z), mat);
    mesh.position.set(o.center.x, o.center.y, o.center.z);
  } else {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(o.radius, o.radius, o.height, 32), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(o.base.x, o.base.y, o.base.z + o.height / 2);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = o.id;
  return mesh;
};

export const markerMesh = (p: Vec3, color: number, label: string): THREE.Group => {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.01, 32), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.6 }));
  pad.rotation.x = Math.PI / 2;
  g.add(pad);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 8), new THREE.MeshBasicMaterial({ color }));
  pole.rotation.x = Math.PI / 2;
  pole.position.z = 0.2;
  g.add(pole);
  g.position.set(p.x, p.y, p.z + 0.005);
  g.name = label;
  return g;
};

export const polyline = (pts: Vec3[], color: number, dashed = false, width = 1): THREE.Line => {
  const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.1, gapSize: 0.06, linewidth: width })
    : new THREE.LineBasicMaterial({ color, linewidth: width });
  const line = new THREE.Line(geo, mat);
  if (dashed) line.computeLineDistances();
  return line;
};

/** Growable trajectory line. */
export const createTrail = (color: number, capacity = 60000) => {
  const positions = new Float32Array(capacity * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
  line.frustumCulled = false;
  let n = 0;
  return {
    line,
    push: (p: Vec3) => {
      if (n >= capacity) return;
      positions[n * 3] = p.x;
      positions[n * 3 + 1] = p.y;
      positions[n * 3 + 2] = p.z;
      n++;
      geo.setDrawRange(0, n);
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    },
    clear: () => {
      n = 0;
      geo.setDrawRange(0, 0);
    },
  };
};

export const boundsBox = (env: EnvironmentSpec): THREE.LineSegments => {
  const s = new THREE.Vector3(env.boundsMax.x - env.boundsMin.x, env.boundsMax.y - env.boundsMin.y, env.boundsMax.z - env.boundsMin.z);
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x, s.y, s.z)), new THREE.LineBasicMaterial({ color: 0x3a3f46 }));
  box.position.set((env.boundsMax.x + env.boundsMin.x) / 2, (env.boundsMax.y + env.boundsMin.y) / 2, (env.boundsMax.z + env.boundsMin.z) / 2);
  return box;
};

export const windArrow = (env: EnvironmentSpec): THREE.ArrowHelper | null => {
  const w = env.wind.mean;
  const len = Math.hypot(w.x, w.y, w.z);
  if (len < 1e-3) return null;
  const dir = new THREE.Vector3(w.x, w.y, w.z).normalize();
  const origin = new THREE.Vector3(env.boundsMin.x + 0.5, env.boundsMin.y + 0.5, 2.5);
  return new THREE.ArrowHelper(dir, origin, 0.4 * len, 0x6da7ec, 0.2, 0.12);
};

export const buildCourseGroup = (course: CourseSpec, env: EnvironmentSpec): THREE.Group => {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(env.boundsMax.x - env.boundsMin.x, env.boundsMax.y - env.boundsMin.y),
    new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 1 }),
  );
  floor.position.set((env.boundsMax.x + env.boundsMin.x) / 2, (env.boundsMax.y + env.boundsMin.y) / 2, -0.001);
  floor.receiveShadow = true;
  g.add(floor);
  g.add(boundsBox(env));
  for (const o of course.obstacles) g.add(obstacleMesh(o));
  g.add(markerMesh(course.start, 0x1baf7a, 'start'));
  g.add(markerMesh(course.goal, 0xeb6834, 'goal'));
  for (const w of course.waypoints) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 12), new THREE.MeshBasicMaterial({ color: 0xeda100 }));
    m.position.set(w.x, w.y, w.z);
    g.add(m);
  }
  const arrow = windArrow(env);
  if (arrow) g.add(arrow);
  return g;
};
