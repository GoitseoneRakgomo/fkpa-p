import * as THREE from 'three';

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

/* ───────────────────────── gold coin field ───────────────────── */
function createCoinFaceTexture(image, side, q, splitImage = true, circleCrop = null) {
  const size = q.mobile ? 384 : 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create a canvas for the coin face texture');

  if (circleCrop) {
    const sourceSize = image.width * circleCrop.size;
    const sourceX = image.width * circleCrop.centerX - sourceSize / 2;
    const sourceY = image.height * circleCrop.centerY - sourceSize / 2;
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    context.clip();
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
  } else {
    const sourceWidth = splitImage ? image.width / 2 : image.width;
    const sourceX = splitImage ? side * sourceWidth : 0;
    context.drawImage(image, sourceX, 0, sourceWidth, image.height, 0, 0, size, size);
  }
  const pixels = context.getImageData(0, 0, size, size);
  const data = pixels.data;

  if (!circleCrop) {
    for (let i = 0; i < data.length; i += 4) {
      const background = Math.min(data[i], data[i + 1], data[i + 2]);
      const t = clamp((background - 218) / 30, 0, 1);
      data[i + 3] = Math.round(data[i + 3] * (1 - t * t * (3 - 2 * t)));
    }
  }

  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function createCoinField(q, coinImageUrl, secondCoinImageUrl) {
  const group = new THREE.Group();
  const edgeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xb88d3b,
    metalness: 0.96,
    roughness: 0.22,
    clearcoat: 0.35,
    transparent: true,
  });
  const blankFace = new THREE.MeshPhysicalMaterial({
    color: 0xc49a50,
    metalness: 0.82,
    roughness: 0.3,
    clearcoat: 0.3,
    transparent: true,
  });
  const coinMaterials = [edgeMaterial, blankFace];
  const geometry = new THREE.CylinderGeometry(0.82, 0.82, 0.105, q.mobile ? 48 : 64, 1, false);
  const coins = [
    { position: [-0.615, 0, 0], scale: 0.75, speed: 0.32, tilt: 0.08 },
    { position: [0.82, 0, 0], scale: 1, speed: -0.24, tilt: -0.08 },
  ].map((spec) => {
    const coin = new THREE.Mesh(geometry, [edgeMaterial, blankFace, blankFace]);
    coin.rotation.x = Math.PI / 2;
    coin.position.set(...spec.position);
    coin.scale.setScalar(spec.scale);
    group.add(coin);
    return { mesh: coin, speed: spec.speed, tilt: spec.tilt };
  });

  let frontTexture = null;
  let backTexture = null;
  let secondFrontTexture = null;
  let disposed = false;
  let opacity = 1;
  const loader = new THREE.TextureLoader();
  const ready = Promise.all([
    loader.loadAsync(coinImageUrl).then((source) => {
      frontTexture = createCoinFaceTexture(source.image, 0, q);
      backTexture = createCoinFaceTexture(source.image, 1, q);
      source.dispose();
      if (disposed) {
        frontTexture.dispose();
        backTexture.dispose();
        return;
      }

      const front = new THREE.MeshPhysicalMaterial({
        color: 0xf2d28a,
        map: frontTexture,
        metalness: 0.72,
        roughness: 0.3,
        clearcoat: 0.35,
        transparent: true,
        alphaTest: 0.035,
        side: THREE.FrontSide,
        opacity,
      });
      const back = front.clone();
      back.map = backTexture;
      coinMaterials.push(front, back);
      coins[0].mesh.material = [edgeMaterial, front, back];
    }).catch((error) => {
      console.error('[FK scene] first coin reference image could not load:', error);
    }),
    loader.loadAsync(secondCoinImageUrl).then((source) => {
      secondFrontTexture = createCoinFaceTexture(source.image, 0, q, false, {
        centerX: 0.5,
        centerY: 0.6,
        size: 0.61,
      });
      source.dispose();
      if (disposed) {
        secondFrontTexture.dispose();
        return;
      }

      const front = new THREE.MeshPhysicalMaterial({
        color: 0xf2d28a,
        map: secondFrontTexture,
        metalness: 0.72,
        roughness: 0.3,
        clearcoat: 0.35,
        transparent: true,
        alphaTest: 0.035,
        side: THREE.FrontSide,
        opacity,
      });
      coinMaterials.push(front);
      coins[1].mesh.material = [edgeMaterial, front, blankFace];
    }).catch((error) => {
      console.error('[FK scene] second coin reference image could not load:', error);
    }),
  ]);

  return {
    group,
    ready,
    apply(time) {
      coins.forEach(({ mesh, speed, tilt }, index) => {
        mesh.rotation.y = Math.sin(time * speed + index) * tilt;
        mesh.rotation.z = Math.cos(time * speed * 0.65 + index) * tilt * 0.55;
      });
    },
    setOpacity(value) {
      opacity = clamp(value, 0, 1);
      coinMaterials.forEach((material) => { material.opacity = opacity; });
    },
    dispose() {
      disposed = true;
      geometry.dispose();
      new Set(coinMaterials).forEach((material) => material.dispose());
      if (frontTexture) frontTexture.dispose();
      if (backTexture) backTexture.dispose();
      if (secondFrontTexture) secondFrontTexture.dispose();
    },
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
    // Keep a visible premultiplied alpha so particles composite over page backgrounds.
    gl_FragColor = vec4(col * a, a * mix(0.35, 1.0, uLight));
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

/* ─────────────────────── image backdrop ─────────────────────── */
const BACKDROP_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const BACKDROP_FRAG = /* glsl */`
  uniform sampler2D uMap0, uMap1, uMap2, uMap3;
  uniform float uMorph, uLight, uOpacity;
  uniform vec4 uMapAspect;
  uniform float uViewAspect;
  varying vec2 vUv;

  vec2 coverUv(vec2 uv, float imageAspect) {
    if (uViewAspect > imageAspect) {
      uv.y = (uv.y - 0.5) * imageAspect / uViewAspect + 0.5;
    } else {
      uv.x = (uv.x - 0.5) * uViewAspect / imageAspect + 0.5;
    }
    return uv;
  }

  void main() {
    float phase = clamp(uMorph, 0.0, 3.0);
    float stage = min(floor(phase), 2.0);
    float blend = smoothstep(0.0, 1.0, phase - stage);
    vec4 a = texture2D(uMap0, coverUv(vUv, uMapAspect.x));
    vec4 b = texture2D(uMap1, coverUv(vUv, uMapAspect.y));
    vec4 c = texture2D(uMap2, coverUv(vUv, uMapAspect.z));
    vec4 d = texture2D(uMap3, coverUv(vUv, uMapAspect.w));
    vec4 image = stage < 0.5 ? mix(a, b, blend) : (stage < 1.5 ? mix(b, c, blend) : mix(c, d, blend));
    float luminance = dot(image.rgb, vec3(0.2126, 0.7152, 0.0722));
    float gold = smoothstep(0.025, 0.24, luminance);
    float visibility = mix(0.48, 0.16, uLight);
    gl_FragColor = vec4(image.rgb, gold * visibility * uOpacity);
  }`;

function resizeTexture(texture, maxSize) {
  const image = texture.image;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  let optimized = texture;

  if (scale < 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a canvas to optimize a scene texture');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    optimized = new THREE.CanvasTexture(canvas);
    texture.dispose();
  }

  optimized.colorSpace = THREE.SRGBColorSpace;
  optimized.minFilter = THREE.LinearFilter;
  optimized.magFilter = THREE.LinearFilter;
  optimized.generateMipmaps = false;
  return optimized;
}

function createImageBackdrop(stage, q, urls) {
  const { camera, scene } = stage;
  const transparentPixel = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat
  );
  transparentPixel.needsUpdate = true;

  const uniforms = {
    uMap0: { value: transparentPixel }, uMap1: { value: transparentPixel },
    uMap2: { value: transparentPixel }, uMap3: { value: transparentPixel },
    uMapAspect: { value: new THREE.Vector4(16 / 9, 16 / 9, 16 / 9, 16 / 9) },
    uViewAspect: { value: camera.aspect },
    uMorph: { value: 0 }, uLight: { value: 0 }, uOpacity: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BACKDROP_VERT,
    fragmentShader: BACKDROP_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  plane.renderOrder = -1;
  plane.frustumCulled = false;
  scene.add(plane);

  const distance = 55;
  function resize() {
    const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    plane.scale.set(height * camera.aspect, height, 1);
    uniforms.uViewAspect.value = camera.aspect;
  }
  resize();

  function followCamera() {
    plane.position.copy(camera.position);
    plane.quaternion.copy(camera.quaternion);
    plane.translateZ(-distance);
  }

  let disposed = false;
  const textures = [];
  const maxTextureSize = q.mobile ? 1024 : 1536;
  const loader = new THREE.TextureLoader();
  const ready = Promise.all(urls.slice(0, 4).map(async (url, index) => {
    const texture = resizeTexture(await loader.loadAsync(url), maxTextureSize);
    if (disposed) {
      texture.dispose();
      return;
    }
    textures.push(texture);
    uniforms[`uMap${index}`].value = texture;
    uniforms.uMapAspect.value.setComponent(index, texture.image.width / texture.image.height);
  })).catch((error) => {
    console.error('[FK scene] animation image could not load:', error);
  });

  return {
    ready,
    apply(morph, light) {
      uniforms.uMorph.value = clamp(morph, 0, 3);
      uniforms.uLight.value = light;
      followCamera();
    },
    resize,
    dispose() {
      disposed = true;
      textures.forEach((texture) => texture.dispose());
      transparentPixel.dispose();
      plane.geometry.dispose();
      material.dispose();
      scene.remove(plane);
    },
  };
}

/* ───────────────────────── world ───────────────────────── */
export function createWorld(stage, q, imageUrls = [], coinImageUrl, secondCoinImageUrl) {
  const { scene, camera } = stage;

  const hemi = new THREE.HemisphereLight(0xfff2d8, 0x2a1d0c, 0.35);
  const key = new THREE.DirectionalLight(0xffc77a, 2.2); key.position.set(4, 5, 6);
  const rim = new THREE.DirectionalLight(0xfff0d0, 1.6); rim.position.set(-6, 2, -4);
  const glow = new THREE.PointLight(0xffb347, 120, 0, 2);
  scene.add(hemi, key, rim, glow);

  const coins = createCoinField(q, coinImageUrl, secondCoinImageUrl);
  const particles = createParticles(q);
  const backdrop = createImageBackdrop(stage, q, imageUrls);
  scene.add(coins.group, particles.points);

  const AMBER = new THREE.Color(0xffb454), CHAMP = new THREE.Color(0xfff0d6);
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  function apply(c, time, ptr) {
    stage.canvas.style.opacity = String(clamp(c.sceneOp, 0, 1));
    // camera – the director's spline plus a whisper of pointer parallax
    camera.position.set(c.camX + ptr.x * 0.6, c.camY + ptr.y * 0.35, c.camZ);
    camera.lookAt(c.lookX, c.lookY, c.lookZ);
    camera.updateMatrixWorld();

    // Let the page's original section background show through the canvas.
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const light = smooth(0.25, 0.75, lum);
    backdrop.apply(c.morph, light);

    // Floating coins follow the scroll pose with a gentle, independent tilt.
    coins.group.visible = c.coinOp > 0.02;
    coins.group.position.set(c.coinX + ptr.x * 0.25, c.coinY + ptr.y * 0.15, c.coinZ);
    const viewHeight = 2 * camera.position.distanceTo(coins.group.position) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const worldUnitsPerPixel = viewHeight / stage.canvas.clientHeight;
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
    coins.group.position
      .addScaledVector(cameraRight, worldUnitsPerPixel * (q.mobile ? 48 : 80))
      .addScaledVector(cameraUp, worldUnitsPerPixel * 20);
    coins.group.scale.setScalar(c.coinS);
    coins.group.rotation.set(c.coinRX, c.coinRY, c.coinRZ);
    coins.setOpacity(clamp(c.coinOp, 0, 1));
    coins.apply(time);

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
    resize() { backdrop.resize(); },
    dispose() {
      particles.dispose();
      scene.remove(hemi, key, rim, glow, coins.group, particles.points);
      coins.dispose();
      backdrop.dispose();
    },
  };
}
