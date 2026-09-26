/**
 * Minimal single-stroke vector font (uppercase, digits, a few symbols) for silkscreen text.
 * Glyph coordinates on a 4 (w) x 6 (h) grid, origin bottom-left. Each glyph = list of polylines.
 */
type Glyph = number[][];

const G: Record<string, Glyph> = {
  A: [[0, 0, 0, 4, 2, 6, 4, 4, 4, 0], [0, 3, 4, 3]],
  B: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3], [3, 3, 4, 2, 4, 1, 3, 0, 0, 0]],
  C: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]],
  D: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 1, 3, 0, 0, 0]],
  E: [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  F: [[0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  G: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 3, 2, 3]],
  H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  I: [[1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]],
  J: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 6]],
  K: [[0, 0, 0, 6], [4, 6, 0, 2], [1, 3, 4, 0]],
  L: [[0, 6, 0, 0, 4, 0]],
  M: [[0, 0, 0, 6, 2, 3, 4, 6, 4, 0]],
  N: [[0, 0, 0, 6, 4, 0, 4, 6]],
  O: [[1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0]],
  P: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]],
  Q: [[1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0], [2, 2, 4, 0]],
  R: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3], [2, 3, 4, 0]],
  S: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 4, 1, 3, 3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1]],
  T: [[0, 6, 4, 6], [2, 6, 2, 0]],
  U: [[0, 6, 0, 1, 1, 0, 3, 0, 4, 1, 4, 6]],
  V: [[0, 6, 2, 0, 4, 6]],
  W: [[0, 6, 1, 0, 2, 3, 3, 0, 4, 6]],
  X: [[0, 0, 4, 6], [0, 6, 4, 0]],
  Y: [[0, 6, 2, 3, 4, 6], [2, 3, 2, 0]],
  Z: [[0, 6, 4, 6, 0, 0, 4, 0]],
  '0': [[1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0], [0, 1, 4, 5]],
  '1': [[1, 5, 2, 6, 2, 0], [1, 0, 3, 0]],
  '2': [[0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 0, 0, 4, 0]],
  '3': [[0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1], [1, 3, 3, 3]],
  '4': [[3, 0, 3, 6, 0, 2, 4, 2]],
  '5': [[4, 6, 0, 6, 0, 3, 3, 3, 4, 2, 4, 1, 3, 0, 0, 0]],
  '6': [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3]],
  '7': [[0, 6, 4, 6, 1, 0]],
  '8': [[1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3]],
  '9': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 4, 1, 3, 4, 3]],
  '-': [[0, 3, 4, 3]],
  '+': [[0, 3, 4, 3], [2, 1, 2, 5]],
  '.': [[2, 0, 2, 0.3]],
  '/': [[0, 0, 4, 6]],
  ' ': [],
};

export interface Stroke {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Strokes for a text string, centred at (cx, cy), cap height `h` [mm]. */
export const textStrokes = (text: string, cx: number, cy: number, h: number, rot = 0): Stroke[] => {
  const s = h / 6;
  const adv = 5.5 * s;
  const total = text.length * adv - 1.5 * s;
  const out: Stroke[] = [];
  const cr = Math.cos((rot * Math.PI) / 180), sr = Math.sin((rot * Math.PI) / 180);
  const tf = (x: number, y: number): [number, number] => {
    const lx = x - total / 2, ly = y - h / 2;
    return [cx + lx * cr - ly * sr, cy + lx * sr + ly * cr];
  };
  [...text.toUpperCase()].forEach((ch, i) => {
    const glyph = G[ch] ?? G[' '];
    for (const poly of glyph) {
      for (let k = 2; k < poly.length; k += 2) {
        const [x1, y1] = tf(i * adv + poly[k - 2] * s, poly[k - 1] * s);
        const [x2, y2] = tf(i * adv + poly[k] * s, poly[k + 1] * s);
        out.push({ x1, y1, x2, y2 });
      }
    }
  });
  return out;
};

export const textWidth = (text: string, h: number): number => text.length * 5.5 * (h / 6) - 1.5 * (h / 6);
