/**
 * FK Physical LLC - Gold Architectural Formation Engine
 * Scroll-driven masonry + blueprint line work, drawn in gold on HTML5 Canvas.
 * Zero dependencies. Pairs with particle-bg.js (sits underneath the particles).
 *
 * What you see as you scroll:
 *  - A running-bond "wall" of gold-bar proportioned bricks that traces itself
 *    edge-by-edge and settles into place, thickest in the side gutters and
 *    dissolving into scattered bricks toward the centre so copy stays readable.
 *  - Architectural datum lines with level markers (+0.60, +1.20 ...) and ticks
 *    at every brick joint, drawn across the section.
 *  - Pilaster lines that grow down both edges.
 *  - A vault arch with voussoir joints, jambs and construction axes.
 * Everything is scrubbed to scroll position, so scrolling back up un-builds it.
 */
(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  // Seeded PRNG so the layout is stable across resizes / reloads
  const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ---- Intro (build-up on page load; waits for the page loader if present) ----
  let introStart = null;
  const INTRO_MS = 2400;
  function startIntro() {
    if (introStart === null) { introStart = performance.now(); schedule(); }
  }
  function introElapsed(now) {
    if (prefersReducedMotion) return Infinity;
    if (introStart === null) return 0;
    const el = now - introStart;
    return el > INTRO_MS ? Infinity : el;
  }
  function introQ(el, order) {
    // order 0 = bottom of section (builds first) -> 1 = top
    if (el === Infinity) return 1;
    return clamp(((el - 300) / 1800 - order * 0.75) / 0.3);
  }

  // ---- Palettes (match site gold: #926e26 / #b88d3b / #cfa25b / #f3ce78) ----
  const PALETTES = {
    light: { line: '146,110,38', hi: '184,141,59', fill: '207,162,91', strength: 0.34 },
    dark:  { line: '207,162,91', hi: '243,206,120', fill: '184,141,59', strength: 0.5 }
  };

  class ArchitecturalGoldBackdrop {
    constructor(container, options = {}) {
      this.container = container;
      this.isDark = !!options.isDark;
      this.seed = options.seed || 1;
      this.pal = this.isDark ? PALETTES.dark : PALETTES.light;
      this.visible = false;

      const cs = window.getComputedStyle(container);
      if (cs.position === 'static') container.style.position = 'relative';

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'gold-architect-canvas';
      this.canvas.setAttribute('aria-hidden', 'true');
      Object.assign(this.canvas.style, {
        position: 'absolute', top: '0', left: '0',
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: '0'
      });
      this.ctx = this.canvas.getContext('2d');
      container.insertBefore(this.canvas, container.firstChild);

      this.resize();

      if ('ResizeObserver' in window) {
        let t;
        this.ro = new ResizeObserver(() => {
          clearTimeout(t);
          t = setTimeout(() => { this.resize(); schedule(); }, 120);
        });
        this.ro.observe(container);
      } else {
        window.addEventListener('resize', () => { this.resize(); schedule(); });
      }

      if ('IntersectionObserver' in window) {
        this.io = new IntersectionObserver((entries) => {
          this.visible = entries[0].isIntersecting;
          if (this.visible) schedule();
        }, { rootMargin: '200px 0px' });
        this.io.observe(container);
      } else {
        this.visible = true;
      }
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.W = this.container.offsetWidth;
      this.H = this.container.offsetHeight;
      this.canvas.width = Math.max(1, Math.floor(this.W * dpr));
      this.canvas.height = Math.max(1, Math.floor(this.H * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.build();
    }

    // ---- Geometry ----
    build() {
      const W = this.W, H = this.H;
      const r = rng(this.seed * 977 + 13);
      const mobile = W <= 768;
      this.mobile = mobile;

      const bw = Math.round(clamp(W / (mobile ? 4.5 : 9), mobile ? 70 : 110, 170));
      const bh = Math.round(bw * 0.36); // gold-bar proportions
      const gap = 3;
      this.bw = bw; this.bh = bh;

      // Bricks: running bond, dense at the edges, scattered toward the centre
      this.bricks = [];
      const rows = Math.ceil(H / bh) + 1;
      const cols = Math.ceil(W / bw) + 2;
      for (let row = 0; row < rows; row++) {
        const off = (row % 2) * (bw / 2) - bw / 2;
        for (let c = 0; c < cols; c++) {
          const x = c * bw + off, y = row * bh;
          const cx = x + bw / 2;
          const nx = Math.abs(cx - W / 2) / (W / 2);
          const cov = 0.10 + 0.90 * smooth(0.45, 0.92, nx);
          if (r() > cov * (mobile ? 0.65 : 1)) continue;
          this.bricks.push({
            x: x + gap / 2, y: y + gap / 2, w: bw - gap, h: bh - gap,
            P: 2 * (bw - gap + bh - gap),
            mask: cov,
            delay: r() * 0.35,
            order: (1 - y / H) * 0.7 + r() * 0.3
          });
        }
      }

      // Datum lines with level markers
      this.datums = [];
      if (!mobile) {
        const step = bh * 4;
        let level = 0;
        for (let y = step * 2; y < H - bh; y += step * 3) {
          level += 1.8;
          this.datums.push({
            y: Math.round(y / bh) * bh,
            label: '+' + level.toFixed(2),
            dashed: this.datums.length % 2 === 1,
            delay: r() * 0.15
          });
        }
      }

      // Vault arch
      this.arch = null;
      if (!mobile && H > 520) {
        const R = clamp(W * 0.085, 90, 150);
        const r3 = R + 10 + R * 0.38;
        const rightSide = this.seed % 2 === 0;
        this.arch = {
          R, r1: R, r2: R + 10, r3,
          cx: rightSide ? W * 0.87 : W * 0.13,
          cy: clamp(H * 0.24, r3 + 40, Math.max(r3 + 40, H - r3 - 120))
        };
      }
    }

    // Scroll/intro driven reveal 0..1 for something located at section-y `y`
    reveal(rect, y, delay, spanMul, order, el, vh) {
      const L = vh * 0.94;
      const scrollQ = prefersReducedMotion ? 1 : clamp((L - (rect.top + y)) / (vh * spanMul) - delay);
      return Math.min(scrollQ, introQ(el, order));
    }

    // ---- Rendering ----
    draw(now, vh) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const rect = this.container.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > vh + 200) return;

      const el = introElapsed(now);
      const { line, hi, fill, strength } = this.pal;
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      ctx.lineCap = 'butt';

      this.drawPilasters(ctx, rect, vh, el, line, strength);
      this.drawDatums(ctx, rect, vh, el, line, hi, strength);
      this.drawBricks(ctx, rect, vh, el, line, hi, fill, strength);
      this.drawArch(ctx, rect, vh, el, line, hi, strength);
      ctx.setLineDash([]);
    }

    drawBricks(ctx, rect, vh, el, line, hi, fill, strength) {
      const top = -this.bh * 2, bottom = this.H + this.bh * 2;
      for (const b of this.bricks) {
        const sy = rect.top + b.y;
        if (sy < -this.bh * 2 || sy > vh + this.bh) continue;
        const q = this.reveal(rect, b.y, b.delay, 0.32, b.order, el, vh);
        if (q <= 0) continue;
        const e = ease(q);
        const y0 = b.y + (1 - e) * 16;
        if (y0 < top || y0 > bottom) continue;
        const a = strength * (0.55 + 0.45 * b.mask);

        // Soft metallic body
        if (q > 0.45) {
          const fa = clamp((q - 0.45) / 0.55);
          ctx.fillStyle = `rgba(${fill},${(0.075 * fa * (0.5 + 0.5 * b.mask)).toFixed(3)})`;
          ctx.fillRect(b.x, y0, b.w, b.h);
        }

        // Outline traced edge by edge
        ctx.strokeStyle = `rgba(${line},${(a * (0.4 + 0.6 * e)).toFixed(3)})`;
        if (q < 1) ctx.setLineDash([b.P, b.P]);
        else ctx.setLineDash([]);
        ctx.lineDashOffset = b.P * (1 - e);
        ctx.beginPath();
        ctx.rect(b.x + 0.5, y0 + 0.5, b.w - 1, b.h - 1);
        ctx.stroke();

        // Bevel highlight (top + left) once mostly built
        if (q > 0.7) {
          const ha = clamp((q - 0.7) / 0.3) * a * 0.9;
          ctx.setLineDash([]);
          ctx.strokeStyle = `rgba(${hi},${ha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(b.x + 3, y0 + 3.5);
          ctx.lineTo(b.x + b.w - 3, y0 + 3.5);
          ctx.moveTo(b.x + 3.5, y0 + 3);
          ctx.lineTo(b.x + 3.5, y0 + b.h - 3);
          ctx.stroke();
        }
      }
      ctx.lineDashOffset = 0;
    }

    drawDatums(ctx, rect, vh, el, line, hi, strength) {
      if (!this.datums.length) return;
      const W = this.W;
      ctx.font = "600 10px 'Open Sans', sans-serif";
      ctx.textBaseline = 'middle';
      for (const d of this.datums) {
        const sy = rect.top + d.y;
        if (sy < -40 || sy > vh + 40) continue;
        const q = this.reveal(rect, d.y, d.delay, 0.42, 1 - d.y / this.H, el, vh);
        if (q <= 0) continue;
        const e = ease(q);
        const x1 = 36 + (W - 72) * e;
        const a = strength * 0.7;

        ctx.setLineDash(d.dashed ? [14, 4, 2, 4] : []);
        ctx.strokeStyle = `rgba(${line},${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(36, d.y + 0.5);
        ctx.lineTo(x1, d.y + 0.5);
        ctx.stroke();

        // Ticks at every joint
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let x = 36 + this.bw; x < x1; x += this.bw) {
          ctx.moveTo(x + 0.5, d.y - 4);
          ctx.lineTo(x + 0.5, d.y + 5);
        }
        ctx.stroke();

        // Level marker: inverted triangle + label
        const m = clamp((q - 0.1) / 0.3);
        if (m > 0) {
          ctx.strokeStyle = `rgba(${hi},${(a * m).toFixed(3)})`;
          ctx.fillStyle = `rgba(${hi},${(a * m * 0.9).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(36, d.y - 9);
          ctx.lineTo(48, d.y - 9);
          ctx.lineTo(42, d.y - 1);
          ctx.closePath();
          ctx.stroke();
          ctx.fillText(d.label, 54, d.y - 9);
        }
      }
    }

    drawPilasters(ctx, rect, vh, el, line, strength) {
      if (this.mobile) return;
      const W = this.W, H = this.H;
      const grown = prefersReducedMotion ? H : clamp(vh * 0.94 - rect.top, 0, H);
      const len = el === Infinity ? grown : grown * introQ(el, 0.35);
      if (len <= 0) return;
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(${line},${(strength * 0.5).toFixed(3)})`;
      ctx.beginPath();
      [16, 22, W - 22, W - 16].forEach((x) => {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, len);
      });
      ctx.stroke();
    }

    drawArch(ctx, rect, vh, el, line, hi, strength) {
      const A = this.arch;
      if (!A) return;
      const sy = rect.top + A.cy;
      if (sy < -A.r3 - 200 || sy > vh + A.r3 + 100) return;
      const q = this.reveal(rect, A.cy, 0, 0.5, 1 - A.cy / this.H, el, vh);
      if (q <= 0) return;
      const e = ease(q);
      const sweep = Math.PI * e;
      const a = strength * 0.8;
      const { cx, cy, r1, r2, r3 } = A;

      // Concentric arcs (intrados, extrados band)
      ctx.setLineDash([]);
      [r1, r2, r3].forEach((r, i) => {
        ctx.strokeStyle = `rgba(${i === 2 ? hi : line},${(a * (i === 1 ? 0.6 : 1)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI, Math.PI + sweep);
        ctx.stroke();
      });

      // Voussoir joints
      const n = 14;
      ctx.strokeStyle = `rgba(${line},${(a * 0.8).toFixed(3)})`;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const ang = Math.PI + (i * Math.PI) / n;
        if (ang - Math.PI > sweep) break;
        ctx.moveTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
        ctx.lineTo(cx + Math.cos(ang) * r3, cy + Math.sin(ang) * r3);
      }
      ctx.stroke();

      // Jambs descend after the arch is mostly complete
      const jq = ease(clamp((e - 0.6) / 0.4));
      const jl = r1 * 0.9 * jq;
      if (jl > 0) {
        ctx.strokeStyle = `rgba(${line},${(a * 0.9).toFixed(3)})`;
        ctx.beginPath();
        [-r3, -r2, -r1, r1, r2, r3].forEach((dx) => {
          ctx.moveTo(cx + dx + 0.5, cy);
          ctx.lineTo(cx + dx + 0.5, cy + jl);
        });
        ctx.stroke();
      }

      // Construction axes + compass centre
      const ax = clamp((q - 0.15) / 0.5);
      if (ax > 0) {
        ctx.setLineDash([10, 4, 2, 4]);
        ctx.strokeStyle = `rgba(${hi},${(a * 0.55 * ax).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(cx + 0.5, cy - r3 - 18 * ax);
        ctx.lineTo(cx + 0.5, cy + r1 * 0.9 + 18 * ax);
        ctx.moveTo(cx - r3 - 24 * ax, cy + 0.5);
        ctx.lineTo(cx + r3 + 24 * ax, cy + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // ---- Render scheduling (only runs while scrolling / animating) ----
  const instances = [];
  let rafId = 0;

  function schedule() {
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function frame(now) {
    rafId = 0;
    const vh = window.innerHeight;
    for (const inst of instances) {
      if (inst.visible) inst.draw(now, vh);
    }
    // keep ticking while the intro is playing
    if (!prefersReducedMotion && introStart !== null && now - introStart <= INTRO_MS + 50) {
      schedule();
    }
  }

  function init() {
    let seed = 0;
    const make = (el, isDark) => {
      if (el.querySelector(':scope > .gold-architect-canvas')) return;
      instances.push(new ArchitecturalGoldBackdrop(el, { isDark, seed: seed++ }));
    };

    // Dark hero (first match only, same as the particle system)
    const hero = document.querySelector('.hero, .page-hero, .page-hero-plain, .page-hero-contact');
    if (hero) make(hero, true);

    // Light / white sections
    const lightSelectors = [
      '.home-about-section', '.services-skyline-section', '.home-why-section',
      '.value-section', '.who-we-work-with-section', '.products-catalog-section',
      '.storage-section', '.banner-timeline', '.faq-section', '.product-section',
      '.about-section', '.contact-section'
    ];
    document.querySelectorAll(lightSelectors.join(', ')).forEach((section) => {
      if (section.classList.contains('banner-stats') || section.classList.contains('banner-cta-gold')) return;
      make(section, false);
    });

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });

    // Wait for the page loader (if any) before playing the intro build-up
    const loader = document.querySelector('.page-loader');
    const loaderActive = () =>
      loader && loader.classList.contains('is-visible') && !loader.classList.contains('is-dismissed');
    if (loaderActive() && 'MutationObserver' in window) {
      const mo = new MutationObserver(() => {
        if (!loaderActive()) { mo.disconnect(); startIntro(); }
      });
      mo.observe(loader, { attributes: true, attributeFilter: ['class'] });
      setTimeout(() => { mo.disconnect(); startIntro(); }, 6000); // safety net
    } else {
      startIntro();
    }
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
