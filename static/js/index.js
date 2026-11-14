import * as THREE from 'three';
import { makeGoldMaterial } from './materials.js';

/* ───────────────────────── helpers ───────────────────────── */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ───────────────────────── hero ring ───────────────────────── */
/**
 * A ring of interlocking rounded-triangle loops (a coil bent into a circle),
 * rendered as ONE InstancedMesh. `setTwist` re-lays the instances so the loops
 * progressively twist as you scroll – an object transformation, not a swap.
 */
export function createRing(q, material) {
  const curve = new THREE.CatmullRomCurve3(
    [new THREE.Vector3(1.05, 0, 0), new THREE.Vector3(-0.6, 0.66, 0), new THREE.Vector3(-0.6, -0.66, 0)],
    true, 'centripetal'
  );
  const geo = new THREE.TubeGeometry(curve, q.tubeSeg, 0.1, q.radSeg, true);
  const mesh = new THREE.InstancedMesh(geo, material, q.ringCount);
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);

  const N = q.ringCount, R = 2.1, LEAN = 0.55;
  const m4 = new THREE.Matrix4(), basis = new THREE.Matrix4();
  const qb = new THREE.Quaternion(), qt = new THREE.Quaternion(), ql = new THREE.Quaternion(), qf = new THREE.Quaternion();
  const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const ax = new THREE.Vector3(1, 0, 0), ay = new THREE.Vector3(0, 1, 0);
  const vx = new THREE.Vector3(), vy = new THREE.Vector3(0, 1, 0), vz = new THREE.Vector3();
  let last = NaN;

  function layout(tw) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      vx.set(c, 0, s); vz.set(-s, 0, c);
      basis.makeBasis(vx, vy, vz);
      qb.setFromRotationMatrix(basis);
      qt.setFromAxisAngle(ax, i * tw * 0.06);
      ql.setFromAxisAngle(ay, LEAN);
      qf.copy(qb).multiply(qt).multiply(ql);
      pos.set(c * R, 0, s * R);
      m4.compose(pos, qf, one);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  layout(0); last = 0;

  return {
    group, mesh,
    setTwist(tw) { if (Math.abs(tw - last) > 0.003) { layout(tw); last = tw; } },
    dispose() { geo.dispose(); },
  };
}

/* ───────────────────────── particles ───────────────────────── */
/** Four formations share ONE point cloud; a shader blends between them. */
export function buildFormations(n, seed = 1337) {
  const rnd = rng(seed);
  const g = () => (rnd() + rnd() + rnd() + rnd() - 2) / 0.577;
  const F = [0, 1, 2, 3].map(() => new Float32Array(n * 3));
  const R = new Float32Array(n * 4);
  const SHELLS = [6, 8.5, 11], per = Math.ceil(n / 3), STR = 18;

  for (let i = 0; i < n; i++) {
    const o = i * 3;
    // 0 – gold ribbons (filament strands that cross mid-screen)
    if (rnd() < 0.72) {
      const k = Math.floor(rnd() * STR), kk = k - STR / 2, x = (rnd() - 0.5) * 34;
      F[0][o]     = x;
      F[0][o + 1] = Math.sin(x * 0.32 + k * 0.55) * 1.5 + kk * 0.07 * (1 + (x * x) / 60) + g() * 0.05;
      F[0][o + 2] = Math.cos(x * 0.27 + k * 0.4) * 1.3 - 2 + kk * 0.05 + g() * 0.05;
    } else {
      F[0][o] = (rnd() - 0.5) * 32; F[0][o + 1] = (rnd() - 0.5) * 14; F[0][o + 2] = -14 + rnd() * 16;
    }
    // 1 – dust wave (dense undulating band)
    if (rnd() < 0.88) {
      const x = (rnd() - 0.5) * 32;
      const cy = Math.sin(x * 0.4) * 1.7 + Math.sin(x * 0.17 + 1) * 1.0 - x * 0.05;
      F[1][o] = x; F[1][o + 1] = cy + g() * 0.55 * (0.6 + rnd()); F[1][o + 2] = -3 + g() * 2.0;
    } else {
      F[1][o] = (rnd() - 0.5) * 32; F[1][o + 1] = (rnd() - 0.5) * 14; F[1][o + 2] = -14 + rnd() * 16;
    }
    // 2 – lattice: three Fibonacci shells enclosing the camera
    {
      const layer = i % 3, j = Math.floor(i / 3), y = 1 - (2 * (j + 0.5)) / per;
      const r = Math.sqrt(Math.max(0, 1 - y * y)), th = j * 2.39996323, rad = SHELLS[layer];
      F[2][o]     = Math.cos(th) * r * rad + g() * 0.05;
      F[2][o + 1] = y * rad + g() * 0.05;
      F[2][o + 2] = Math.sin(th) * r * rad + 1.5 + g() * 0.05;
    }
    // 3 – bokeh field
    F[3][o] = (rnd() - 0.5) * 30; F[3][o + 1] = (rnd() - 0.5) * 16; F[3][o + 2] = -14 + rnd() * 18;

    R[i * 4]     = rnd();                       // phase / morph stagger
    R[i * 4 + 1] = 0.35 + Math.pow(rnd(), 3) * 1.4; // size
    R[i * 4 + 2] = 0.3 + rnd() * 0.9;           // drift speed
    R[i * 4 + 3] = rnd();                       // tint / bokeh weight
  }
  return { F, R };
}

