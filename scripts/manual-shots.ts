/** Screenshots of the UI for the user manual (docs/manual.md → docs/img). */
import { startShooter } from './shot';

const SHOTS: Array<{ q: string; f: string; opts?: { width?: number; height?: number; timeoutMs?: number; waitMs?: number } }> = [
  { q: 'tab=sim&course=obstacles&view=iso', f: 'ui-1-sim.png' },
  { q: 'tab=electrical', f: 'ui-2-electrical.png' },
  { q: 'tab=pcb&view=2d', f: 'ui-3-pcb.png' },
  { q: 'tab=airframe&view=iso', f: 'ui-4-airframe.png' },
  { q: 'tab=assembly&scenario=G1-3&view=iso', f: 'ui-5-assembly.png' },
  { q: 'tab=airframe&variant=C&view=iso', f: 'ui-variant-c.png' },
  { q: 'tab=assembly&variant=C&scenario=GC-5b&view=top&scale=25', f: 'ui-variant-c-outdoor.png' },
  { q: 'tab=city', f: 'ui-6-city.png', opts: { timeoutMs: 300000 } },
  { q: 'tab=city&scenario=GY-4&view=iso&scale=40', f: 'ui-6-city-flight.png', opts: { timeoutMs: 300000 } },
  { q: 'tab=city&scenario=GY-4&at=150&cam=chase&scale=3', f: 'ui-6-city-chase.png', opts: { timeoutMs: 300000, waitMs: 2000 } },
  { q: 'tab=city&scenario=GY-4&at=150&cam=top&camDist=6&scale=3', f: 'ui-6-city-top.png', opts: { timeoutMs: 300000, waitMs: 2000 } },
];

const main = async (): Promise<void> => {
  const shooter = await startShooter();
  try {
    for (const s of SHOTS) {
      await shooter.shoot(s.q, `docs/img/${s.f}`, s.opts);
      console.log(`[manual] docs/img/${s.f}`);
    }
  } finally {
    await shooter.close();
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
