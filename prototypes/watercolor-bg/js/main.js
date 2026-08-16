"use strict";
/* Boot, interaction, palettes, debug hooks, and the static fallback.
   Classic script; depends on WC_SHADERS, WCSim, WCPanel (loaded before). */

// Palette tokens derived from the Edge theme "Moonlit Dragon Ascending"
// wallpaper (measured). Mirrored as CSS custom props in style.css.
const WC_PALETTES = {
  "moonlit-dragon": {          // default — full art palette
    label: "Moonlit Dragon",
    paper: "#e9e4cf",          // moonlit warm paper (from #dfdbc1/#f9eecf sky tones)
    pigments: ["#2f5c63", "#77928a", "#d9b96c"],  // ink teal (theme toolbar), celadon mist, moon gold (deepened #f4e3be for glaze visibility)
    text: "#1d3a42",
  },
  "ink-and-moon": {            // ink-wash monochrome + gold accent
    label: "Ink & Moon",
    paper: "#ece9dc",
    pigments: ["#274856", "#4a6a72", "#e0c78a"],
    text: "#22333b",
  },
  "jade-mist": {               // celadon/sage end of the art
    label: "Jade Mist",
    paper: "#e7e8da",
    pigments: ["#5a7574", "#a2b09f", "#c7b98a"],
    text: "#2f4a4a",
  },
};

