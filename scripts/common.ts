import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ensureDir = (p: string): void => {
  mkdirSync(p, { recursive: true });
};

export const writeText = (file: string, text: string | Uint8Array): void => {
  ensureDir(dirname(file));
  writeFileSync(file, text);
};

export const writeJson = (file: string, data: object): void => writeText(file, JSON.stringify(data, null, 2));

export const nowString = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const fmt = (v: number, d = 3): string => (Number.isFinite(v) ? v.toFixed(d) : String(v));
