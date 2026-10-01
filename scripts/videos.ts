/**
 * Video captures (WebM/VP8) rendered frame by frame from the UI in capture mode:
 * follow-camera flights (indoor / outdoor / city) and orbiting views of the boards and vehicles.
 * Frames come from the WebGL canvas; encoding uses ffmpeg (FFMPEG_PATH, ffmpeg on PATH, or Playwright's bundled build).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import type { Page } from 'playwright-core';
import type { CaptureWindow } from '../src/ui/capture';
import { startShooter } from './shot';

const OUT = 'docs/video';
const SIZE = { width: 1280, height: 720 };
const FPS = 25;

interface FlightClip {
  kind: 'flight';
  file: string;
  title: string;
  query: string;
  cam: 'chase' | 'top' | 'orbit';
  camDist: number;
  /** Simulated seconds per video second. */
  speed: number;
  from?: number;
  to?: number;
}

interface OrbitClip {
  kind: 'orbit';
  file: string;
  title: string;
  query: string;
  seconds: number;
  /** Elevation range [deg] (sinusoidal over one turn). */
  elevation: [number, number];
  zoom?: number;
}

type Clip = FlightClip | OrbitClip;

export const CLIPS: Clip[] = [
  { kind: 'flight', file: 'indoor-chase.webm', title: '屋内：障害物コース（版 A 完成機体、後方追従）', query: 'tab=assembly&scenario=G1-3&scale=1', cam: 'chase', camDist: 0.6, speed: 1 },
  { kind: 'flight', file: 'outdoor-square-chase.webm', title: '屋外：40 m 四方・平均風 5 m/s（版 C、後方追従、4 倍速）', query: 'tab=assembly&variant=C&scenario=GC-5b&scale=2', cam: 'chase', camDist: 3, speed: 4 },
  { kind: 'flight', file: 'city-chase.webm', title: '都市：みなとみらい横断（版 C、後方追従、5 倍速）', query: 'tab=city&scenario=GY-4&scale=3', cam: 'chase', camDist: 5, speed: 5, from: 78, to: 320 },
  { kind: 'orbit', file: 'airframe-a-orbit.webm', title: '版 A 完成機体', query: 'tab=airframe&view=iso', seconds: 8, elevation: [15, 50] },
  { kind: 'orbit', file: 'airframe-b-orbit.webm', title: '版 B 完成機体（センサ子基板）', query: 'tab=airframe&variant=B&view=iso', seconds: 8, elevation: [-35, 40] },
  { kind: 'orbit', file: 'airframe-c-orbit.webm', title: '版 C 屋外機', query: 'tab=airframe&variant=C&view=iso', seconds: 8, elevation: [10, 50] },
  { kind: 'orbit', file: 'pcb-a-orbit.webm', title: 'FC 基板（版 A）', query: 'tab=pcb&view=3d', seconds: 8, elevation: [25, 70] },
  { kind: 'orbit', file: 'pcb-c-orbit.webm', title: 'FC 基板（版 C）', query: 'tab=pcb&variant=C&view=3d', seconds: 8, elevation: [25, 70] },
  { kind: 'orbit', file: 'pcb-flow-orbit.webm', title: 'センサ子基板（版 B）', query: 'tab=pcb&variant=B&board=flow&view=3d', seconds: 8, elevation: [25, 70] },
];

const findFfmpeg = (): string => {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  const root = `${process.env.LOCALAPPDATA ?? ''}/ms-playwright`;
  if (existsSync(root)) {
    for (const d of readdirSync(root).filter((x) => x.startsWith('ffmpeg')).sort().reverse()) {
      const exe = readdirSync(`${root}/${d}`).find((f) => /^ffmpeg.*\.exe$|^ffmpeg-linux$|^ffmpeg-mac$/.test(f));
      if (exe) return `${root}/${d}/${exe}`;
    }
  }
  throw new Error('ffmpeg が見つかりません。FFMPEG_PATH を設定するか、npx playwright install ffmpeg を実行してください。');
};