(function () {

  /* ------------------------------------------------------- query params */

  const qs = new URLSearchParams(location.search);
  const seedRaw = parseInt(qs.get('seed'), 10);
  const seed = Number.isFinite(seedRaw)
    ? (seedRaw >>> 0)
    : crypto.getRandomValues(new Uint32Array(1))[0];
  const still = qs.has('still') ? Math.max(0, parseFloat(qs.get('still')) || 0) : null;
  const demo = qs.get('demo');
  const forceReduced = qs.get('reduced') === '1';
  const nopanel = qs.has('nopanel');
  const forceFallback = qs.get('forcefallback') === '1';
  const panelOpen = qs.get('panel') === 'open';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(seed);

  /* ------------------------------------------------------------- params */

  const params = {
    palette: 'moonlit-dragon',
    // Owner calibration, with formerly-zero watercolor controls restored at
    // subtle live values now that their effect is independently auditable.
    spread: 0.06,
    drying: 0.12,
    edgeDark: 1.5,
    granulation: 0.20,
    density: 0.5,
    bloomRate: 1,
    mouseRadius: 0.08,
    mouseStrength: 0.38,
    repel: 0.24,
    ambientDrift: 0.35,
    grainAmount: 0.6,   // paper tooth lighting; not on the panel, tunable via __wc
    dyeRes: 768,
  };

  /* ------------------------------------------------------ reduced motion */

  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = forceReduced || mql.matches;
  function applyReduced() {
    reduced = forceReduced || mql.matches;
    document.documentElement.classList.toggle('wc-reduced', reduced);
    if (sim) sim.reduced = reduced;
  }
  if (mql.addEventListener) mql.addEventListener('change', applyReduced);

  /* ------------------------------------------------------------ palette */

  function applyPaletteCss(pal) {
    const r = document.documentElement.style;
    r.setProperty('--wc-paper', pal.paper);
    r.setProperty('--wc-ink', pal.pigments[0]);
    r.setProperty('--wc-celadon', pal.pigments[1]);
    r.setProperty('--wc-gold', pal.pigments[2]);
    r.setProperty('--wc-text', pal.text);
  }

  function setPalette(key) {
    if (!WC_PALETTES[key]) return;
    params.palette = key;
    applyPaletteCss(WC_PALETTES[key]);
    if (sim) sim.setPalette(WC_PALETTES[key]);
  }

  /* --------------------------------------------------------------- boot */

  let canvas = document.getElementById('wc-canvas');
  let sim = null;
  let panel = null;
  let mode = 'webgl';
  let paused = false;
  let frozen = false;
  let rafId = null;
  let last = 0;
  let simTime = 0;
  let frames = 0;
  let fps = 0;
  const frameTimes = [];

  applyPaletteCss(WC_PALETTES[params.palette]);
  applyReduced();

  if (!forceFallback) try {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      // Kept so a frozen (?still) canvas still reads back for screenshots.
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    sim = new WCSim({ gl: gl, canvas: canvas, params: params, rng: rng, seed: seed, palette: WC_PALETTES[params.palette] });
    sim.reduced = reduced;
  } catch (err) {
    console.warn('[watercolor] falling back to static paint:', err && err.message ? err.message : err);
    sim = null;
  }

  if (sim) {
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      console.warn('[watercolor] WebGL context lost — switching to static fallback');
      enterFallback();
    });
    startWebgl();
  } else {
    enterFallback();
  }

  /* ---------------------------------------------------------- hero rect */

  function measureHero() {
    if (!sim) return;
    const hero = document.getElementById('hero');
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const pad = 28;
    const W = window.innerWidth, H = window.innerHeight;
    sim.setHeroRect({
      x0: (r.left - pad) / W,
      y0: 1 - (r.bottom + pad) / H,   // canvas UV is y-up
      x1: (r.right + pad) / W,
      y1: 1 - (r.top - pad) / H,
    });
  }

  /* ------------------------------------------------------------ webgl path */

  function startWebgl() {
    measureHero();

    // pointer -> splat (on window: canvas is pointer-events none, so this
    // works over the hero text too)
    let lastPX = null, lastPY = null;
    window.addEventListener('pointermove', function (e) {
      const px = e.clientX / window.innerWidth;
      const py = e.clientY / window.innerHeight;
      if (lastPX !== null && !reduced && !paused && !frozen) {
        const dx = px - lastPX, dy = py - lastPY;
        if (dx !== 0 || dy !== 0) sim.queueSplat(px, 1 - py, dx, -dy);
      }
      lastPX = px; lastPY = py;
    });
    // pointerleave doesn't bubble to window; listen on the root element so a
    // pointer re-entering the page doesn't produce one huge stale-delta splat
    document.documentElement.addEventListener('pointerleave', function () { lastPX = lastPY = null; });

    // debounced resize; full reseed is acceptable per spec
    let resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!sim) return;
        sim.resize();
        measureHero();
        if (frozen) sim.render(); // keep a frozen frame presentable
      }, 150);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      } else if (!frozen && rafId === null) {
        last = performance.now();
        rafId = requestAnimationFrame(frame);
      }
    });

    if (!nopanel) {
      panel = WCPanel.create({
        mount: document.getElementById('wc-panel-mount'),
        params: params,
        palettes: WC_PALETTES,
        startOpen: panelOpen,
        onParam: function (k, v) { params[k] = v; },
        onPalette: function (key) { setPalette(key); },
        onQuality: function (res) { params.dyeRes = res; sim.setQuality(); },
        onReset: function () { sim.reseed(); },
        onPause: function () { paused = !paused; return paused; },
        getSettings: function () {
          const out = { seed: seed };
          Object.keys(params).forEach(function (k) { out[k] = params[k]; });
          return out;
        },
      });
    }

    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------- demo stroke */

  let demoPrev = null;
  function demoTick() {
    if (demo !== 'stroke') return;
    const t0 = 1.5, dur = 2.0;
    if (simTime < t0 || simTime > t0 + dur) { if (simTime > t0 + dur) demoPrev = null; return; }
    const u = (simTime - t0) / dur;
    const x = 0.12 + 0.76 * u;                         // S-curve across the canvas
    const yDom = 0.5 + 0.22 * Math.sin(u * Math.PI * 2);
    if (demoPrev) {
      sim.queueSplat(x, 1 - yDom, x - demoPrev.x, -(yDom - demoPrev.y));
    }
    demoPrev = { x: x, y: yDom };
  }

  /* --------------------------------------------------------- frame loop */

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(Math.max(dt, 1 / 120), 1 / 30);
    // ?still runs on a fixed clock so the frozen frame is deterministic.
    if (still !== null) dt = 1 / 60;

    if (!paused) {
      demoTick();
      sim.step(dt);
      simTime += dt;
    }
    sim.render();
    frames++;

    // rolling 30-frame fps
    frameTimes.push(dt);
    if (frameTimes.length > 30) frameTimes.shift();
    let sum = 0;
    for (let i = 0; i < frameTimes.length; i++) sum += frameTimes[i];
    fps = frameTimes.length / sum;
    if (panel && frames % 10 === 0) panel.setFps(fps);

    if (still !== null && simTime >= still) {
      cancelAnimationFrame(rafId);
      rafId = null;
      frozen = true;
    }
  }

  /* ---------------------------------------------------- static fallback */

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function drawFallback(ctx, W, H, pal, fRng) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = pal.paper;
    ctx.fillRect(0, 0, W, H);

    const teal = pal.pigments[0], celadon = pal.pigments[1], gold = pal.pigments[2];
    function blob(x, y, r, color, a) {
      const g = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * Math.max(W, H));
      g.addColorStop(0, hexA(color, a));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 18; i++) {
      const color = [teal, celadon, gold][i % 3];
      blob(0.04 + 0.92 * fRng(), 0.04 + 0.92 * fRng(),
        0.08 + fRng() * 0.17, color, 0.22 + fRng() * 0.36);
    }

    // speckle grain
    ctx.fillStyle = hexA(pal.text, 0.05);
    for (let i = 0; i < 4000; i++) {
      ctx.fillRect(fRng() * W, fRng() * H, 1.4, 1.4);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function enterFallback() {
    mode = 'fallback';
    frozen = true;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    sim = null;

    // A canvas that already vended a webgl2 context can't hand out a 2d one —
    // swap in a fresh element.
    const fresh = document.createElement('canvas');
    fresh.id = canvas.id;
    fresh.className = canvas.className;
    fresh.setAttribute('aria-hidden', 'true');
    canvas.replaceWith(fresh);
    canvas = fresh;

    if (panel && panel.root) panel.root.remove();
    panel = null;

    if (!nopanel && !document.querySelector('.wc-note')) {
      const note = document.createElement('div');
      note.className = 'wc-note';
      note.textContent = 'static fallback — WebGL2 unavailable';
      document.body.appendChild(note);
    }

    function paint() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(2, Math.round(window.innerWidth * dpr));
      canvas.height = Math.max(2, Math.round(window.innerHeight * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return; // truly nothing left; paper-toned CSS background remains
      drawFallback(ctx, canvas.width, canvas.height, WC_PALETTES[params.palette], mulberry32(seed ^ 0x9e3779b9));
    }
    paint();
    let t = null;
    window.addEventListener('resize', function () {
      if (mode !== 'fallback') return;
      clearTimeout(t);
      t = setTimeout(paint, 150);
    });
  }

  /* ----------------------------------------------------------- debug API */

  window.__wc = {
    get sim() { return sim; },
    params: params,
    setParam: function (name, v) {
      if (!(name in params)) return;
      params[name] = v;
      if (name === 'palette') setPalette(v);
      else if (name === 'dyeRes' && sim) sim.setQuality();
      if (panel) panel.refresh();
    },
    // x, y in 0..1 from the top-left (DOM-like); dx, dy in the same space.
    splat: function (x, y, dx, dy) {
      if (sim) sim.queueSplat(x, 1 - y, dx, -dy);
    },
    stats: function () {
      const s = { mode: mode, fps: fps, frames: frames, simTime: simTime, paused: paused, frozen: frozen, reduced: reduced, seed: seed };
      if (sim) {
        const t = sim.stats();
        s.simRes = t.simRes;
        s.dyeRes = t.dyeRes;
        s.domainScale = t.domainScale;
      }
      return s;
    },
  };

})();
