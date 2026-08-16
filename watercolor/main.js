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

/* This file's own URL, captured at parse time — inside the load handler
   document.currentScript is null. `?tune` resolves the panel's script and
   stylesheet against it rather than against the document, so the escape hatch
   works from any page depth (and from file://). */
const WC_MAIN_SRC = (document.currentScript && document.currentScript.src) || '';

window.addEventListener('load', function () {

  /* ------------------------------------------------------- query params */

  const qs = new URLSearchParams(location.search);
  const seedRaw = parseInt(qs.get('seed'), 10);
  // Every unpinned load gets a new composition; ?seed=N makes it shareable.
  let seed = Number.isFinite(seedRaw)
    ? (seedRaw >>> 0)
    : crypto.getRandomValues(new Uint32Array(1))[0];
  const still = qs.has('still') ? Math.max(0, parseFloat(qs.get('still')) || 0) : null;
  const demo = qs.get('demo');
  const forceReduced = qs.get('reduced') === '1';
  const nopanel = qs.has('nopanel');
  const forceFallback = qs.get('forcefallback') === '1';

  /* ------------------------------------------------- who gets the sliders

     The site does not. index.html ships no watercolor/panel.js and no
     #wc-panel-mount, so WCPanel is simply not on the page: the ONE thing that
     decides whether this file mounts a tuning panel is whether the page it is
     running in loaded the panel. That is the whole split. A page that wants the
     instrument (watercolor.html, the showcase) loads panel.js before this file
     and gets everything; the site loads neither and there is nothing to hide,
     disable or accidentally reveal.

     `?tune` is the escape hatch: it injects panel.js (and its stylesheet) on
     demand so the owner can still dial the wash against the real site and paste
     the result into settings.js. It costs the no-flag path one `qs.has` — no
     request, no DOM, no listener.

     `?nopanel` still means "not even then", because the screenshot harnesses
     pass it. */
  const wantsTune = !nopanel && qs.has('tune');
  const panelLoaded = typeof WCPanel !== 'undefined';
  const tuning = !nopanel && (panelLoaded || wantsTune);
  /* The showcase's subject is the controls, so it opens with the drawer out —
     but only where the drawer can sit BESIDE the work. The drawer is a 300px
     column up to 82vh tall; on a phone that is the entire screen, so opening it
     on arrival hands the visitor a wall of sliders and no painting, which is
     the opposite of a showcase. Below 760px it starts closed behind its toggle,
     one tap away. `?panel=open` is explicit and always wins. */
  const panelOpen = qs.get('panel') === 'open' ||
    (window.WC_SHOWCASE === true && qs.get('panel') !== 'closed' &&
     window.matchMedia('(min-width: 760px)').matches);

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  let rng = mulberry32(seed);

  /* ------------------------------------------------------------- params */

  // Every default lives in watercolor/settings.js and nowhere else. Both the
  // site and the prototype shell load that file, so there is no second copy to
  // drift from — which is exactly how the site shipped a preset macro model
  // while the prototype held the owner's calibration.
  const params = WC_SETTINGS.withPreset(
    WC_SETTINGS.PRESETS[qs.get('preset')] ? qs.get('preset') : WC_SETTINGS.OTHER.preset
  );
  if (qs.get('mode') === 'painting') params.startMode = 'painting';

  /* ------------------------------------------------- panel persistence */

  /* Panel settings survive a reload — ON A TUNING SURFACE ONLY. Storage is
     read and written when the panel is present (the showcase, or the site under
     ?tune) and is not touched at all otherwise, which is the deliberate half of
     this round's split and deserves its reason in full:

       - settings.js already IS the owner's tuning. Its twelve defaults are his
         own exported panel state, not a re-derivation (settings.js:20). The
         site consuming those defaults is the site consuming his calibration;
         there is nothing for storage to add.
       - Storage is per-browser, and the site's audience is not the owner. A
         visitor's localStorage is empty, so a site that reads storage still
         renders settings.js for everyone except the one person who has been
         dragging sliders. That makes the shipped look unfalsifiable from the
         owner's own machine: he would be the only reader who cannot see it.
       - It also runs the wrong way once the showcase exists. The showcase is a
         toy someone plays with; if the site read the same key, ten minutes on
         watercolor.html would silently repaint the personal site's background —
         and, with the panel gone, leave no control anywhere on that page to put
         it back.
       - So the promotion path for a tuning session is explicit and reviewable:
         "Copy settings" in the panel, paste into watercolor/settings.js. One
         source of truth, in the repo, visible in a diff.

     What the panel's storage still buys, and why it is kept for tuning: without
     it every navigation — including clicking the wordmark, which points at
     index.html — threw away whatever the owner had just dialled in, which made
     the panel unusable as an instrument: you could not compare a setting
     against the site's own scrolling behaviour without losing it.

     Deliberately NOT stored: the composition seed. A fresh wash per visit is
     the design ("every unpinned load gets a new composition"), and the panel
     already writes ?seed= into the URL for anyone who wants to pin one — a
     stored seed would silently freeze the painting forever with no visible
     cause. Stored values are also VALIDATED against CONTROLS rather than
     trusted: a knob that has since been renamed or removed (bloomRate's
     hard-coded predecessors, say) is dropped instead of being written blindly
     into params, and out-of-range numbers are clamped to the slider's own
     bounds. localStorage is shared with anything else on the origin and
     survives across code versions; it is input, not state.

     The key stays 'wc-settings-v1' and its shape is unchanged, so a tuning
     session started before the split is still there after it. */
  const STORE_KEY = 'wc-settings-v1';

  function readStored() {
    if (!tuning) return null;
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (_) { return null; }
    if (!raw) return null;
    let obj = null;
    try { obj = JSON.parse(raw); } catch (_) { return null; }
    if (!obj || typeof obj !== 'object') return null;
    const clean = {};
    WC_SETTINGS.CONTROLS.forEach(function (c) {
      const v = obj[c.k];
      if (typeof v !== 'number' || !isFinite(v)) return;
      clean[c.k] = Math.max(c.min, Math.min(c.max, v));
    });
    if (WC_PALETTES && WC_PALETTES[obj.palette]) clean.palette = obj.palette;
    if (obj.startMode === 'abstract' || obj.startMode === 'painting') clean.startMode = obj.startMode;
    if (WC_SETTINGS.PRESETS[obj.preset]) clean.preset = obj.preset;
    if ([512, 768, 1024].indexOf(obj.dyeRes) >= 0) clean.dyeRes = obj.dyeRes;
    return clean;
  }

  // An explicit URL parameter always beats storage: ?preset= and ?mode= are how
  // a specific look gets shared, and a stored value silently overriding a
  // pasted link is the same class of surprise this whole block exists to fix.
  const stored = readStored();
  if (stored) {
    Object.keys(stored).forEach(function (k) {
      if (k === 'preset' && qs.get('preset')) return;
      if (k === 'startMode' && qs.get('mode')) return;
      params[k] = stored[k];
    });
  }

  let persistTimer = null;
  function persist() {
    // Coalesced: a slider drag fires onParam on every pointermove, and
    // localStorage writes are synchronous and hit the disk.
    if (!tuning) return;   // belt and braces: every caller is a panel callback
    if (persistTimer !== null) return;
    persistTimer = setTimeout(function () {
      persistTimer = null;
      const out = {};
      WC_SETTINGS.CONTROLS.forEach(function (c) { out[c.k] = params[c.k]; });
      out.palette = params.palette;
      out.startMode = params.startMode;
      out.preset = params.preset;
      out.dyeRes = params.dyeRes;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (_) {}
    }, 250);
  }

  // A preset is a set of overrides on the canonical defaults, applied from a
  // fresh copy every time, so switching presets can never leak one preset's
  // values into another's.
  function applyPreset(key) {
    const next = WC_SETTINGS.withPreset(key);
    next.palette = params.palette;
    next.startMode = params.startMode;
    next.dyeRes = params.dyeRes;
    Object.keys(next).forEach(function (k) { params[k] = next[k]; });
  }

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

  /* ---------------------------------------------------------- hero rect */

  /* The hero-legibility carve-out is a SCREEN-space rect, but the hero now
     scrolls away beneath a fixed canvas. Measured once in document space and
     re-projected each frame from scrollY, so the cleared patch travels up with
     the name instead of staying parked behind the about text. Costs one
     scrollY read and an object assignment per frame; no layout is read in the
     loop and no scroll listener is added — the sim already has a rAF. */
  let heroGeom = null;    // document-space px rect of #hero
  let heroDirty = false;  // deferred re-measure (see the resize handler)
  let heroScrollY = -1;

  function measureHero() {
    if (!sim) return;
    const hero = document.getElementById('hero');
    if (!hero) { heroGeom = null; return; }
    const r = hero.getBoundingClientRect();
    const sx = window.scrollX || 0, sy = window.scrollY || 0;
    heroGeom = { left: r.left + sx, top: r.top + sy, right: r.right + sx, bottom: r.bottom + sy };
    heroDirty = false;
    heroScrollY = -1;
    applyHeroRect();
  }

  function applyHeroRect() {
    if (!sim || !heroGeom) return;
    const pad = 28;
    const W = window.innerWidth, H = window.innerHeight;
    const sx = window.scrollX || 0, sy = window.scrollY || 0;
    heroScrollY = sy;
    const left = heroGeom.left - sx, right = heroGeom.right - sx;
    const top = heroGeom.top - sy, bottom = heroGeom.bottom - sy;
    sim.setHeroRect({
      x0: (left - pad) / W,
      y0: 1 - (bottom + pad) / H,   // canvas UV is y-up
      x1: (right + pad) / W,
      y1: 1 - (top - pad) / H,
    });
  }

  // Called from the frame loop. getBoundingClientRect() includes the descent's
  // parallax transform, so a re-measure taken while scrolled would bake that
  // offset into the cached geometry — defer it until the hero is home.
  function trackHeroScroll() {
    if (!sim || !heroGeom) return;
    const sy = window.scrollY || 0;
    if (heroDirty && sy <= 4) { measureHero(); return; }
    if (sy !== heroScrollY) applyHeroRect();
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
    sim = new WCSim({
      gl: gl, canvas: canvas, params: params, rng: rng, seed: seed,
      palette: WC_PALETTES[params.palette],
      artImage: document.getElementById('wc-art-field'),
    });
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

    // Click = a dropped bead of water. The pointer path only ever redistributes
    // pigment; a click is the one gesture that adds, which is what makes the
    // background answer a deliberate press instead of only a sweep. Ignored on
    // interactive chrome so the panel, links and the theme toggle still behave.
    window.addEventListener('pointerdown', function (e) {
      if (reduced || paused || frozen || !sim) return;
      if (e.target && e.target.closest && e.target.closest('a, button, input, select, textarea, .wc-panel')) return;
      sim.dropAt(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
    });

    // debounced resize; full reseed is acceptable per spec
    //
    // ...except that the page scrolls now. On phones the URL bar collapses and
    // expands DURING a scroll, and each of those fires `resize` — an unguarded
    // handler therefore calls sim.resize(), which reallocates every target and
    // reseeds the wash, restarting the painting mid-descent on every mobile
    // visit. On coarse pointers a width-preserving height change is treated as
    // the browser chrome moving, not as a new window: the drawing buffer keeps
    // its old height and stretches by the URL bar's worth, which is invisible
    // on a soft-focus background and infinitely better than a reseed. Desktop
    // (fine pointer) behaves exactly as before.
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    let lastVW = window.innerWidth, lastVH = window.innerHeight;
    let resizeTimer = null;
    window.addEventListener('resize', function () {
      const vw = window.innerWidth, vh = window.innerHeight;
      const chromeOnly = coarsePointer && vw === lastVW && vh !== lastVH;
      lastVW = vw; lastVH = vh;
      if (chromeOnly) { heroDirty = true; trackHeroScroll(); return; }
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!sim) return;
        sim.resize();
        if ((window.scrollY || 0) > 4) { heroDirty = true; applyHeroRect(); }
        else measureHero();
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

    // Either mounts inline (panel.js already on the page) or fetches it first.
    if (tuning) loadPanelScript();

    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------- the panel

     One mount point for both tuning surfaces. On the showcase panel.js is
     already loaded and this runs inline; under ?tune on the site it runs after
     the injected script arrives, which is why the mount element and the
     stylesheet are created here rather than assumed in the markup — the site's
     HTML carries neither. */
  // The showcase links watercolor-panel.css itself; ?tune has to bring it, and
  // so does the fallback note, which is styled by it and can appear without a
  // panel ever mounting.
  function ensurePanelCss() {
    if (!WC_MAIN_SRC) return;
    if (document.querySelector('link[href$="watercolor-panel.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../watercolor-panel.css', WC_MAIN_SRC).href;
    document.head.appendChild(link);
  }

  function mountPanel() {
    if (panel || !sim) return;
    let mount = document.getElementById('wc-panel-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.id = 'wc-panel-mount';
      document.body.appendChild(mount);
    }
    ensurePanelCss();
    panel = WCPanel.create({
        mount: mount,
        params: params,
        palettes: WC_PALETTES,
        presets: WC_SETTINGS.PRESETS,
        controls: WC_SETTINGS.CONTROLS,
        seed: seed,
        artAvailable: !!(sim && sim.artReady),
        startOpen: panelOpen,
        onParam: function (k, v) { params[k] = v; persist(); },
        onPalette: function (key) { setPalette(key); persist(); },
        onQuality: function (res) { params.dyeRes = res; sim.setQuality(); persist(); },
        onPreset: function (key) { applyPreset(key); panel.refresh(); persist(); },
        onMode: function (modeKey) { params.startMode = modeKey; sim.setStartMode(modeKey); persist(); },
        onSeed: function (nextSeed) {
          seed = nextSeed >>> 0;
          rng = mulberry32(seed);
          sim.setSeed(seed, rng);
          const url = new URL(location.href);
          url.searchParams.set('seed', String(seed));
          history.replaceState(null, '', url);
        },
        // "Reset wash" is the escape hatch from a bad experiment, so it must
        // also clear what was stored — otherwise the reset survives only until
        // the next reload, which is the bug this block exists to fix, inverted.
        onReset: function () {
          applyPreset(params.preset);
          sim.reseed();
          if (panel) panel.refresh();
          try { localStorage.removeItem(STORE_KEY); } catch (_) {}
        },
        onPause: function () { paused = !paused; return paused; },
        getSettings: function () {
          const out = { seed: seed };
          Object.keys(params).forEach(function (k) { out[k] = params[k]; });
          return out;
        },
      });
  }

  function loadPanelScript() {
    if (typeof WCPanel !== 'undefined') { mountPanel(); return; }
    if (!WC_MAIN_SRC) { console.warn('[watercolor] ?tune: cannot resolve panel.js'); return; }
    const s = document.createElement('script');
    s.src = new URL('panel.js', WC_MAIN_SRC).href;
    s.onload = function () { mountPanel(); };
    s.onerror = function () { console.warn('[watercolor] ?tune: panel.js failed to load'); };
    document.head.appendChild(s);
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

    trackHeroScroll();

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

    const fallbackArt = document.getElementById('wc-art-fallback');
    if (params.startMode === 'painting' && fallbackArt && fallbackArt.complete && fallbackArt.naturalWidth) {
      ctx.drawImage(fallbackArt, 0, 0, W, H);
    }

    const teal = pal.pigments[0], celadon = pal.pigments[1], gold = pal.pigments[2];
    function blob(x, y, r, color, a) {
      const g = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * Math.max(W, H));
      g.addColorStop(0, hexA(color, a));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.globalCompositeOperation = 'multiply';
    // Painting mode already has the archived field underneath; only the
    // generative start needs procedural blobs.
    if (params.startMode === 'abstract') {
      for (let i = 0; i < 18; i++) {
        const color = [teal, celadon, gold][i % 3];
        blob(0.04 + 0.92 * fRng(), 0.04 + 0.92 * fRng(),
          0.08 + fRng() * 0.17, color, 0.22 + fRng() * 0.36);
      }
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

    // Dev affordance, not site chrome: a reader of the personal site gets a
    // silent static wash, not a diagnostic about their GPU.
    if (tuning && !document.querySelector('.wc-note')) {
      ensurePanelCss();
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
    settings: WC_SETTINGS,
    setParam: function (name, v) {
      if (!(name in params)) return;
      params[name] = v;
      if (name === 'palette') setPalette(v);
      else if (name === 'preset') applyPreset(v);
      else if (name === 'startMode' && sim) sim.setStartMode(v);
      else if (name === 'dyeRes' && sim) sim.setQuality();
      if (panel) panel.refresh();
    },
    // x, y in 0..1 from the top-left (DOM-like); dx, dy in the same space.
    splat: function (x, y, dx, dy) {
      if (sim) sim.queueSplat(x, 1 - y, dx, -dy);
    },
    click: function (x, y) { if (sim) sim.dropAt(x, 1 - y); },
    stats: function () {
      const s = { mode: mode, startMode: params.startMode, preset: params.preset, fps: fps, frames: frames, simTime: simTime, paused: paused, frozen: frozen, reduced: reduced, seed: seed };
      if (sim) {
        const t = sim.stats();
        s.simRes = t.simRes;
        s.dyeRes = t.dyeRes;
        s.domainScale = t.domainScale;
        s.governor = t.governor;
        s.pendingBlooms = t.pendingBlooms;
        s.lastBloom = t.lastBloom;
      }
      return s;
    },
  };

});
