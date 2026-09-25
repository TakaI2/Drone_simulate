import * as THREE from 'three';
import type { DroneParams } from '../core/types';

export interface DroneMesh {
  group: THREE.Group;
  /** Spin props according to rotor speeds [rad/s] (visually capped). */
  update: (rotorSpeed: number[], dt: number) => void;
}

const MAT = {
  arm: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6 }),
  body: new THREE.MeshStandardMaterial({ color: 0x3a7bd5, roughness: 0.5 }),
  motor: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.35 }),
  propCcw: new THREE.MeshStandardMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.85 }),
  propCw: new THREE.MeshStandardMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.85 }),
  front: new THREE.MeshStandardMaterial({ color: 0xe34948 }),
};

/** Procedural placeholder drone built from simulation parameters (used before a full airframe design exists). */
export const buildDroneMesh = (p: DroneParams, scale = 1): DroneMesh => {
  const group = new THREE.Group();
  const arm = Math.hypot(p.rotors[0].position.x, p.rotors[0].position.y);
  const bodySize = arm * 0.7;
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodySize, bodySize * 0.8, bodySize * 0.25), MAT.body);
  body.castShadow = true;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(bodySize * 0.15, bodySize * 0.3, bodySize * 0.1), MAT.front);
  nose.position.set(bodySize * 0.55, 0, 0);
  group.add(nose);
  const props: THREE.Object3D[] = [];
  for (const r of p.rotors) {
    const len = Math.hypot(r.position.x, r.position.y);
    const a = new THREE.Mesh(new THREE.BoxGeometry(len, arm * 0.08, arm * 0.05), MAT.arm);
    a.position.set(r.position.x / 2, r.position.y / 2, 0);
    a.rotation.z = Math.atan2(r.position.y, r.position.x);
    a.castShadow = true;
    group.add(a);
    const md = Math.max(r.motor.diameter, arm * 0.1);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(md / 2, md / 2, md * 1.1, 16), MAT.motor);
    motor.rotation.x = Math.PI / 2;
    motor.position.set(r.position.x, r.position.y, r.position.z);
    motor.castShadow = true;
    group.add(motor);
    const prop = new THREE.Group();
    const bladeGeo = new THREE.BoxGeometry(r.prop.diameter, r.prop.diameter * 0.08, 0.002);
    const blade = new THREE.Mesh(bladeGeo, r.spin > 0 ? MAT.propCcw : MAT.propCw);
    prop.add(blade);
    const disk = new THREE.Mesh(
      new THREE.CircleGeometry(r.prop.diameter / 2, 32),
      new THREE.MeshBasicMaterial({ color: r.spin > 0 ? 0xffffff : 0xff8a3d, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    );
    prop.add(disk);
    prop.position.set(r.position.x, r.position.y, r.position.z + md * 0.6);
    prop.userData.spin = r.spin;
    props.push(prop);
    group.add(prop);
  }
  group.scale.setScalar(scale);
  const update = (rotorSpeed: number[], dt: number): void => {
    props.forEach((pr, i) => {
      const w = Math.min(rotorSpeed[i] ?? 0, 60); // visual cap to avoid aliasing
      pr.rotation.z += (pr.userData.spin as number) * w * dt;
    });
  };
  return { group, update };
};
