import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export interface Viewport {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Register per-frame callback (dt in seconds). */
  onFrame: (cb: (dt: number) => void) => void;
  lookAt: (target: THREE.Vector3, position: THREE.Vector3) => void;
  renderNow: () => void;
  dispose: () => void;
}

export interface ViewportOptions {
  background?: number;
  grid?: { size: number; divisions: number } | null;
}

export const createViewport = (container: HTMLElement, o: ViewportOptions = {}): Viewport => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(o.background ?? 0x15171a);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.005, 500);
  camera.up.set(0, 0, 1);
  camera.position.set(-6, -8, 6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0.8);

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x303030, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-4, -6, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -10; sc.right = 10; sc.top = 10; sc.bottom = -10;
  scene.add(sun);
  if (o.grid !== null) {
    const g = o.grid ?? { size: 20, divisions: 40 };
    const grid = new THREE.GridHelper(g.size, g.divisions, 0x4a4d52, 0x2a2d31);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
  }

  const callbacks: Array<(dt: number) => void> = [];
  let last = performance.now();
  let raf = 0;
  const resize = (): void => {
    const w = container.clientWidth, h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  const loop = (): void => {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const cb of callbacks) cb(dt);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    scene,
    camera,
    renderer,
    controls,
    onFrame: (cb) => callbacks.push(cb),
    lookAt: (target, position) => {
      controls.target.copy(target);
      camera.position.copy(position);
      controls.update();
    },
    renderNow: () => {
      resize();
      renderer.render(scene, camera);
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
};
