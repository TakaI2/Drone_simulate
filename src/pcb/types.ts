import type { NetClass } from '../electrical/circuit';
import type { PackageDef, PadShape } from '../parts3d/packages';

export type Layer = 'F' | 'B';

/** Fabrication-oriented design rules (mm). Defaults are conservative vs. common 2-layer fab capability. */
export interface DesignRules {
  clearance: number;
  edgeClearance: number;
  trackWidth: Record<NetClass | 'power3v3' | 'vbat', number>;
  viaDiameter: number;
  viaDrill: number;
  minAnnularRing: number;
  minDrill: number;
  minTrack: number;
  /** Routing grid resolution. */
  grid: number;
  /** Cost of a via in grid steps. */
  viaCost: number;
  /** Multiplier for routing on the bottom layer (keeps B mostly ground plane). */
  bottomPenalty: number;
  /** Extra cost for changing direction (in grid steps). */
  bendCost: number;
  maskExpansion: number;
  silkWidth: number;
  stitchPitch: number;
  boardThickness: number;
}

export const DEFAULT_RULES: DesignRules = {
  clearance: 0.15,
  edgeClearance: 0.3,
  trackWidth: { signal: 0.15, power: 0.3, power3v3: 0.3, vbat: 1.0, motor: 0.8, gnd: 0.3 },
  viaDiameter: 0.6,
  viaDrill: 0.3,
  minAnnularRing: 0.13,
  minDrill: 0.3,
  minTrack: 0.127,
  grid: 0.05,
  viaCost: 24,
  bottomPenalty: 1.6,
  bendCost: 2,
  maskExpansion: 0.05,
  silkWidth: 0.15,
  stitchPitch: 2.5,
  boardThickness: 0.8,
};

export interface Placement {
  ref: string;
  pkg: PackageDef;
  x: number;
  y: number;
  /** Rotation in degrees (0/90/180/270), counter-clockwise. */
  rot: number;
}

export interface PlacedPad {
  ref: string;
  num: string;
  net: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: PadShape;
  drill?: number;
  npth?: boolean;
  layers: Layer[];
}

export interface Track {
  net: string;
  layer: Layer;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

export type ViaKind = 'route' | 'gnd' | 'stitch' | 'thermal';

export interface Via {
  net: string;
  x: number;
  y: number;
  d: number;
  drill: number;
  kind: ViaKind;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Copper area of one net on one layer, stored as axis-aligned rectangles (union). */
export interface Zone {
  net: string;
  layer: Layer;
  rects: Rect[];
  kind: 'pour' | 'thermal';
}

export interface Board {
  w: number;
  h: number;
  cornerRadius: number;
}

export interface PcbDesign {
  name: string;
  board: Board;
  rules: DesignRules;
  placements: Placement[];
  pads: PlacedPad[];
  tracks: Track[];
  vias: Via[];
  zones: Zone[];
  /** Keep-out rectangles for copper on both layers (antenna). */
  keepouts: Rect[];
  /** Keep-out rectangles on one layer (under module bodies). */
  layerKeepouts: Array<{ layer: Layer; rect: Rect }>;
  unrouted: Array<{ net: string; detail: string }>;
  log: string[];
}

export const netWidth = (rules: DesignRules, net: string, cls: NetClass): number => {
  if (net === 'VBAT') return rules.trackWidth.vbat;
  if (net === '3V3') return rules.trackWidth.power3v3;
  return rules.trackWidth[cls];
};
