/** WebGL detection and graceful degradation. */
export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

let legacyLoaded = false;
/**
 * Turns the 3D layer off. The site returns to its original look (all the
 * translucency rules in scene.css are scoped to html.fk-scene-on). If a legacy
 * 2D particle script URL is supplied via <canvas data-legacy="…"> it is loaded
 * so non-WebGL visitors still get the old gold particles.
 */
export function enableFallback() {
  const root = document.documentElement;
  root.classList.remove('fk-scene-on');
  root.classList.add('fk-scene-off');
  const c = document.getElementById('fk-scene');
  if (c) {
    c.style.display = 'none';
    const src = c.getAttribute('data-legacy');
    if (src && !legacyLoaded) {
      legacyLoaded = true;
      const s = document.createElement('script');
      s.src = src;
      document.body.appendChild(s);
      // particle-bg.js listens for DOMContentLoaded, which already fired.
      s.onload = () => document.dispatchEvent(new Event('DOMContentLoaded'));
    }
  }
}