const VERT = /* glsl */`
  uniform float uMorph, uTime, uPR, uSize;
  attribute vec3 aP1, aP2, aP3;
  attribute vec4 aR;
  varying float vAlpha, vTint;
  void main(){
    float m = clamp(uMorph, 0.0, 3.0);
    float i = floor(min(m, 2.9999));
    float f = smoothstep(0.0, 1.0, clamp((m - i) * 1.5 - aR.x * 0.5, 0.0, 1.0));
    vec3 a = i < 0.5 ? position : (i < 1.5 ? aP1 : aP2);
    vec3 b = i < 0.5 ? aP1 : (i < 1.5 ? aP2 : aP3);
    vec3 p = mix(a, b, f);
    float energy = sin(f * 3.14159);
    float t = uTime;
    p += vec3(sin(t * aR.z + aR.x * 6.283), cos(t * aR.z * 0.8 + aR.x * 12.566), sin(t * aR.z * 0.6 + aR.x * 3.1416)) * (0.10 + energy * 0.9);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = max(-mv.z, 0.001);
    float bokeh = smoothstep(2.3, 3.0, m) * aR.w;
    float size = uSize * aR.y * (1.0 + bokeh * 3.0);
    gl_PointSize = min(size * uPR * (26.0 / depth), 28.0 * uPR);
    float tw = 0.65 + 0.35 * sin(t * aR.z * 2.0 + aR.x * 40.0);
    vAlpha = (0.35 + 0.65 * clamp(aR.y * 0.7, 0.0, 1.0)) * tw * smoothstep(0.5, 3.0, depth) * mix(1.0, 0.5, bokeh);
    vTint = aR.w;
  }`;

const FRAG = /* glsl */`
  uniform float uLight, uOpacity;
  varying float vAlpha, vTint;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = 1.0 - smoothstep(0.0, 0.5, d);
    float a = pow(core, 1.8) * vAlpha * uOpacity;
    vec3 bright = mix(vec3(1.0, 0.80, 0.40), vec3(1.0, 0.93, 0.70), vTint * 0.5);
    vec3 deep = vec3(0.60, 0.42, 0.10);
    vec3 col = mix(bright, deep, uLight);
    a *= mix(1.0, 1.35, uLight);
    // premultiplied: additive glow on dark (alpha 0) → normal blend on light
    gl_FragColor = vec4(col * a, a * uLight);
  }`;

