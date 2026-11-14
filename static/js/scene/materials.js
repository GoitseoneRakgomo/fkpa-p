import * as THREE from 'three';

/**
 * Procedural studio environment (soft-boxes) baked to a PMREM cube map.
 * Gives the gold its reflections without downloading an HDR file.
 */
export function makeEnvMap(renderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x050403);
  const panel = (w, h, color, k, pos) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide })
    );
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(30, 10, 0xfff1d6, 6, [0, 12, 0]);    // top soft-box
  panel(8, 24, 0xffb35c, 4, [-14, 2, 4]);    // amber strip, left
  panel(8, 24, 0xffe9c4, 3, [14, 0, -6]);    // champagne strip, right
  panel(30, 6, 0xffd08a, 2, [0, -9, 6]);     // warm bounce from below
  panel(20, 20, 0xffffff, 1.2, [0, 0, -16]); // back fill
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.03);
  pm.dispose();
  s.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return rt.texture;
}

export function makeGoldMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xe2b15c,
    metalness: 1,
    roughness: 0.26,
    clearcoat: 0.35,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.35,
    transparent: false,
    opacity: 1,
  });
}
