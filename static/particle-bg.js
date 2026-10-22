/**
 * FK Physical LLC - Premium Gold Particle Engine
 * High-performance, responsive, zero-dependency HTML5 Canvas Particle System.
 */
(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  class GoldParticleSystem {
    constructor(container, options = {}) {
      if (!container) return;
      this.container = container;
      this.isDark = options.isDark || false;

      // Ensure container has stacking context
      const style = window.getComputedStyle(container);
      if (style.position === 'static') {
        container.style.position = 'relative';
      }

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'gold-particle-canvas';
      this.ctx = this.canvas.getContext('2d');

      // Styles for absolute non-interfering background layer
      Object.assign(this.canvas.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '0'
      });

      // Insert as first child so content sits above
      container.insertBefore(this.canvas, container.firstChild);

      this.particles = [];
      this.mouse = { x: -1000, y: -1000, active: false };
      this.animFrameId = null;

      this.init();
    }

    init() {
      this.resize();
      this.createParticles();
      
      this.boundResize = this.resize.bind(this);
      this.boundMouseMove = this.handleMouseMove.bind(this);
      this.boundMouseLeave = this.handleMouseLeave.bind(this);

      window.addEventListener('resize', this.boundResize);

      if (!prefersReducedMotion && window.innerWidth > 768) {
        this.container.addEventListener('mousemove', this.boundMouseMove);
        this.container.addEventListener('mouseleave', this.boundMouseLeave);
      }

      if (prefersReducedMotion) {
        this.renderOnce();
      } else {
        this.animate();
      }
    }

    resize() {
      this.width = this.canvas.width = this.container.offsetWidth;
      this.height = this.canvas.height = this.container.offsetHeight;
      if (this.particles.length > 0) {
        this.createParticles();
      }
    }

    createParticles() {
      this.particles = [];
      const area = this.width * this.height;
      // Lower density on mobile for performance
      const baseDensity = window.innerWidth <= 768 ? 22000 : 14000;
      const count = Math.min(Math.floor(area / baseDensity), window.innerWidth <= 768 ? 28 : 65);

      const goldColors = [
        { r: 243, g: 206, b: 120 }, // Bright gold
        { r: 207, g: 162, b: 91 },  // Metallic mid-gold
        { r: 184, g: 141, b: 59 },  // Rich gold
        { r: 146, g: 110, b: 38 }   // Deep gold
      ];

      for (let i = 0; i < count; i++) {
        const color = goldColors[Math.floor(Math.random() * goldColors.length)];
        // Adjusted opacity for light vs dark backgrounds
        const maxOpacity = this.isDark ? 0.45 : 0.28;
        const minOpacity = this.isDark ? 0.12 : 0.08;

        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          radius: Math.random() * 1.8 + 0.6,
          color: color,
          alpha: Math.random() * (maxOpacity - minOpacity) + minOpacity,
          baseAlpha: Math.random() * (maxOpacity - minOpacity) + minOpacity,
          vx: (Math.random() - 0.5) * 0.25,
          vy: -(Math.random() * 0.35 + 0.1), // Gentle floating upward movement
          pulseSpeed: Math.random() * 0.015 + 0.005,
          pulseAngle: Math.random() * Math.PI * 2,
          hasGlow: Math.random() > 0.75
        });
      }
    }

    handleMouseMove(e) {
      const rect = this.container.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
      this.mouse.active = true;
    }

    handleMouseLeave() {
      this.mouse.active = false;
    }

    animate() {
      this.ctx.clearRect(0, 0, this.width, this.height);

      for (let p of this.particles) {
        // Floating movement
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around boundaries
        if (p.y < -10) p.y = this.height + 10;
        if (p.x < -10) p.x = this.width + 10;
        if (p.x > this.width + 10) p.x = -10;

        // Subtle alpha pulsing / twinkling
        p.pulseAngle += p.pulseSpeed;
        p.alpha = p.baseAlpha + Math.sin(p.pulseAngle) * 0.08;
        p.alpha = Math.max(0.04, Math.min(p.alpha, this.isDark ? 0.55 : 0.32));

        // Interactive subtle repulse on desktop
        if (this.mouse.active) {
          const dx = this.mouse.x - p.x;
          const dy = this.mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = 90;

          if (dist < maxDist) {
            const force = (maxDist - dist) / maxDist;
            p.x -= (dx / dist) * force * 1.2;
            p.y -= (dy / dist) * force * 1.2;
          }
        }

        // Render particle
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, ${p.alpha})`;

        if (p.hasGlow && this.isDark) {
          this.ctx.shadowBlur = 6;
          this.ctx.shadowColor = `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, 0.4)`;
        } else {
          this.ctx.shadowBlur = 0;
        }

        this.ctx.fill();
      }

      this.animFrameId = requestAnimationFrame(this.animate.bind(this));
    }

    renderOnce() {
      this.ctx.clearRect(0, 0, this.width, this.height);
      for (let p of this.particles) {
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, ${p.baseAlpha})`;
        this.ctx.fill();
      }
    }

    destroy() {
      if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
      window.removeEventListener('resize', this.boundResize);
      this.container.removeEventListener('mousemove', this.boundMouseMove);
      this.container.removeEventListener('mouseleave', this.boundMouseLeave);
      if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
    }
  }

  // Automatic Initialization Across Target Sections
  document.addEventListener('DOMContentLoaded', () => {
    // 1. Dark Hero Section
    const heroSection = document.querySelector('.hero, .page-hero, .page-hero-plain, .page-hero-contact');
    if (heroSection) {
      new GoldParticleSystem(heroSection, { isDark: true });
    }

    // 2. All Light / White Background Sections
    const lightSelectors = [
      '.home-about-section',
      '.services-skyline-section',
      '.home-why-section',
      '.value-section',
      '.who-we-work-with-section',
      '.products-catalog-section',
      '.storage-section',
      '.banner-timeline',
      '.faq-section',
      '.product-section',
      '.about-section',
      '.contact-section'
    ];

    document.querySelectorAll(lightSelectors.join(', ')).forEach((section) => {
      // Exclude dark banners if matched by chance
      if (!section.classList.contains('banner-stats') && !section.classList.contains('banner-cta-gold')) {
        new GoldParticleSystem(section, { isDark: false });
      }
    });
  });
})();