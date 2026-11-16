import * as THREE from 'three';
import { TRACKS, SECTION_SELECTOR, DEFAULT_BG, resolveKeyframes } from './config.js';

/** Uniform Catmull-Rom through values v at parameter u (index space). */
export function catmull(v, u) {
  const n = v.length;
  if (n === 1) return v[0];
  const i = Math.max(0, Math.min(n - 2, Math.floor(u)));
  const f = Math.max(0, Math.min(1, u - i));
  const p0 = v[Math.max(i - 1, 0)], p1 = v[i], p2 = v[i + 1], p3 = v[Math.min(i + 2, n - 1)];
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

/**
 * The Director owns the ONE master GSAP timeline.
 *   time axis  = scroll pixels
 *   S.u        = position along the keyframe spline (tweened, section → section)
 *   S.r/g/b    = canvas background, tweened at each section boundary
 * ScrollTrigger scrubs the whole timeline against page scroll, so every property
 * is a pure function of scroll position – no disconnected animations.
 */
export function createDirector({ gsap, ScrollTrigger, q, reduced }) {
  const S = { u: 0, r: 0.047, g: 0.043, b: 0.039 };
  const cur = { r: S.r, g: S.g, b: S.b };
  TRACKS.forEach((k) => { cur[k] = 0; });

  let sections = [], kfs = [], kfPos = [], kfTop = [], tracks = {};
  let tl = null, maxScroll = 1, vh = window.innerHeight;
  let poseKey = -1;
  const tmpColor = new THREE.Color(), rgb = { r: 0, g: 0, b: 0 };

  function readSection(el) {
    const cs = getComputedStyle(el);
    const raw = cs.getPropertyValue('--fk-scene-bg').trim() || DEFAULT_BG;
    try { tmpColor.set(raw); } catch (e) { tmpColor.set(DEFAULT_BG); }
    tmpColor.getRGB(rgb, THREE.SRGBColorSpace);
    const r = el.getBoundingClientRect(), sy = window.scrollY;
    const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    return {
      el, top: r.top + sy, bottom: r.bottom + sy,
      rgb: { r: rgb.r, g: rgb.g, b: rgb.b }, light: lum > 0.5,
      opaque: cs.getPropertyValue('--fk-scene-opaque').trim() === '1',
    };
  }

  function measure() {
    vh = window.innerHeight;
    maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
    sections = [...document.querySelectorAll(SECTION_SELECTOR)].map(readSection);

    // The canvas can only turn dark behind a section that is able to cover the
    // whole viewport. A short opaque banner (shorter than the screen) is always
    // seen next to light sections, so the canvas keeps the previous colour there.
    let prev = null;
    for (const s of sections) {
      const covers = s.opaque && (s.bottom - s.top) >= vh * 1.2;
      s.eff = (s.opaque && !covers && prev) ? { ...prev.eff } : { ...s.rgb };
      s.effLight = (0.2126 * s.eff.r + 0.7152 * s.eff.g + 0.0722 * s.eff.b) > 0.5;
      prev = s;
    }

    kfs = []; kfPos = []; kfTop = [];
    for (const k of resolveKeyframes(q)) {
      const el = document.querySelector(k.at);
      const sec = sections.find((s) => s.el === el);
      if (!sec) continue;
      kfs.push(k);
      kfTop.push(sec.top);
      kfPos.push(Math.max(0, Math.min(maxScroll, (sec.top + sec.bottom) / 2 - vh / 2)));
    }
    for (let i = 1; i < kfPos.length; i++) kfPos[i] = Math.max(kfPos[i], kfPos[i - 1] + 1);
    const last = kfPos[kfPos.length - 1];
    if (last > maxScroll) { const k = maxScroll / last; kfPos = kfPos.map((p) => p * k); }
    tracks = {};
    TRACKS.forEach((t) => { tracks[t] = kfs.map((k) => k.v[t]); });
  }

  /** Where (in scroll px) the canvas colour changes between section a → b. */
  function colourWindow(a, b) {
    const y = b.top;
    if (a.effLight && !b.effLight) return [y - 0.25 * vh, y];             // dark banner covers the screen first
    if (!a.effLight && b.effLight) return [y - vh, y - 0.85 * vh];         // light section just peeking in
    return [y - 0.7 * vh, y - 0.3 * vh];
  }
  const same = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.004;

  function killTimeline() {
    if (tl) { if (tl.scrollTrigger) tl.scrollTrigger.kill(); tl.kill(); tl = null; }
  }

  function build() {
    killTimeline();
    measure();
    if (!kfs.length) return;
    if (reduced) { updatePose(true); return; }

    S.u = 0;
    Object.assign(S, sections[0].eff);

    tl = gsap.timeline({
      scrollTrigger: { trigger: document.documentElement, start: 0, end: 'max', scrub: q.scrub },
    });

    // 1 ─ keyframe spline parameter: one tween per section-to-section leg
    for (let i = 0; i < kfs.length - 1; i++) {
      tl.fromTo(S, { u: i }, { u: i + 1, duration: kfPos[i + 1] - kfPos[i], ease: 'none', immediateRender: false }, kfPos[i]);
    }
    // 2 ─ background colour: follows the section backgrounds
    let lastEnd = 0;
    for (let j = 0; j < sections.length - 1; j++) {
      const a = sections[j], b = sections[j + 1];
      if (same(a.eff, b.eff)) continue;
      let [s0, s1] = colourWindow(a, b);
      s0 = Math.max(s0, lastEnd, 0);
      if (s0 >= maxScroll) break;
      s1 = Math.max(s1, s0 + 1);
      tl.fromTo(S, { r: a.eff.r, g: a.eff.g, b: a.eff.b },
        { r: b.eff.r, g: b.eff.g, b: b.eff.b, duration: s1 - s0, ease: 'sine.inOut', immediateRender: false }, s0);
      lastEnd = s1;
    }
    tl.set({}, {}, maxScroll); // timeline length == scrollable distance (1 unit = 1 px)
  }

  /** Evaluate every track at the current spline position. */
  function evaluate() {
    if (!kfs.length) return cur;
    for (const t of TRACKS) cur[t] = catmull(tracks[t], S.u);
    cur.r = S.r; cur.g = S.g; cur.b = S.b;
    return cur;
  }

  /** Is an opaque banner covering the whole viewport? (canvas can sleep) */
  function covered() {
    const y = window.scrollY;
    for (const s of sections) if (s.opaque && s.top <= y + 1 && s.bottom >= y + vh - 1) return true;
    return false;
  }

  /** Reduced motion: snap to the keyframe of the section in the viewport centre. */
  function updatePose(force) {
    if (!sections.length) return false;
    const c = window.scrollY + vh * 0.5;
    let j = sections.findIndex((s) => c >= s.top && c < s.bottom);
    if (j < 0) j = c < sections[0].top ? 0 : sections.length - 1;
    let ki = 0;
    for (let i = 0; i < kfTop.length; i++) if (kfTop[i] <= sections[j].top + 1) ki = i;
    const key = ki * 1000 + j;
    if (!force && key === poseKey) return false;
    poseKey = key;
    S.u = ki; Object.assign(S, sections[j].eff);
    return true;
  }

  return {
    cur, build, evaluate, covered, updatePose,
    get ready() { return kfs.length > 0; },
    refresh() { build(); ScrollTrigger.refresh(); },
    destroy() { killTimeline(); },
  };
}
