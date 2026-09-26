import { readFileSync, existsSync } from 'node:fs';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { pcbMassG } from '../src/integration/stage2';
import type { Stage3Lite } from '../src/integration/stage4';
import type { PcbDesign } from '../src/pcb/types';

/** Load the stage-3 PCB result produced by `npm run stage3`. */
export const loadStage3 = (): Stage3Lite => {
  const f = 'out/stage3/pcb.json';
  if (!existsSync(f)) throw new Error('out/stage3/pcb.json がありません。先に npm run stage3 を実行してください。');
  const j = JSON.parse(readFileSync(f, 'utf-8')) as { design: PcbDesign };
  return { pcb: { design: j.design }, boardMassG: pcbMassG(j.design.board.w, j.design.board.h, j.design.rules.boardThickness) };
};

export const loadManifold = async (): Promise<ManifoldToplevel> => {
  const wasm = await Module();
  wasm.setup();
  return wasm;
};