export function createParticles(q) {
  const n = q.particles;
  const { F, R } = buildFormations(n);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(F[0], 3));
  geo.setAttribute('aP1', new THREE.BufferAttribute(F[1], 3));
  geo.setAttribute('aP2', new THREE.BufferAttribute(F[2], 3));
  geo.setAttribute('aP3', new THREE.BufferAttribute(F[3], 3));
  geo.setAttribute('aR', new THREE.BufferAttribute(R, 4));
  geo.setDrawRange(0, n);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMorph: { value: 0 }, uTime: { value: 0 }, uPR: { value: q.dpr },
      uSize: { value: 1 }, uLight: { value: 0 }, uOpacity: { value: 1 },
    },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, material: mat, dispose() { geo.dispose(); mat.dispose(); } };
}

/* ───────────────────────── world ───────────────────────── */
export function createWorld(stage, q) {
  const { scene, camera } = stage;

  const hemi = new THREE.HemisphereLight(0xfff2d8, 0x2a1d0c, 0.35);
  const key = new THREE.DirectionalLight(0xffc77a, 2.2); key.position.set(4, 5, 6);
  const rim = new THREE.DirectionalLight(0xfff0d0, 1.6); rim.position.set(-6, 2, -4);
  const glow = new THREE.PointLight(0xffb347, 120, 0, 2);
  scene.add(hemi, key, rim, glow);

  const goldMat = makeGoldMaterial();
  const ring = createRing(q, goldMat);
  const particles = createParticles(q);
  scene.add(ring.group, particles.points);

  const AMBER = new THREE.Color(0xffb454), CHAMP = new THREE.Color(0xfff0d6);
  const bg = new THREE.Color();

  function apply(c, time, ptr) {
    // camera – the director's spline plus a whisper of pointer parallax
    camera.position.set(c.camX + ptr.x * 0.6, c.camY + ptr.y * 0.35, c.camZ);
    camera.lookAt(c.lookX, c.lookY, c.lookZ);

    // background follows the section's colour
    bg.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
    scene.background.copy(bg);
    scene.fog.color.copy(bg);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const light = smooth(0.25, 0.75, lum);

    // ring
    const op = clamp(c.ringOp, 0, 1);
    ring.group.visible = op > 0.02;
    goldMat.opacity = op;
    goldMat.transparent = op < 0.995;
    ring.group.position.set(c.ringX + ptr.x * 0.25, c.ringY + ptr.y * 0.15, c.ringZ);
    ring.group.scale.setScalar(c.ringS);
    ring.group.rotation.set(c.ringRX, c.ringRY + time * 0.07, c.ringRZ);
    ring.setTwist(c.ringTw);

    // lighting
    const k = c.keyI, w = clamp(c.warm, 0, 1);
    key.intensity = 2.2 * k; rim.intensity = 1.6 * k; hemi.intensity = 0.35 + 0.25 * light;
    key.color.lerpColors(CHAMP, AMBER, w);
    glow.color.lerpColors(CHAMP, AMBER, w);
    glow.intensity = 120 * k;
    glow.position.set(Math.cos(time * 0.25) * 6, 2 + Math.sin(time * 0.2) * 2, 4 + Math.sin(time * 0.17) * 2);

    // particles
    const u = particles.material.uniforms;
    u.uMorph.value = clamp(c.morph, 0, 3);
    u.uTime.value = time;
    u.uLight.value = light;
    u.uOpacity.value = clamp(c.partOp, 0, 1);
    particles.points.rotation.y = Math.sin(time * 0.05) * 0.03 + ptr.x * 0.03;
  }

  return {
    apply,
    setPixelRatio(v) { particles.material.uniforms.uPR.value = v; },
    dispose() {
      ring.dispose(); particles.dispose(); goldMat.dispose();
      scene.remove(hemi, key, rim, glow, ring.group, particles.points);
    },
  };
}
