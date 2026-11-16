import * as THREE from 'three';
import { makeEnvMap } from './materials.js';

/** Renderer, scene, camera, resize – nothing content-specific lives here. */
export function createStage(canvas, q) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: q.antialias, alpha: true, stencil: false,
    powerPreference: 'high-performance',
  });
  let dpr = q.dpr;
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.background = null;
  scene.environment = makeEnvMap(renderer);

  const camera = new THREE.PerspectiveCamera(q.mobile ? 46 : 38, 1, 0.1, 120);
  camera.position.set(0, 0.2, 10);

  let w = 0, h = 0;
  function resize(force) {
    const nw = canvas.clientWidth || window.innerWidth;
    const nh = canvas.clientHeight || window.innerHeight;
    if (!force && Math.abs(nw - w) < 1 && Math.abs(nh - h) < 1) return false;
    w = nw; h = nh;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    return true;
  }
  resize(true);

  return {
    renderer, scene, camera, canvas, resize,
    get dpr() { return dpr; },
    setDpr(v) { dpr = v; renderer.setPixelRatio(v); renderer.setSize(w, h, false); },
    render() { renderer.render(scene, camera); },
    dispose() {
      scene.environment && scene.environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
