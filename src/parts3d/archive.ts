import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { packageMesh } from './models';
import { PACKAGES, getPackage } from './packages';

export interface ArchiveEntry {
  id: string;
  family: string;
  description: string;
  standard: string;
  pads: number;
  courtyardMm: [number, number];
  heightMm: number;
  verify: boolean;
  stlFile: string;
  stlBytes: number;
  triangles: number;
}

/** Export every package body (+pads) as binary STL; returns catalog entries and file contents. */
export const buildPartsArchive = (): { entries: ArchiveEntry[]; files: Record<string, Uint8Array> } => {
  const exporter = new STLExporter();
  const entries: ArchiveEntry[] = [];
  const files: Record<string, Uint8Array> = {};
  for (const id of Object.keys(PACKAGES)) {
    const pkg = getPackage(id);
    const group = packageMesh(pkg, { pads: true });
    group.updateMatrixWorld(true);
    let tris = 0;
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const geo = m.geometry;
        tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      }
    });
    const data = exporter.parse(group, { binary: true }) as DataView;
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const file = `${id}.stl`;
    files[file] = bytes;
    entries.push({
      id,
      family: pkg.family,
      description: pkg.description,
      standard: pkg.standard,
      pads: pkg.pads.length,
      courtyardMm: [+(pkg.courtyard.w * 2).toFixed(2), +(pkg.courtyard.h * 2).toFixed(2)],
      heightMm: +pkg.height.toFixed(2),
      verify: !!pkg.verify,
      stlFile: file,
      stlBytes: bytes.length,
      triangles: tris,
    });
  }
  return { entries, files };
};
