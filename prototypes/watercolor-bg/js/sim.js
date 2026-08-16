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

  // ~0.995 per frame at 60fps (spec), expressed per-second so dt-scaling is
  // frame-rate independent: 0.995^60 ≈ 0.74.
  const VEL_KEEP_PER_SEC = 0.74;

  const SPLAT_FORCE = 6000;     // UV pointer delta -> cells/sec
  const MAX_FORCE = 280;        // cells/sec cap per splat
  const REPEL_FORCE = 90;       // cells/sec outward at repel=1, strength=1
  const MOUSE_WATER = 0.10;     // water per pointer splat (re-liquefies paint)

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

    const gl = this.gl;
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('watercolor: EXT_color_buffer_float unavailable');
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, WC_SHADERS.vertex, 'vertex');
    this.progs = {
      advect: createProgram(gl, vs, WC_SHADERS.advect, 'advect'),
      boundary: createProgram(gl, vs, WC_SHADERS.boundary, 'boundary'),
      drift: createProgram(gl, vs, WC_SHADERS.drift, 'drift'),
      splatVel: createProgram(gl, vs, WC_SHADERS.splatVel, 'splatVel'),
      splatPig: createProgram(gl, vs, WC_SHADERS.splatPig, 'splatPig'),
      divergence: createProgram(gl, vs, WC_SHADERS.divergence, 'divergence'),
      pressure: createProgram(gl, vs, WC_SHADERS.pressure, 'pressure'),
      gradient: createProgram(gl, vs, WC_SHADERS.gradient, 'gradient'),
      watercolor: createProgram(gl, vs, WC_SHADERS.watercolor, 'watercolor'),
      replenish: createProgram(gl, vs, WC_SHADERS.replenish, 'replenish'),
      render: createProgram(gl, vs, WC_SHADERS.render, 'render'),
    };

    this.grainTex = makeGrainTexture(gl, this.rng);
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
    if (this.home) {
      gl.deleteTexture(this.home.tex);
      gl.deleteFramebuffer(this.home.fb);
    }
    const dye = gridSize(this.params.dyeRes, this.canvas.width, this.canvas.height);
    this.dyeW = dye[0]; this.dyeH = dye[1];
    this.pigment = createDouble(gl, this.dyeW, this.dyeH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.home = createFBO(gl, this.dyeW, this.dyeH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
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
    this._clear(this.velocity.read);
    this._clear(this.velocity.write);
    this._clear(this.pressure.read);
    this._clear(this.pressure.write);
    this._clear(this.pigment.read);
    this._clear(this.pigment.write);
    this._seedComposition();
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
    this._blit(this.home);
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
    if (this.reduced) { this.pendingDrops.length = 0; return; }

    // Accumulator (drops/min) adapts immediately when bloomRate changes;
    // the goal randomizes the interval by ±50%.
    if (P.bloomRate > 0) {
      this.dropAcc += dt * P.bloomRate / 60;
      if (this.dropAcc >= this.dropGoal) {
        this.dropAcc = 0;
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
      const dose = Math.min(dt, 1 / 30) * 4.0;
      this.splatPigment(d.x, d.y, d.r, [d.pig[0] * dose, d.pig[1] * dose, d.pig[2] * dose], 0.45 * dose);
      if (d.age >= 0.9) this.pendingDrops.splice(i, 1);
    }
  };

  Sim.prototype._spawnDroplet = function () {
    const R = this.rng;
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
    let vx = ix + (iy !== 0 ? tangent : 0);
    let vy = iy + (ix !== 0 ? tangent : 0);
    const vl = Math.hypot(vx, vy);
    const speed = 170 + 70 * R();
    vx = vx / vl * speed;
    vy = vy / vl * speed;
    const r = (0.035 + 0.03 * R()) / DOMAIN_SCALE;
    this.splatVelocity(x, y, r * 3.5, vx, vy, 0);
    this.splatPigment(x, y, r, [0, 0, 0], 0.85);   // water first
    const pig = [0, 0, 0];
    pig[Math.floor(R() * 3) % 3] = 0.60 + 0.35 * R();
    this.pendingDrops.push({
      x: x, y: y, r: r * 0.55, pig: pig, age: 0,
      vx: vx / this.simW * 0.42,
      vy: vy / this.simH * 0.42,
    });
    this.lastBloom = {
      edge: edge,
      domainPoint: [x, y],
      canvasPoint: [(x - VISIBLE_MIN) * DOMAIN_SCALE, (y - VISIBLE_MIN) * DOMAIN_SCALE],
      velocity: [vx, vy],
    };
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

    // ambient droplets
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
    //    dried paint stays put until re-wetted)
    p = this.progs.advect;
    gl.useProgram(p.prog);
    this._bindTex(0, this.velocity.read.tex);
    this._bindTex(1, this.pigment.read.tex);
    gl.uniform1i(p.u.uVelocity, 0);
    gl.uniform1i(p.u.uSource, 1);
    gl.uniform2f(p.u.uTexel, simTexelX, simTexelY);
    gl.uniform1f(p.u.uDt, dt);
    gl.uniform1f(p.u.uDissipation, 1);
    gl.uniform1f(p.u.uWetGate, 1);
    this._blit(this.pigment.write);
    this.pigment.swap();

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
    this._blit(this.pigment.write);
    this.pigment.swap();

    // Restore only deficits, slowly, to cancel interpolation loss while
    // retaining every displacement caused by the brush.
    this.replenishAcc += dt;
    if (this.replenishAcc >= 0.5) {
      const elapsed = this.replenishAcc;
      this.replenishAcc = 0;
      p = this.progs.replenish;
      gl.useProgram(p.prog);
      this._bindTex(0, this.pigment.read.tex);
      this._bindTex(1, this.home.tex);
      gl.uniform1i(p.u.uPigment, 0);
      gl.uniform1i(p.u.uHome, 1);
      gl.uniform1f(p.u.uAmount, 1 - Math.exp(-0.012 * elapsed));
      this._blit(this.pigment.write);
      this.pigment.swap();
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
    };
  };

  return Sim;
})();