/** Open an encoder that takes JPEG frames on stdin. */
const openEncoder = (ffmpeg: string, file: string): { write: (jpeg: Buffer) => Promise<void>; close: () => Promise<void> } => {
  const p = spawn(ffmpeg, ['-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0', '-y', '-an', '-c:v', 'vp8', '-b:v', '1200k', '-qmin', '0', '-qmax', '40', '-crf', '8', '-deadline', 'good', '-threads', '2', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (jpeg: Buffer): Promise<void> => new Promise((resolve) => (p.stdin.write(jpeg) ? resolve() : p.stdin.once('drain', () => resolve())));
  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
      p.stdin.end();
    });
  return { write, close };
};

const jpeg = (dataUrl: string): Buffer => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

const recordFlight = async (page: Page, c: FlightClip, enc: ReturnType<typeof openEncoder>): Promise<number> => {
  const T = await page.evaluate(() => (window as CaptureWindow).__ddsSim?.duration() ?? 0);
  if (!T) throw new Error(`${c.file}: 飛行記録がありません`);
  await page.evaluate(({ cam, d }) => (window as CaptureWindow).__ddsSim?.setCamera(cam, d), { cam: c.cam, d: c.camDist });
  const t0 = c.from ?? 0, t1 = Math.min(c.to ?? T, T);
  const dt = c.speed / FPS;
  // settle the follow camera before the first frame
  for (let k = 0; k < 30; k++) await page.evaluate(({ t, dt }) => (window as CaptureWindow).__ddsSim?.step(t, dt), { t: t0, dt });
  let n = 0;
  for (let t = t0; t <= t1; t += dt) {
    const url = await page.evaluate(({ t, dt }) => {
      const w = window as CaptureWindow;
      w.__ddsSim?.step(t, dt);
      return w.__ddsViewport?.frame(0.9) ?? '';
    }, { t, dt });
    await enc.write(jpeg(url));
    n++;
  }
  return n;
};

const recordOrbit = async (page: Page, c: OrbitClip, enc: ReturnType<typeof openEncoder>): Promise<number> => {
  const d0 = await page.evaluate(() => (window as CaptureWindow).__ddsViewport?.distance() ?? 0);
  const frames = Math.round(c.seconds * FPS);
  const [e0, e1] = c.elevation;
  for (let i = 0; i < frames; i++) {
    const s = i / frames;
    const az = -125 + 360 * s;
    const el = e0 + ((e1 - e0) * (1 - Math.cos(2 * Math.PI * s))) / 2;
    const url = await page.evaluate(({ az, el, d }) => {
      const w = window as CaptureWindow;
      w.__ddsViewport?.orbit(az, el, d);
      return w.__ddsViewport?.frame(0.92) ?? '';
    }, { az, el, d: d0 * (c.zoom ?? 1) });
    await enc.write(jpeg(url));
  }
  return frames;
};

const main = async (): Promise<void> => {
  const only = process.argv.slice(2);
  const clips = only.length ? CLIPS.filter((c) => only.some((o) => c.file.includes(o))) : CLIPS;
  mkdirSync(OUT, { recursive: true });
  const ffmpeg = findFfmpeg();
  console.log(`[videos] ffmpeg: ${ffmpeg}`);
  const shooter = await startShooter();
  try {
    for (const c of clips) {
      const t = Date.now();
      await shooter.shoot(`capture=1&${c.query}`, `${OUT}/${c.file.replace('.webm', '.png')}`, { ...SIZE, timeoutMs: 300000, waitMs: 1000 });
      const enc = openEncoder(ffmpeg, `${OUT}/${c.file}`);
      const n = c.kind === 'flight' ? await recordFlight(shooter.page(), c, enc) : await recordOrbit(shooter.page(), c, enc);
      await enc.close();
      console.log(`[videos] ${OUT}/${c.file}  ${n} frames (${(n / FPS).toFixed(1)} s)  ${((Date.now() - t) / 1000).toFixed(0)} s`);
    }
  } finally {
    await shooter.close();
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
