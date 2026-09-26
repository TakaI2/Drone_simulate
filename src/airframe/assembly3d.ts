import * as THREE from 'three';
import { buildBoard3d } from '../pcb/board3d';
import type { PcbDesign } from '../pcb/types';
import { corelessMotorMesh, flowModuleMesh, lipoMesh, mat, propDiskMesh, propellerMesh } from '../parts3d/models';
import { FRAME_DEFAULTS } from './design';
import type { AirframeInput } from './design';

export interface AssemblyInfo {
  input: AirframeInput;
  battery: { x: number; y: number };
  rotors: Array<{ x: number; y: number; hubZ: number; spin: 1 | -1 }>;
  pcbZ: number;
  cg: [number, number, number];
}

export interface AssemblyOptions {
  showPropDisks?: boolean;
  frameColor?: number;
  showCg?: boolean;
}

export interface Assembly {
  group: THREE.Group;
  props: THREE.Object3D[];
}

/** Complete vehicle in mm (body frame FLU, z = 0 at frame bottom). */
export const buildAssembly = (frameGeo: THREE.BufferGeometry, pcb: PcbDesign | null, a: AssemblyInfo, o: AssemblyOptions = {}): Assembly => {
  const g = new THREE.Group();
  g.name = 'drone-assembly';
  frameGeo.computeVertexNormals();
  const frame = new THREE.Mesh(frameGeo, new THREE.MeshStandardMaterial({ color: o.frameColor ?? 0xf2f2f2, roughness: 0.7 }));
  frame.castShadow = true;
  frame.receiveShadow = true;
  frame.name = 'frame';
  g.add(frame);
  if (pcb) {
    const board = buildBoard3d(pcb, { tracks: false });
    board.position.z = a.pcbZ;
    g.add(board);
  }
  const F = FRAME_DEFAULTS;
  const motorTop = F.tubeHeight + F.motorAboveTube;
  const props: THREE.Object3D[] = [];
  for (const r of a.rotors) {
    const m = corelessMotorMesh({ diameter: a.input.motor.diameter, length: a.input.motor.length, shaft: 1 });
    m.position.set(r.x, r.y, motorTop - a.input.motor.length);
    g.add(m);
    const p = propellerMesh(a.input.prop.diameter, a.input.prop.blades, r.spin);
    p.position.set(r.x, r.y, r.hubZ);
    p.userData.spin = r.spin;
    props.push(p);
    g.add(p);
    if (o.showPropDisks) {
      const disk = propDiskMesh(a.input.prop.diameter);
      disk.position.set(r.x, r.y, r.hubZ + 0.5);
      g.add(disk);
    }
  }
  const [bl, bw, bh] = a.input.battery.size;
  const bat = lipoMesh(bl, bw, bh);
  bat.rotation.z = Math.PI / 2; // length along y
  bat.position.set(a.battery.x, a.battery.y, -bh);
  g.add(bat);
  const flow = flowModuleMesh();
  flow.position.set(a.input.pcb.w / 2 + F.noseLength / 2, 0, -1.2);
  flow.rotation.z = 0;
  g.add(flow);
  if (o.showCg) {
    const cg = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 16), mat(0xe34948));
    cg.position.set(a.cg[0], a.cg[1], a.cg[2]);
    g.add(cg);
    const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 40, 8).rotateX(Math.PI / 2), mat(0xe34948));
    axis.position.set(0, 0, a.cg[2]);
    g.add(axis);
  }
  return { group: g, props };
};

export const triMeshToGeometry = (positions: Float32Array, indices: Uint32Array): THREE.BufferGeometry => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
};
