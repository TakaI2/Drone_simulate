/**
 * City data acquisition with a local cache (.cache/city, not versioned):
 * - OpenStreetMap buildings and parks via the Overpass API (one request per area)
 * - PLATEAU building CityGML: only the needed files are read out of the city-wide ZIP with HTTP Range requests
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import type { OverpassElement } from '../src/geo/city';

const CACHE = '.cache/city';
const UA = 'DroneDesignStudio/0.1 (simulation research; contact via repository)';

const cached = async (file: string, fetcher: () => Promise<Buffer>): Promise<Buffer> => {
  const f = `${CACHE}/${file}`;
  if (existsSync(f)) return readFileSync(f);
  mkdirSync(CACHE, { recursive: true });
  const buf = await fetcher();
  writeFileSync(f, buf);
  return buf;
};

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export const bboxAround = (lat: number, lon: number, halfSize: number): BBox => {
  const dLat = halfSize / 111_320;
  const dLon = halfSize / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
};

export const fetchOsm = async (endpoint: string, b: BBox): Promise<{ elements: OverpassElement[]; fromCache: boolean; key: string }> => {
  const box = `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;
  const key = `osm-v2_${box.replace(/[,.]/g, '_')}.json`;
  const fromCache = existsSync(`${CACHE}/${key}`);
  const q = `[out:json][timeout:120];(way["building"](${box});relation["building"](${box});way["building:part"](${box});way["leisure"="park"](${box});relation["leisure"="park"](${box}););out body geom;`;
  const buf = await cached(key, async () => {
    const r = await fetch(endpoint, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA } });
    if (!r.ok) throw new Error(`Overpass ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  });
  return { elements: (JSON.parse(buf.toString('utf-8')) as { elements: OverpassElement[] }).elements, fromCache, key };
};

const range = async (url: string, start: number, end: number): Promise<Buffer> => {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}`, 'User-Agent': UA } });
  if (r.status !== 206) throw new Error(`Range request failed (${r.status}) for ${url}`);
  return Buffer.from(await r.arrayBuffer());
};

interface ZipEntry {
  name: string;
  method: number;
  csize: number;
  usize: number;
  offset: number;
}

/** Central directory of a remote ZIP (non-ZIP64). */
const remoteZipIndex = async (url: string): Promise<ZipEntry[]> => {
  const buf = await cached(`zipindex_${Buffer.from(url).toString('base64url').slice(-40)}.bin`, async () => {
    const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
    const len = Number(head.headers.get('content-length'));
    const tail = await range(url, Math.max(0, len - 65557), len - 1);
    const i = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (i < 0) throw new Error('ZIP の終端レコードが見つかりません（ZIP64 は未対応）');
    const cdSize = tail.readUInt32LE(i + 12), cdOff = tail.readUInt32LE(i + 16);
    return range(url, cdOff, cdOff + cdSize - 1);
  });
  const out: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50) {
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    out.push({ name: buf.subarray(p + 46, p + 46 + nl).toString('utf-8'), method: buf.readUInt16LE(p + 10), csize: buf.readUInt32LE(p + 20), usize: buf.readUInt32LE(p + 24), offset: buf.readUInt32LE(p + 42) });
    p += 46 + nl + el + cl;
  }
  return out;
};

const readEntry = async (url: string, e: ZipEntry): Promise<Buffer> => {
  const lh = await range(url, e.offset, e.offset + 29);
  const dataStart = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const data = await range(url, dataStart, dataStart + e.csize - 1);
  return e.method === 8 ? inflateRawSync(data) : data;
};

/** PLATEAU building GML (LOD1/2) for the given 3rd-order mesh codes. */
export const fetchPlateauBuildings = async (url: string, meshes: readonly string[]): Promise<Array<{ mesh: string; file: string; gml: string; bytes: number }>> => {
  const index = await remoteZipIndex(url);
  const out: Array<{ mesh: string; file: string; gml: string; bytes: number }> = [];
  for (const mesh of meshes) {
    const e = index.find((x) => x.name.startsWith('udx/bldg/') && x.name.endsWith('.gml') && x.name.includes(`${mesh}_bldg`));
    if (!e) throw new Error(`PLATEAU に ${mesh} の建築物ファイルがありません`);
    const buf = await cached(`plateau_${mesh}_bldg.gml`, () => readEntry(url, e));
    out.push({ mesh, file: e.name, gml: buf.toString('utf-8'), bytes: buf.length });
  }
  return out;
};
