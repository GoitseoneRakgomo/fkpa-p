/**
 * FK Physical – scene configuration.
 *
 * The whole journey is described here as a list of KEYFRAMES.  Each keyframe is
 * pinned to a page section (CSS selector).  When that section's centre reaches
 * the middle of the viewport, the 3D world is exactly in that state; between two
 * keyframes everything is interpolated along a smooth spline, so the camera,
 * particles, lights and ring never "restart" – it is one continuous move.
 *
 * Every property you omit is inherited from the previous keyframe.
 *
 *   morph  0 = gold ribbons (Hero)      1 = dust wave (About)
 *          2 = lattice shell (Services) 3 = bokeh field (Contact)  – fractions blend
 *   cam / look   camera position and target
 *   coinP/S/R    coin group position, scale, rotation (x,y,z radians)
 *   coinOp       coin opacity 0-1
 *   keyI         light intensity multiplier    warm    0 champagne … 1 amber
 *   partOp       particle opacity 0-1
 *
 * The section palette is read from the CSS custom property --fk-scene-bg
 * (see scene.css) to adapt particle lighting without replacing page backgrounds.
 */
export const SECTION_SELECTOR = 'main > section, .site-footer';
export const DEFAULT_BG = '#faf8f4';

const BASE = {
  morph: 0, sceneOp: 1,
  cam: [0, 0.2, 10], look: [0.6, 0, 0],
  coinP: [2.0, -0.6, -1.5], coinS: 2.4, coinR: [0.12, 0.08, 0], coinOp: 1,
  keyI: 1.1, warm: 0.2, partOp: 1,
};

export const KEYFRAMES = [
  // ── HERO ────────────────────────────────────────────────────────────────
  ['#home', { partOp: 0.5 }],
  // ── ABOUT ───────────────────────────────────────────────────────────────
  ['.home-about-section',       { morph: 1,    cam: [-1.2, 0.9, 11], look: [1, 0, -1], coinP: [6.8, -2.0, -5], coinS: 1.2, coinR: [1.0, 1.3, 0.3], coinOp: 0.5, keyI: 0.9, warm: 0.5, partOp: 0.9 }],
  ['.home-about-dark-banner',   { morph: 1.15, cam: [0, 0.2, 10], look: [0, 0, -1], coinP: [-3.2, 1, -4], coinR: [0.4, 2.2, 0.6], coinOp: 0.7, keyI: 1.0, warm: 0.6 }],
  ['.services-skyline-section', { sceneOp: 0, partOp: 0, coinOp: 0 }],
];

/** Numeric tracks that get interpolated. */
export const TRACKS = [
  'morph', 'sceneOp', 'camX', 'camY', 'camZ', 'lookX', 'lookY', 'lookZ',
  'coinX', 'coinY', 'coinZ', 'coinS', 'coinRX', 'coinRY', 'coinRZ',
  'coinOp', 'keyI', 'warm', 'partOp',
];

function flatten(s) {
  return {
    morph: s.morph, sceneOp: s.sceneOp,
    camX: s.cam[0], camY: s.cam[1], camZ: s.cam[2],
    lookX: s.look[0], lookY: s.look[1], lookZ: s.look[2],
    coinX: s.coinP[0], coinY: s.coinP[1], coinZ: s.coinP[2], coinS: s.coinS,
    coinRX: s.coinR[0], coinRY: s.coinR[1], coinRZ: s.coinR[2],
    coinOp: s.coinOp, keyI: s.keyI, warm: s.warm, partOp: s.partOp,
  };
}

/** Resolve inheritance + device adaptation → [{at, v:{track:number}}] */
export function resolveKeyframes(q) {
  const out = [];
  let acc = JSON.parse(JSON.stringify(BASE));
  for (const [at, delta] of KEYFRAMES) {
    acc = { ...acc, ...JSON.parse(JSON.stringify(delta)) };
    const v = flatten(acc);
    if (q && q.mobile) {
      // Text fills the whole screen on phones: keep the ring centred-ish,
      // fainter and smaller, and pull the camera back for the narrow aspect.
      v.coinX *= 0.35; v.coinOp *= 0.4; v.coinS *= 0.8;
      v.camZ += 1.6; v.partOp *= 0.85;
    }
    out.push({ at, v });
  }
  return out;
}
