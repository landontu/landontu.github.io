"use strict";
/* WebGL2 watercolor simulation: stable fluids + wetness-gated pigment
   diffusion. Exposes one global: WCSim. Classic script — no modules.
   The constructor THROWS on any missing capability or shader failure;
   js/main.js catches and switches to the static canvas-2d fallback. */

const WCSim = (function () {

  const SIM_RES = 256;          // velocity/pressure long side
  const PRESSURE_ITERS = 20;
  const GRAIN_SIZE = 512;
  const DOMAIN_SCALE = 1.2;     // contained box is 20% wider/taller than viewport
  const VISIBLE_MIN = 0.5 - 0.5 / DOMAIN_SCALE;
  const VISIBLE_MAX = 0.5 + 0.5 / DOMAIN_SCALE;
  const GOV_TILES = 8;          // governor reduction FBO is GOV_TILES^2 texels
  const GOV_STEPS = 8;          // probes per axis inside each tile
  const MAC_STRENGTH = 1.0;     // MacCormack correction weight (0 = off)
  const HOME_TRACK_PER_SEC = 0.06;  // how fast home follows the live wash
  // Governor measurement filter, ASYMMETRIC. The loop must never be slow to
  // notice that the canvas is emptying, but should be slow to believe that it
  // is full: a pointer being dragged pumps pigment in and out on a 5-30 s cycle
  // and a symmetric filter either chases that disturbance (oscillation) or, at
  // 20 s both ways, takes ~30 s to react to a genuine collapse — which is
  // exactly how wide the observed near-empty window was. Fast attack, slow
  // decay: standard, and the right asymmetry for a safety governor.
  // The paper never fully dries. See the uWetFloor note in the watercolor
  // shader — this is what makes "continuous ambient motion" a property of the
  // simulation rather than something the governor has to keep achieving.
  const AMBIENT_HUMIDITY = 0.06;

  const MEASURE_TAU_FALL = 3;   // s; reacting to a drop
  const MEASURE_TAU_RISE = 20;  // s; believing a recovery

  // ~0.995 per frame at 60fps (spec), expressed per-second so dt-scaling is
  // frame-rate independent: 0.995^60 ≈ 0.74.
  const VEL_KEEP_PER_SEC = 0.74;

  const SPLAT_FORCE = 6000;     // UV pointer delta -> cells/sec
  const MAX_FORCE = 280;        // cells/sec cap per splat
  const REPEL_FORCE = 90;       // cells/sec outward at repel=1, strength=1
  // Water per pointer splat. Halved from 0.10: at 60 pointer events a second
  // the old value saturated wetness to 1.0 under the whole stroke and kept it
  // there, so nothing ever dried, nothing ever set, and continuous dragging
  // mixed the entire wash to a uniform tint. Strokes still re-liquefy paint —
  // they just stop flooding the page. Brush radius/strength/repel, which are
  // the owner's calibrated feel, are untouched.
  const MOUSE_WATER = 0.05;

  // Bloom trail geometry. See `_spawnDroplet`: the REACH (how far into the
  // domain a bloom lays pigment, in domain units — 1.0 is the full 1.2x box,
  // ~0.083 of which is the off-canvas margin it must cross first) is the fixed
  // quantity and the trail's LIFE is derived from it and the drift speed. Both
  // reaches match what the old fixed lives produced at the old fixed speed
  // (0.42*205/256*1.6 = 0.538 and 0.30*205/256*2.4 = 0.577), so slowing the
  // drift changes the pace of an arrival and not its depth.
  const BLOOM_REACH_SMALL = 0.55;
  const BLOOM_REACH_BROAD = 0.58;
  // Backstop for the bottom of the bloomDrift slider: at 0.03 w/s the derived
  // life would be ~27 s and dozens of trails would be alive at once, which is a
  // draw-call cost the setting does not advertise. Below the cap the bloom
  // simply stops short — a slider taken to an extreme, not a performance cliff.
  const BLOOM_LIFE_MAX = 9;
  // Water laid per second of trail (was 0.45 * 4.0 per second, i.e. the same
  // number, back when the deposit was expressed as a rate).
  const BLOOM_WATER_PER_SEC = 1.8;

  /* ---------------------------------------------------------- GL helpers */

  function compileShader(gl, type, src, name) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('watercolor shader "' + name + '" failed to compile: ' + log);
    }
    return s;
  }

  function createProgram(gl, vs, fsSrc, name) {
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, name);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('watercolor program "' + name + '" failed to link: ' + gl.getProgramInfoLog(p));
    }
    const u = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { prog: p, u: u };
  }

  function createFBO(gl, w, h, internal, format, type, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('watercolor: float framebuffer incomplete (internal format 0x' + internal.toString(16) + ')');
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex: tex, fb: fb, w: w, h: h };
  }

  function createDouble(gl, w, h, internal, format, type, filter) {
    let a = createFBO(gl, w, h, internal, format, type, filter);
    let b = createFBO(gl, w, h, internal, format, type, filter);
    return {
      get read() { return a; },
      get write() { return b; },
      swap: function () { const t = a; a = b; b = t; },
      dispose: function () {
        gl.deleteTexture(a.tex); gl.deleteFramebuffer(a.fb);
        gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fb);
      },
    };
  }

  /* -------------------------------------------------------- paper grain */

  // Seamlessly tiling 2-octave value noise + sparse speckle flecks, computed
  // once on the CPU (deterministic with the seeded PRNG) into an RGBA8
  // texture: r = grain, g = speckle.
  function makeGrainTexture(gl, rng) {
    const S = GRAIN_SIZE;

    function lattice(P) {
      const a = new Float32Array(P * P);
      for (let i = 0; i < a.length; i++) a[i] = rng();
      return a;
    }
    function vnoise(lat, P, u, v) {
      const iu = Math.floor(u), iv = Math.floor(v);
      let fu = u - iu, fv = v - iv;
      fu = fu * fu * (3 - 2 * fu);
      fv = fv * fv * (3 - 2 * fv);
      const i0 = ((iu % P) + P) % P, i1 = (i0 + 1) % P;
      const j0 = ((iv % P) + P) % P, j1 = (j0 + 1) % P;
      const a = lat[j0 * P + i0], b = lat[j0 * P + i1];
      const c = lat[j1 * P + i0], d = lat[j1 * P + i1];
      return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
    }

    const P1 = 9, P2 = 31;
    const lat1 = lattice(P1), lat2 = lattice(P2);
    const data = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n1 = vnoise(lat1, P1, x / S * P1, y / S * P1);
        const n2 = vnoise(lat2, P2, x / S * P2, y / S * P2);
        const g = 0.62 * n1 + 0.38 * n2;
        const i = (y * S + x) * 4;
        data[i] = Math.max(0, Math.min(255, Math.round(g * 255)));
        data[i + 1] = 0;
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
    }
    // Speckle flecks (wrapping so the tile stays seamless).
    for (let k = 0; k < 1500; k++) {
      const cx = rng() * S, cy = rng() * S;
      const rad = 0.6 + rng() * 1.6;
      const str = 90 + rng() * 140;
      const r2 = rad * rad;
      for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++) {
        for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
          const ddx = x - cx, ddy = y - cy;
          const f = Math.max(0, 1 - (ddx * ddx + ddy * ddy) / r2);
          if (f > 0) {
            const wx = ((x % S) + S) % S, wy = ((y % S) + S) % S;
            const i = (wy * S + wx) * 4 + 1;
            data[i] = Math.min(255, data[i] + f * str);
          }
        }
      }
    }

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  /* -------------------------------------------------------------- utils */

  function hexToRgb01(hex) {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ];
  }

  function gridSize(longSide, w, h) {
    const aspect = w / h;
    return aspect >= 1
      ? [longSide, Math.max(2, Math.round(longSide / aspect))]
      : [Math.max(2, Math.round(longSide * aspect)), longSide];
  }

  /* ---------------------------------------------------------------- Sim */

  function Sim(opts) {
    this.gl = opts.gl;
    this.canvas = opts.canvas;
    this.params = opts.params;
    this.rng = opts.rng;
    this.seed = opts.seed >>> 0;
    this.reduced = false;
    this.time = 0;
    this.heroRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.pointerQueue = [];
    this.pendingDrops = [];
    this.dropAcc = 0;
    this.dropGoal = 0.5 + this.rng();
    this.lastBloom = null;
    this.replenishAcc = 0;
    this.artImage = opts.artImage || null;

    // Coverage governor state. `ref` is the reference the thermostat holds; it
    // is captured from the seeded composition, so the target is "the canvas as
    // composed", not "whatever it happened to decay to".
    this.gov = {
      ref: 0, mass: 0, cov: 0, wet: 0,
      bloomBoost: 0, restoreGain: 1, pigKeep: 1, doseScale: 1, rate: 0,
      massSmooth: undefined, covSmooth: undefined, covRef: 0,
      acc: 0, samples: 0, pending: false,
    };

    const gl = this.gl;
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('watercolor: EXT_color_buffer_float unavailable');
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, WC_SHADERS.vertex, 'vertex');
    this.progs = {
      advect: createProgram(gl, vs, WC_SHADERS.advect, 'advect'),
      advectMac: createProgram(gl, vs, WC_SHADERS.advectMac, 'advectMac'),
      reduceTile: createProgram(gl, vs, WC_SHADERS.reduceTile, 'reduceTile'),
      boundary: createProgram(gl, vs, WC_SHADERS.boundary, 'boundary'),
      drift: createProgram(gl, vs, WC_SHADERS.drift, 'drift'),
      splatVel: createProgram(gl, vs, WC_SHADERS.splatVel, 'splatVel'),
      splatPig: createProgram(gl, vs, WC_SHADERS.splatPig, 'splatPig'),
      divergence: createProgram(gl, vs, WC_SHADERS.divergence, 'divergence'),
      pressure: createProgram(gl, vs, WC_SHADERS.pressure, 'pressure'),
      gradient: createProgram(gl, vs, WC_SHADERS.gradient, 'gradient'),
      watercolor: createProgram(gl, vs, WC_SHADERS.watercolor, 'watercolor'),
      replenish: createProgram(gl, vs, WC_SHADERS.replenish, 'replenish'),
      homeRefresh: createProgram(gl, vs, WC_SHADERS.homeRefresh, 'homeRefresh'),
      seedArt: createProgram(gl, vs, WC_SHADERS.seedArt, 'seedArt'),
      render: createProgram(gl, vs, WC_SHADERS.render, 'render'),
    };

    this.grainTex = makeGrainTexture(gl, this.rng);

    // Painting start mode needs the archived field; abstract does not. Only
    // fail the whole sim when the mode that requires it is the one selected.
    this.artTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.artTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.artReady = !!(this.artImage && this.artImage.complete && this.artImage.naturalWidth);
    if (this.artReady) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.artImage);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      if (this.params.startMode === 'painting') {
        throw new Error('watercolor: archived painting field did not load');
      }
    }

    // 8x8 tiles x 8x8 samples = 4096 probes of the visible window per sample,
    // read back as 256 bytes. Cheap enough to run twice a second forever.
    this.govFBO = createFBO(gl, GOV_TILES, GOV_TILES, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST);
    this.govBuf = new Float32Array(GOV_TILES * GOV_TILES * 4);

    this.setPalette(opts.palette);
    this.resize();
  }

  Sim.prototype._blit = function (target) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  Sim.prototype._bindTex = function (unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  };

  Sim.prototype.setPalette = function (palette) {
    this.paper = hexToRgb01(palette.paper);
    // Beer-Lambert absorption per pigment: K_i = -ln(color_i) per channel.
    const K = new Float32Array(9);
    for (let i = 0; i < 3; i++) {
      const c = hexToRgb01(palette.pigments[i]);
      for (let ch = 0; ch < 3; ch++) {
        K[i * 3 + ch] = -Math.log(Math.max(c[ch], 1e-3)); // column-major: column i
      }
    }
    this.K = K;
  };

  Sim.prototype.setHeroRect = function (rect) {
    this.heroRect = rect;
  };

  Sim.prototype.resize = function () {
    const canvas = this.canvas;
    // dpr clamped to 1.5: integrated GPUs shouldn't pay 4K-retina fill cost
    // for a soft-focus background.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(2, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(2, Math.round(canvas.clientHeight * dpr));
    this.aspect = canvas.width / canvas.height;

    const sim = gridSize(SIM_RES, canvas.width, canvas.height);
    this.simW = sim[0]; this.simH = sim[1];
    this._allocSim();
    this._allocDye();
    this.reseed();
  };

  Sim.prototype._allocSim = function () {
    const gl = this.gl;
    if (this.velocity) { this.velocity.dispose(); this.pressure.dispose(); }
    if (this.divergenceFBO) {
      gl.deleteTexture(this.divergenceFBO.tex);
      gl.deleteFramebuffer(this.divergenceFBO.fb);
    }
    this.velocity = createDouble(gl, this.simW, this.simH, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR);
    this.pressure = createDouble(gl, this.simW, this.simH, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    this.divergenceFBO = createFBO(gl, this.simW, this.simH, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
  };

  Sim.prototype._allocDye = function () {
    const gl = this.gl;
    if (this.pigment) this.pigment.dispose();
    if (this.home) this.home.dispose();
    if (this.macFBO) {
      gl.deleteTexture(this.macFBO.tex);
      gl.deleteFramebuffer(this.macFBO.fb);
    }
    const dye = gridSize(this.params.dyeRes, this.canvas.width, this.canvas.height);
    this.dyeW = dye[0]; this.dyeH = dye[1];
    this.pigment = createDouble(gl, this.dyeW, this.dyeH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    // `home` drifts with the flow now, so it needs its own ping-pong.
    this.home = createDouble(gl, this.dyeW, this.dyeH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    // MacCormack's forward estimate: a third dye-res target, because pass 2
    // must read phi^n and phiHat while writing a third buffer.
    this.macFBO = createFBO(gl, this.dyeW, this.dyeH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
  };

  // Quality select: rebuild only the dye grid and repaint the wash.
  Sim.prototype.setQuality = function () {
    this._allocDye();
    this._clear(this.pigment.read);
    this._clear(this.pigment.write);
    this._seedComposition();
  };

  Sim.prototype._clear = function (fbo) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  Sim.prototype.reseed = function () {
    this.pointerQueue.length = 0;
    this.pendingDrops.length = 0;
    this.dropAcc = 0;
    this.replenishAcc = 0;
    this.gov.ref = 0;
    this.gov.bloomBoost = 0;
    this.gov.restoreGain = 1;
    this.gov.pigKeep = 1;
    this.gov.doseScale = 1;
    this.gov.rate = 0;
    this.gov.ratioPrev = undefined;
    this.gov.massSmooth = undefined;
    this.gov.covSmooth = undefined;
    this.gov.covRef = 0;
    this.gov.acc = 0;
    this._clear(this.velocity.read);
    this._clear(this.velocity.write);
    this._clear(this.pressure.read);
    this._clear(this.pressure.write);
    this._clear(this.pigment.read);
    this._clear(this.pigment.write);
    this._seedComposition();
  };

  Sim.prototype.setSeed = function (seed, rng) {
    this.seed = seed >>> 0;
    this.rng = rng;
    this.reseed();
  };

  Sim.prototype.setStartMode = function (mode) {
    const next = mode === 'painting' ? 'painting' : 'abstract';
    if (next === 'painting' && !this.artReady) return;
    this.params.startMode = next;
    this.reseed();
  };

  Sim.prototype._canvasToDomain = function (v) {
    return 0.5 + (v - 0.5) / DOMAIN_SCALE;
  };

  Sim.prototype._captureHome = function () {
    const gl = this.gl, p = this.progs.advect;
    gl.disable(gl.BLEND);
    gl.useProgram(p.prog);
    this._bindTex(0, this.velocity.read.tex);
    this._bindTex(1, this.pigment.read.tex);
    gl.uniform1i(p.u.uVelocity, 0);
    gl.uniform1i(p.u.uSource, 1);
    gl.uniform2f(p.u.uTexel, 1 / this.dyeW, 1 / this.dyeH);
    gl.uniform1f(p.u.uDt, 0);
    gl.uniform1f(p.u.uDissipation, 1);
    gl.uniform1f(p.u.uWetGate, 0);
    this._blit(this.home.read);
    // The governor's reference is the composition as seeded, sampled through
    // the exact same reduction it will use forever after. Anchoring on the
    // design intent (rather than on a later measurement) is what makes the
    // first 30 seconds recover instead of setting a lower new normal.
    const s = this._sampleCoverage();
    // `refScale` (settings.js GOVERNOR) is the owner's "more pigment on the
    // canvas" lever. It is applied HERE, to the mass reference only, so that
    // every downstream ratio — deficit, excess, `_homeGain` — moves together
    // and there is exactly one place the target level is decided. Coverage's
    // reference is left alone: it is already ~0.93 of the frame and saturates
    // at 1.0, so scaling it would create a permanent unmeetable deficit.
    const scale = (typeof WC_SETTINGS !== 'undefined' && WC_SETTINGS.GOVERNOR
      && WC_SETTINGS.GOVERNOR.refScale) || 1;
    this.gov.ref = s.mass * scale;
    this.gov.seedMass = s.mass;
    this.gov.mass = s.mass;
    this.gov.cov = s.cov;
    this.gov.covRef = Math.max(s.cov, 0.05);
  };

  // Seeded abstract start: broad foundations plus smaller single-hue blooms.
  // A composition-local stream makes resize/reset reproduce the same wash.
  Sim.prototype._seedComposition = function () {
    let state = (this.seed ^ 0x9e3779b9) >>> 0;
    const R = function () {
      state |= 0; state = state + 0x6D2B79F5 | 0;
      let t = Math.imul(state ^ state >>> 15, 1 | state);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    if (this.params.startMode === 'painting' && this.artReady) {
      const gl = this.gl, p = this.progs.seedArt;
      gl.disable(gl.BLEND);
      gl.useProgram(p.prog);
      this._bindTex(0, this.artTex);
      gl.uniform1i(p.u.uArt, 0);
      gl.uniform1f(p.u.uDomainScale, DOMAIN_SCALE);
      this._blit(this.pigment.read);
    } else {
      for (let i = 0; i < 8; i++) {
        const pig = [0, 0, 0];
        pig[i % 3] = 0.28 + R() * 0.28;
        this.splatPigment(this._canvasToDomain(0.06 + R() * 0.88), this._canvasToDomain(0.06 + R() * 0.88),
          (0.13 + R() * 0.12) / DOMAIN_SCALE, pig, 0.62);
      }
      for (let i = 0; i < 18; i++) {
        const pig = [0, 0, 0];
        pig[Math.floor(R() * 3) % 3] = 0.34 + R() * 0.65;
        this.splatPigment(this._canvasToDomain(0.03 + R() * 0.94), this._canvasToDomain(0.03 + R() * 0.94),
          (0.035 + R() * 0.085) / DOMAIN_SCALE, pig, 0.76);
      }
    }
    this._captureHome();
  };

  /* -------------------------------------------------------------- splats */

  // x, y in canvas UV (y up). Additive blend into the live texture — the
  // splat shaders emit only the delta, so no ping-pong is needed.
  Sim.prototype.splatPigment = function (x, y, radius, pig, water) {
    const gl = this.gl, p = this.progs.splatPig;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.uPoint, x, y);
    gl.uniform1f(p.u.uRadius, radius);
    gl.uniform3f(p.u.uPigment, pig[0], pig[1], pig[2]);
    gl.uniform1f(p.u.uWater, water);
    gl.uniform1f(p.u.uAspect, this.aspect);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this._blit(this.pigment.read);
    gl.disable(gl.BLEND);
  };

  Sim.prototype.splatVelocity = function (x, y, radius, fx, fy, repel) {
    const gl = this.gl, p = this.progs.splatVel;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.uPoint, x, y);
    gl.uniform1f(p.u.uRadius, radius);
    gl.uniform2f(p.u.uDir, fx, fy);
    gl.uniform1f(p.u.uRepel, repel);
    gl.uniform1f(p.u.uAspect, this.aspect);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this._blit(this.velocity.read);
    gl.disable(gl.BLEND);
  };

  // Pointer path: x, y canvas UV (y up); dx, dy movement delta in UV.
  Sim.prototype.queueSplat = function (x, y, dx, dy) {
    if (this.pointerQueue.length < 40) this.pointerQueue.push({
      x: this._canvasToDomain(x), y: this._canvasToDomain(y),
      dx: dx / DOMAIN_SCALE, dy: dy / DOMAIN_SCALE,
    });
  };

  Sim.prototype._applyPointer = function () {
    const P = this.params;
    for (let i = 0; i < this.pointerQueue.length; i++) {
      const s = this.pointerQueue[i];
      let fx = s.dx * SPLAT_FORCE * P.mouseStrength;
      let fy = s.dy * SPLAT_FORCE * P.mouseStrength;
      const m = Math.hypot(fx, fy);
      if (m > MAX_FORCE) { fx *= MAX_FORCE / m; fy *= MAX_FORCE / m; }
      this.splatVelocity(s.x, s.y, P.mouseRadius / DOMAIN_SCALE, fx, fy,
        P.repel * P.mouseStrength * REPEL_FORCE);
      // Mouse adds no pigment (it redistributes what's there) but splats a
      // little water so strokes re-liquefy dried paint.
      this.splatPigment(s.x, s.y, P.mouseRadius * 0.9 / DOMAIN_SCALE, [0, 0, 0], MOUSE_WATER);
    }
    this.pointerQueue.length = 0;
  };

  /* ------------------------------------------------------------ droplets */

  Sim.prototype._dropletTick = function (dt) {
    const P = this.params;
    // Reduced motion suppresses blooms entirely, which also disables the
    // governor's inflow lever; restoration is the only thing holding coverage
    // in that mode. That is the right trade (no drifting shapes for users who
    // asked for none) but it means the perpetuity guarantee there rests on
    // `restoreRate` alone.
    if (this.reduced) { this.pendingDrops.length = 0; return; }

    // Accumulator (drops/min) adapts immediately when bloomRate changes; the
    // goal randomizes the interval by ±50%. `bloomBoost` is the governor's
    // authority: the effective rate is the slider PLUS whatever the thermostat
    // has decided the canvas needs, so a slider at 0 still cannot starve it.
    // NOT scaled by any governor term: the bloom rate is what keeps water and
    // motion in the wash. The governor's control over blooms is `doseScale`,
    // which is pigment-only. See `_governorTick`.
    const rate = P.bloomRate + this.gov.bloomBoost;
    if (rate > 0) {
      this.dropAcc += dt * rate / 60;
      while (this.dropAcc >= this.dropGoal) {
        this.dropAcc -= this.dropGoal;
        this.dropGoal = 0.5 + this.rng();
        this._spawnDroplet();
      }
    }
    // Each bloom is one launched droplet, continuously depositing a light
    // pigment trail as its center crosses the viewport edge. Continuous
    // deposition avoids replacing the old in-view pop with a later pop.
    for (let i = this.pendingDrops.length - 1; i >= 0; i--) {
      const d = this.pendingDrops[i];
      d.age += dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      // Water dose is NOT scaled by doseScale — a bloom the governor has
      // de-pigmented must still wet the paper, or throttling colour throttles
      // motion with it. Water is a RATE (per second of trail); a slower bloom
      // therefore wets more paper on its way in, which is exactly what the
      // higher `drying` default needs.
      const step = Math.min(dt, 1 / 30);
      // Pigment is a PAYLOAD, not a rate: `bloomPigment` is the total a bloom
      // lays down over its whole trail, spread evenly across however long that
      // trail lasts. This is what makes `bloomDrift` a pure speed control —
      // before, life was fixed and the deposit was per-second, so halving the
      // drift halved the colour delivered too and lever 3 quietly undid lever 1.
      const pd = step * d.payload / d.life * d.doseScale;
      this.splatPigment(d.x, d.y, d.r, [d.pig[0] * pd, d.pig[1] * pd, d.pig[2] * pd], BLOOM_WATER_PER_SEC * step);
      if (d.age >= d.life) this.pendingDrops.splice(i, 1);
    }
  };

  Sim.prototype._spawnDroplet = function () {
    const R = this.rng, P = this.params;
    const edgeIndex = Math.floor(R() * 4) % 4;
    const edge = ['left', 'right', 'bottom', 'top'][edgeIndex];
    const along = VISIBLE_MIN + (VISIBLE_MAX - VISIBLE_MIN) * R();
    const inset = 0.015 + 0.02 * R();
    let x = along, y = along, ix = 0, iy = 0;
    if (edge === 'left') { x = inset; y = along; ix = 1; }
    if (edge === 'right') { x = 1 - inset; y = along; ix = -1; }
    if (edge === 'bottom') { x = along; y = inset; iy = 1; }
    if (edge === 'top') { x = along; y = 1 - inset; iy = -1; }

    // Launch from the offscreen portion of the 1.2x domain. A small tangent
    // component prevents mechanically perpendicular arrivals, while the
    // positive inward component guarantees that every bloom enters view.
    const tangent = (R() - 0.5) * 0.36;
    let ux = ix + (iy !== 0 ? tangent : 0);
    let uy = iy + (ix !== 0 ? tangent : 0);
    const vl = Math.hypot(ux, uy) || 1;
    ux /= vl; uy /= vl;                       // unit inward direction
    // The velocity impulse. `bloomSpeed` replaces the hard-coded 170 + 70*R();
    // the ±20% jitter is kept so arrivals stay irregular at any setting.
    const speed = (P.bloomSpeed === undefined ? 70 : P.bloomSpeed) * (0.8 + 0.4 * R());
    const vx = ux * speed;
    const vy = uy * speed;
    // Two tiers, mirroring `_seedComposition`: mostly small blooms for rhythm,
    // one in three a broad foundation wash. Inflow that is only ever small and
    // fast reads as wisps and smoke — it keeps COVERAGE up while the canvas
    // flattens into a uniform tint, which is the failure the coverage metric
    // cannot see. Blooms have to be shaped like the composition they are
    // replacing, or perpetuity buys pixels instead of a painting.
    const broad = R() < 0.34;
    const r = (broad ? (0.10 + 0.06 * R()) : (0.05 + 0.05 * R())) / DOMAIN_SCALE;
    this.splatVelocity(x, y, r * 3.0, vx, vy, 0);
    this.splatPigment(x, y, r, [0, 0, 0], 0.85);   // water first
    const pig = [0, 0, 0];
    pig[Math.floor(R() * 3) % 3] = broad ? (0.34 + 0.24 * R()) : (0.60 + 0.35 * R());
    // PENETRATION IS A CONSTANT, LIFE IS DERIVED. The trail must survive long
    // enough to cross the 0.083-wide off-canvas margin AND lay pigment well
    // inside the frame; a life shorter than that spends the whole bloom outside
    // the camera, which is how "inflow exists" and "inflow is visible" came
    // apart once already. The old code fixed the life (1.6 s / 2.4 s) and let
    // the distance fall out of the speed — which means the moment lever 3 slows
    // a bloom down, it stops reaching the visible canvas at all and dies in the
    // margin. So the reach is what is held fixed here and the life is computed
    // from it. At the default drift of 0.150 w/s that is a 3.7 s small-bloom
    // trail (was 1.6 s) covering the same ground, and slowing the drift further
    // lengthens the trail instead of shortening the arrival.
    //
    // vx/vy are in domain units per second. The y term carries simW/simH so the
    // drift is isotropic on SCREEN rather than in UV — the domain is square in
    // UV over a 16:10 canvas, and the old `/simW` `/simH` pair was doing this
    // implicitly. `bloomDrift` is therefore denominated in screen-widths/s.
    const drift = Math.max(0.01, (P.bloomDrift === undefined ? 0.15 : P.bloomDrift)) * (broad ? 0.72 : 1);
    const reach = broad ? BLOOM_REACH_BROAD : BLOOM_REACH_SMALL;
    const payload = Math.max(0, P.bloomPigment === undefined ? 8 : P.bloomPigment) * (broad ? 0.55 : 1);
    this.pendingDrops.push({
      x: x, y: y, r: r * 1.15, pig: pig, age: 0,
      life: Math.min(BLOOM_LIFE_MAX, reach / drift),
      payload: payload,
      doseScale: Math.max(0, this.gov.doseScale === undefined ? 1 : this.gov.doseScale),
      vx: ux * drift,
      vy: uy * drift * (this.simW / this.simH),
    });
    this.lastBloom = {
      edge: edge,
      domainPoint: [x, y],
      canvasPoint: [(x - VISIBLE_MIN) * DOMAIN_SCALE, (y - VISIBLE_MIN) * DOMAIN_SCALE],
      velocity: [vx, vy],
    };
  };

  // A click: water bead + outward push + a light single-hue bloom, at the
  // pointer. x, y in canvas UV (y up).
  Sim.prototype.dropAt = function (x, y) {
    if (this.reduced) return;
    const R = this.rng;
    const dx = this._canvasToDomain(x), dy = this._canvasToDomain(y);
    const r = (0.045 + 0.025 * R()) / DOMAIN_SCALE;
    this.splatVelocity(dx, dy, r * 2.2, 0, 0, 46);
    this.splatPigment(dx, dy, r, [0, 0, 0], 0.9);
    const pig = [0, 0, 0];
    pig[Math.floor(R() * 3) % 3] = 0.45 + 0.3 * R();
    // The click's water and push are always full strength so the gesture stays
    // responsive; only its pigment is governed. 400 clicks over ten minutes of
    // drag abuse ran the wash to 5.5x reference when this was ungoverned.
    // Payload 2.8 == the old per-second deposit (4.0) over the old 0.7 s life.
    // The click is deliberately NOT wired to `bloomPigment`: the gesture's feel
    // is the owner's calibration and lever 1 is about ambient inflow, not about
    // making every click heavier.
    this.pendingDrops.push({
      x: dx, y: dy, r: r * 0.5, pig: pig, age: 0, life: 0.7, payload: 2.8,
      doseScale: Math.max(0, this.gov.doseScale === undefined ? 1 : this.gov.doseScale),
      vx: 0, vy: 0,
    });
  };

  /* ------------------------------------------------------------ governor */

  // One GPU reduction of the VISIBLE window into GOV_TILES^2 texels, then a
  // 256-byte readback (WC_SETTINGS.GOVERNOR.sampleHz times a second). The
  // pipeline stall is negligible at that size and the value is at most a
  // quarter second stale — far faster than anything the wash can do to itself.
  // Reads the visible window ONLY: pigment parked in the off-canvas margin is
  // inflow in transit, and counting it would let the governor starve the
  // canvas while congratulating itself on the total.
  Sim.prototype._sampleField = function (tex) {
    const gl = this.gl, p = this.progs.reduceTile;
    gl.disable(gl.BLEND);
    gl.useProgram(p.prog);
    this._bindTex(0, tex);
    gl.uniform1i(p.u.uPigment, 0);
    gl.uniform2f(p.u.uVisMin, VISIBLE_MIN, VISIBLE_MIN);
    gl.uniform2f(p.u.uVisMax, VISIBLE_MAX, VISIBLE_MAX);
    gl.uniform2f(p.u.uTileTexel, 1 / GOV_TILES, 1 / GOV_TILES);
    gl.uniform1i(p.u.uSteps, GOV_STEPS);
    this._blit(this.govFBO);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.govFBO.fb);
    gl.readPixels(0, 0, GOV_TILES, GOV_TILES, gl.RGBA, gl.FLOAT, this.govBuf);
    let mass = 0, cov = 0, wet = 0;
    const n = GOV_TILES * GOV_TILES;
    for (let i = 0; i < n; i++) {
      mass += this.govBuf[i * 4];
      cov += this.govBuf[i * 4 + 1];
      wet += this.govBuf[i * 4 + 2];
    }
    return { mass: mass / n, cov: cov / n, wet: wet / n };
  };

  Sim.prototype._sampleCoverage = function () {
    return this._sampleField(this.pigment.read.tex);
  };

  // Proportional amplitude hold for the home field. Bounded on both sides so
  // it can only nudge — an unbounded gain would compound every half second and
  // turn the restoration target into a black square.
  Sim.prototype._homeGain = function () {
    const gov = this.gov;
    if (!(gov.ref > 0) || !(gov.homeMass > 1e-5)) return 1;
    const want = gov.ref / gov.homeMass;
    return Math.max(0.92, Math.min(1.10, want));
  };

  // The thermostat. This is the structural guarantee, not a tuning: whatever
  // the sliders say and whatever the pointer does, visible pigment is measured
  // and inflow is modulated to hold it inside [lowBand, highBand] x reference.
  // Below the band it raises bloom rate, per-bloom dose and restoration gain;
  // above it, it stops inflow and applies a small multiplicative bleed. Both
  // ends are needed — a one-sided governor is a ratchet that ends in mud.
  Sim.prototype._governorTick = function (dt) {
    const G = (typeof WC_SETTINGS !== 'undefined' && WC_SETTINGS.GOVERNOR) || null;
    const gov = this.gov;
    if (!G || !G.enabled || !(gov.ref > 0) || !(gov.covRef > 0)) {
      gov.bloomBoost = 0; gov.restoreGain = 1; gov.pigKeep = 1; gov.doseScale = 1;
      return;
    }
    const sampleDt = 1 / G.sampleHz;
    gov.acc += dt;
    if (gov.acc >= sampleDt) {
      gov.acc = 0;
      const s = this._sampleCoverage();
      gov.mass = s.mass; gov.cov = s.cov; gov.wet = s.wet;
      // The home field is measured too: it is advected like everything else,
      // so it needs its own amplitude hold or the restoration target decays.
      gov.homeMass = this._sampleField(this.home.read.tex).mass;
      gov.samples++;

      // The CONTROLLED variable is a heavily smoothed mass, not the instant
      // reading. This is the difference between a thermostat and a servo
      // chasing its own disturbance. A pointer being dragged across the canvas
      // pumps large amounts of pigment in and out on a 5-30 s cycle; a governor
      // that tracks that instantaneously fights it, and because filling is fast
      // (blooms + restoration) while the only sink is slow, the loop rectifies
      // the disturbance into a slow sawtooth — measured at wash 0.15 -> 0.075
      // over 60 s under abuse, i.e. the canvas visibly pulsing. Filtering the
      // measurement below the disturbance bandwidth leaves the governor
      // responding only to genuine sustained washout, which is the thing it
      // exists to prevent. It costs response time on a real collapse, and a
      // real collapse takes minutes.
      const aFall = 1 - Math.exp(-sampleDt / MEASURE_TAU_FALL);
      const aRise = 1 - Math.exp(-sampleDt / MEASURE_TAU_RISE);
      const follow = function (prev, next) {
        if (prev === undefined) return next;
        return prev + (next - prev) * (next < prev ? aFall : aRise);
      };
      gov.massSmooth = follow(gov.massSmooth, gov.mass);
      gov.covSmooth = follow(gov.covSmooth, gov.cov);

      // Derivative of the SMOOTHED signal, so the D term and the P term see the
      // same bandwidth. Differentiating the raw reading fed 4 Hz noise into a
      // 5 s slew limiter, which is its own instability.
      const r = Math.min(gov.covSmooth / gov.covRef, gov.massSmooth / gov.ref);
      const inst = (r - (gov.ratioPrev === undefined ? r : gov.ratioPrev)) / sampleDt;
      gov.rate = gov.rate === undefined ? inst : gov.rate + (inst - gov.rate) * 0.15;
      gov.ratioPrev = r;
    }

    // TWO controlled variables, deliberately asymmetric.
    //
    // The deficit side is driven by COVERAGE, because coverage is what the
    // design contract is about and it is not the same thing as mass. Under
    // aggressive dragging the repel force shovels pigment into dense ridges and
    // bares the paper between them: mass stayed comfortably near reference
    // (0.30-0.53 against a 0.415 target) while coverage fell to 79% and the
    // canvas looked stripped. A mass governor is blind to that by construction.
    //
    // The excess side stays on MASS, because coverage saturates at 1.0 and so
    // cannot report "too much paint" at all — that is the mud direction, and
    // only mass can see it.
    // The deficit is driven by whichever of the two measures is worse. They
    // fail in different directions and each is blind to the other's failure:
    //
    //   mass alone     — under drag abuse the repel force shovels pigment into
    //                    dense ridges and bares the paper between them. Mass sat
    //                    at 0.30-0.53 against a 0.415 target while screen
    //                    coverage fell to 79% and the canvas looked stripped.
    //   coverage alone — a thin film spread over everything scores full marks.
    //                    At threshold 0.02 it pinned to 1.000, the governor
    //                    concluded all was well, and mass fell to 0.09 (22% of
    //                    reference) while "coverage" stayed perfect.
    //
    // Hence min(): the canvas needs enough paint AND that paint spread over
    // enough of the frame. Excess stays on mass alone, because coverage
    // saturates at 1.0 and so cannot report the mud direction at all.
    const covRatio = (gov.covSmooth === undefined ? gov.cov : gov.covSmooth) / gov.covRef;
    const massRatio = (gov.massSmooth === undefined ? gov.mass : gov.massSmooth) / gov.ref;
    const ratio = Math.min(covRatio, massRatio);
    const rate = gov.rate || 0;

    // PD, not P. Correction starts the moment the canvas drops below its
    // reference — waiting for lowBand left a visible trough at the start of
    // every session, because inflow needs seconds to arrive. But a pure
    // proportional loop with that dead time overshoots and rings: measured at
    // +10% over reference by t=30 s, then a settle back down that reads as a
    // 31% "drop" and fails the acceptance criterion on its own transient. The
    // derivative term backs the levers off in proportion to how fast coverage
    // is already recovering. lowBand/highBand remain the *reporting* band.
    const deficit = Math.max(0, Math.min(1, ((1 - ratio) - G.damping * rate) / (1 - 0.45)));

    // The derivative term may only ever *reduce* a response, never create one.
    // Letting it add to `excess` meant a canvas sitting exactly at its
    // reference but recovering at +0.05/s scored excess 0.16 and started
    // bleeding — and `excessBleed` is multiplicative per second, so a spurious
    // bleed that persists for 30 s removes 98% of the wash. That is precisely
    // the collapse-then-overshoot seen under drag abuse. Excess is now gated on
    // actually being above the band, and the bleed is a trim rather than a
    // hammer: the bloom throttle below is the real ceiling.
    const over = massRatio - G.highBand;
    const excess = over > 0 ? Math.min(1, over / 0.5) : 0;

    let bloomBoost = G.maxBloomRate * deficit;
    let doseScale = 1 + 1.5 * deficit;
    const restoreGain = 1 + (G.maxRestoreGain - 1) * deficit;

    // Above the band the governor withholds PIGMENT, never the blooms
    // themselves. Throttling the bloom RATE to zero is what froze the untouched
    // canvas solid from ~t=240s in the 10-minute run: blooms are also the only
    // ambient source of water, so shutting them off let the paper dry, which
    // closed the wet gate, which made advection a no-op -- and frozen pigment
    // can neither spread nor leave, so mass could never fall and the blooms
    // never came back. A stable dead state, and it violates "continuous
    // watercolor movement" exactly as much as an empty canvas does.
    //
    // Water inflow and pigment inflow travel through one mechanism and only one
    // of them is the thermostat's business. So above the band the blooms keep
    // arriving at the slider's base rate, carrying water, velocity and motion,
    // and carrying no colour. (Water-only blooms are precisely what the broken
    // site build did for EVERY bloom -- correct behaviour, wrong default.)
    if (excess > 0) {
      bloomBoost = 0;
      doseScale = 0.35 * Math.max(0, 1 - excess);
    }

    // THIRD LEVER: a wetness floor, and it is a first-class guarantee rather
    // than a side effect.
    //
    // Motion in this sim is gated on wetness — the advect pass blends by the
    // wet gate, so at zero wetness it is a no-op and the wash is a still image.
    // Nothing until now defended that. Round 8 fixed the freeze for the
    // untouched case by letting de-pigmented blooms keep carrying water, but
    // gentle still dried out and locked solid at t=360 (wetVis 0.52 -> 0.003,
    // mass bit-identical at 0.8072 for the last nine checkpoints): 8 blooms a
    // minute simply do not deliver enough water against evaporation once the
    // pointer stops re-wetting.
    //
    // So wetness gets its own deficit and its own inflow, and it is applied
    // AFTER the excess branch — a canvas that is over-full on pigment still
    // needs to be wet enough to move. Those blooms carry no colour (doseScale
    // is already 0 up there), so this cannot fight the pigment thermostat.
    const wetDeficit = Math.max(0, Math.min(1, (G.wetFloor - (gov.wet || 0)) / G.wetFloor));
    bloomBoost = Math.max(bloomBoost, G.maxBloomRate * G.wetBoostFrac * wetDeficit);
    gov.wetDeficit = wetDeficit;

    // Slew-limit the levers so they ramp rather than step.
    const k = 1 - Math.exp(-dt / G.slewTau);
    gov.bloomBoost += (bloomBoost - gov.bloomBoost) * k;
    gov.doseScale += (doseScale - gov.doseScale) * k;
    gov.restoreGain += (restoreGain - gov.restoreGain) * k;
    // Bleed is a per-frame factor, so it is applied from the damped excess
    // directly rather than slewed twice.
    gov.pigKeep = excess > 0 ? Math.exp(-G.excessBleed * excess * dt) : 1;
    gov.ratio = ratio;
    gov.massRatio = massRatio;
    gov.covRatio = covRatio;
  };

  /* -------------------------------------------------------- transport */

  // Two-pass MacCormack advection of a double-buffered dye field.
  //   pass 1: plain semi-Lagrangian into `tmp`
  //   pass 2: corrector, reading `tmp` and the original, into `field.write`
  // Leaves `field.read` holding the result.
  Sim.prototype._advectMac = function (field, tmp, dt, texelX, texelY, wetGate) {
    const gl = this.gl;
    gl.disable(gl.BLEND);

    let p = this.progs.advect;
    gl.useProgram(p.prog);
    this._bindTex(0, this.velocity.read.tex);
    this._bindTex(1, field.read.tex);
    gl.uniform1i(p.u.uVelocity, 0);
    gl.uniform1i(p.u.uSource, 1);
    gl.uniform2f(p.u.uTexel, texelX, texelY);
    gl.uniform1f(p.u.uDt, dt);
    gl.uniform1f(p.u.uDissipation, 1);
    gl.uniform1f(p.u.uWetGate, wetGate);
    this._blit(tmp);

    p = this.progs.advectMac;
    gl.useProgram(p.prog);
    this._bindTex(0, this.velocity.read.tex);
    this._bindTex(1, field.read.tex);
    this._bindTex(2, tmp.tex);
    gl.uniform1i(p.u.uVelocity, 0);
    gl.uniform1i(p.u.uSource, 1);
    gl.uniform1i(p.u.uForward, 2);
    gl.uniform2f(p.u.uTexel, texelX, texelY);
    gl.uniform2f(p.u.uLimTexel, 1 / field.read.w, 1 / field.read.h);
    gl.uniform1f(p.u.uDt, dt);
    gl.uniform1f(p.u.uWetGate, wetGate);
    gl.uniform1f(p.u.uStrength, MAC_STRENGTH);
    this._blit(field.write);
    field.swap();
  };

  /* ---------------------------------------------------------------- step */

  Sim.prototype.step = function (dt) {
    const gl = this.gl, P = this.params;
    this.time += dt;
    const simTexelX = 1 / this.simW, simTexelY = 1 / this.simH;
    gl.disable(gl.BLEND);

    // 1. advect velocity
    let p = this.progs.advect;
    gl.useProgram(p.prog);
    this._bindTex(0, this.velocity.read.tex);
    gl.uniform1i(p.u.uVelocity, 0);
    gl.uniform1i(p.u.uSource, 0);
    gl.uniform2f(p.u.uTexel, simTexelX, simTexelY);
    gl.uniform1f(p.u.uDt, dt);
    gl.uniform1f(p.u.uDissipation, Math.pow(VEL_KEEP_PER_SEC, dt));
    gl.uniform1f(p.u.uWetGate, 0);
    this._blit(this.velocity.write);
    this.velocity.swap();

    const applyBoundary = () => {
      const wall = this.progs.boundary;
      gl.useProgram(wall.prog);
      this._bindTex(0, this.velocity.read.tex);
      gl.uniform1i(wall.u.uVelocity, 0);
      gl.uniform2f(wall.u.uTexel, simTexelX, simTexelY);
      this._blit(this.velocity.write);
      this.velocity.swap();
    };

    // 2a. ambient drift (curl noise)
    p = this.progs.drift;
    gl.useProgram(p.prog);
    this._bindTex(0, this.velocity.read.tex);
    gl.uniform1i(p.u.uVelocity, 0);
    gl.uniform1f(p.u.uTime, this.time);
    gl.uniform1f(p.u.uDt, dt);
    gl.uniform1f(p.u.uMag, P.ambientDrift * (this.reduced ? 0.15 : 1));
    gl.uniform1f(p.u.uAspect, this.aspect);
    this._blit(this.velocity.write);
    this.velocity.swap();

    // 2b. pointer splats (+ re-wetting water)
    this._applyPointer();

    // 2c. coverage governor, then the droplets it just re-rated
    this._governorTick(dt);
    this._dropletTick(dt);

    applyBoundary();

    // 3. projection: divergence -> Jacobi pressure -> subtract gradient
    p = this.progs.divergence;
    gl.useProgram(p.prog);
    this._bindTex(0, this.velocity.read.tex);
    gl.uniform1i(p.u.uVelocity, 0);
    gl.uniform2f(p.u.uTexel, simTexelX, simTexelY);
    this._blit(this.divergenceFBO);

    this._clear(this.pressure.read);
    p = this.progs.pressure;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.uTexel, simTexelX, simTexelY);
    this._bindTex(1, this.divergenceFBO.tex);
    gl.uniform1i(p.u.uDivergence, 1);
    for (let i = 0; i < PRESSURE_ITERS; i++) {
      this._bindTex(0, this.pressure.read.tex);
      gl.uniform1i(p.u.uPressure, 0);
      this._blit(this.pressure.write);
      this.pressure.swap();
    }

    p = this.progs.gradient;
    gl.useProgram(p.prog);
    this._bindTex(0, this.pressure.read.tex);
    this._bindTex(1, this.velocity.read.tex);
    gl.uniform1i(p.u.uPressure, 0);
    gl.uniform1i(p.u.uVelocity, 1);
    gl.uniform2f(p.u.uTexel, simTexelX, simTexelY);
    this._blit(this.velocity.write);
    this.velocity.swap();
    applyBoundary();

    // 4. advect pigment + wetness (conserved: dissipation 1; wetness-gated so
    //    dried paint stays put until re-wetted), MacCormack-corrected.
    this._advectMac(this.pigment, this.macFBO, dt, simTexelX, simTexelY, 1);

    // 4b. the home field drifts with the same flow. Restoration then refills
    //     deficits where the pigment WENT rather than where it started, which
    //     is what stops stirring from flattening the composition. No wet gate:
    //     home is a memory of the wash, not paint sitting on paper.
    this._advectMac(this.home, this.macFBO, dt, simTexelX, simTexelY, 0);

    // 5. watercolor pass (diffusion / drying front / granulation / evaporation)
    const dtn = Math.min(dt * 60, 2); // per-frame effects normalized to 60fps
    p = this.progs.watercolor;
    gl.useProgram(p.prog);
    this._bindTex(0, this.pigment.read.tex);
    gl.uniform1i(p.u.uPigment, 0);
    gl.uniform2f(p.u.uTexel, 1 / this.dyeW, 1 / this.dyeH);
    gl.uniform1f(p.u.uSpread, P.spread);
    gl.uniform1f(p.u.uEvapKeep, Math.exp(-(0.02 + 0.3 * P.drying) * dt));
    gl.uniform1f(p.u.uWetBlur, Math.min(1, dtn * 0.06));
    gl.uniform1f(p.u.uPigKeep, this.gov.pigKeep);
    // Governor may raise the floor further while it is starved of motion, but
    // never lower it below the structural minimum.
    gl.uniform1f(p.u.uWetFloor, Math.max(AMBIENT_HUMIDITY,
      AMBIENT_HUMIDITY * (1 + 0.8 * (this.gov.wetDeficit || 0))));
    this._blit(this.pigment.write);
    this.pigment.swap();

    // Restore only deficits, slowly, to cancel interpolation loss while
    // retaining every displacement caused by the brush. `restoreGain` is the
    // governor's second lever; it is 1 while the canvas is in band.
    this.replenishAcc += dt;
    if (this.replenishAcc >= 0.5) {
      const elapsed = this.replenishAcc;
      this.replenishAcc = 0;
      const rate = P.restoreRate * this.gov.restoreGain;
      p = this.progs.replenish;
      gl.useProgram(p.prog);
      this._bindTex(0, this.pigment.read.tex);
      this._bindTex(1, this.home.read.tex);
      gl.uniform1i(p.u.uPigment, 0);
      gl.uniform1i(p.u.uHome, 1);
      gl.uniform1f(p.u.uAmount, 1 - Math.exp(-rate * elapsed));
      this._blit(this.pigment.write);
      this.pigment.swap();

      // Home tracks the live wash and holds its own amplitude, so a session
      // that runs for hours does not end up restoring toward a blank field.
      p = this.progs.homeRefresh;
      gl.useProgram(p.prog);
      this._bindTex(0, this.home.read.tex);
      this._bindTex(1, this.pigment.read.tex);
      gl.uniform1i(p.u.uHome, 0);
      gl.uniform1i(p.u.uPigment, 1);
      gl.uniform2f(p.u.uTexel, 1 / this.dyeW, 1 / this.dyeH);
      gl.uniform1f(p.u.uTrack, 1 - Math.exp(-HOME_TRACK_PER_SEC * elapsed));
      gl.uniform1f(p.u.uGain, this._homeGain());
      this._blit(this.home.write);
      this.home.swap();
    }
  };

  /* -------------------------------------------------------------- render */

  Sim.prototype.render = function () {
    const gl = this.gl, P = this.params, hr = this.heroRect;
    gl.disable(gl.BLEND);
    const p = this.progs.render;
    gl.useProgram(p.prog);
    this._bindTex(0, this.pigment.read.tex);
    this._bindTex(1, this.grainTex);
    gl.uniform1i(p.u.uPigment, 0);
    gl.uniform1i(p.u.uGrain, 1);
    gl.uniform2f(p.u.uGrainScale, this.canvas.width / GRAIN_SIZE, this.canvas.height / GRAIN_SIZE);
    gl.uniform2f(p.u.uGrainTexel, 1 / GRAIN_SIZE, 1 / GRAIN_SIZE);
    gl.uniform3f(p.u.uPaper, this.paper[0], this.paper[1], this.paper[2]);
    gl.uniformMatrix3fv(p.u.uK, false, this.K);
    gl.uniform1f(p.u.uDensity, P.density);
    gl.uniform1f(p.u.uGrainAmount, P.grainAmount);
    gl.uniform1f(p.u.uEdgeDark, P.edgeDark);
    gl.uniform1f(p.u.uGranulation, P.granulation);
    gl.uniform2f(p.u.uPigmentTexel, 1 / this.dyeW, 1 / this.dyeH);
    gl.uniform1f(p.u.uDomainScale, DOMAIN_SCALE);
    gl.uniform4f(p.u.uHeroRect, hr.x0, hr.y0, hr.x1, hr.y1);
    gl.uniform1f(p.u.uHeroRadius, 0.045);
    gl.uniform1f(p.u.uHeroFade, 0.10);
    gl.uniform1f(p.u.uAspect, this.aspect);
    this._blit(null);
  };

  Sim.prototype.stats = function () {
    return {
      simRes: [this.simW, this.simH],
      dyeRes: [this.dyeW, this.dyeH],
      domainScale: DOMAIN_SCALE,
      lastBloom: this.lastBloom,
      time: this.time,
      governor: {
        ref: this.gov.ref,
        mass: this.gov.mass,
        massSmooth: this.gov.massSmooth,
        covRef: this.gov.covRef,
        covSmooth: this.gov.covSmooth,
        covRatio: this.gov.covRatio,
        ratio: this.gov.ratio,
        massRatio: this.gov.massRatio,
        cov: this.gov.cov,
        homeMass: this.gov.homeMass,
        bloomBoost: this.gov.bloomBoost,
        restoreGain: this.gov.restoreGain,
        pigKeep: this.gov.pigKeep,
        rate: this.gov.rate,
        wet: this.gov.wet,
        wetDeficit: this.gov.wetDeficit,
        effectiveBloomRate: this.params.bloomRate + this.gov.bloomBoost,
      },
      pendingBlooms: this.pendingDrops.length,
    };
  };

  return Sim;
})();
