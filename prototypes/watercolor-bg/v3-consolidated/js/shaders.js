"use strict";
/* All GLSL for the watercolor sim, as template-literal strings.
   Exposes one global: WC_SHADERS. Classic script — no modules. */

const WC_SHADERS = (function () {

  // Attribute-less fullscreen triangle (gl_VertexID is core in GLSL ES 3.00).
  const vertex = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  // Semi-Lagrangian advection. Velocity is stored in sim-grid cells/second, so
  // the UV displacement is vel * simTexel * dt regardless of the target's own
  // resolution. uWetGate=1 makes dry pigment resist motion (paint that has
  // dried onto the paper should not be pushed around by air currents; the
  // mouse re-wets it first, which is what makes strokes re-liquefy paint).
  const advect = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDissipation;
uniform float uWetGate;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  float gate = mix(1.0, min(1.0, texture(uSource, vUv).a * 2.5), uWetGate);
  vec2 coord = clamp(vUv - uDt * vel * uTexel * gate, 0.5 * uTexel, 1.0 - 0.5 * uTexel);
  frag = uDissipation * texture(uSource, coord);
}`;

  // Closed 1.2x domain: flip only an outward normal component in the wall
  // cells. It runs before divergence and after projection.
  const boundary = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  vec2 v = texture(uVelocity, vUv).xy;
  if (vUv.x <= uTexel.x && v.x < 0.0) v.x = -v.x;
  if (vUv.x >= 1.0 - uTexel.x && v.x > 0.0) v.x = -v.x;
  if (vUv.y <= uTexel.y && v.y < 0.0) v.y = -v.y;
  if (vUv.y >= 1.0 - uTexel.y && v.y > 0.0) v.y = -v.y;
  frag = vec4(v, 0.0, 1.0);
}`;

  // Ambient drift: curl of a slowly-evolving 2-octave simplex field.
  // snoise() is the standard Ashima/webgl-noise 3D simplex implementation.
  const drift = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uVelocity;
uniform float uTime;
uniform float uDt;
uniform float uMag;
uniform float uAspect;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float psi(vec2 p, float t) {
  vec3 q = vec3(p * 3.0, t);
  return snoise(q) + 0.5 * snoise(q * 2.03 + vec3(17.1, 9.7, 3.3));
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime * 0.02;
  float e = 0.015;
  vec2 curl;
  curl.x =  (psi(p + vec2(0.0, e), t) - psi(p - vec2(0.0, e), t)) / (2.0 * e);
  curl.y = -(psi(p + vec2(e, 0.0), t) - psi(p - vec2(e, 0.0), t)) / (2.0 * e);
  vec2 vel = texture(uVelocity, vUv).xy;
  frag = vec4(vel + curl * uMag * 2.0 * uDt, 0.0, 1.0);
}`;

  // Gaussian force splat, drawn with additive blending into the velocity FBO.
  // uDir is the stroke direction force; uRepel pushes radially outward from
  // the pointer — the "repel/redistribute" feel.
  const splatVel = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform vec2 uPoint;
uniform float uRadius;
uniform vec2 uDir;
uniform float uRepel;
uniform float uAspect;
void main() {
  vec2 d = vUv - uPoint;
  d.x *= uAspect;
  float g = exp(-dot(d, d) / (uRadius * uRadius));
  vec2 radial = d / max(length(d), 1e-5);
  frag = vec4((uDir + radial * uRepel) * g, 0.0, 0.0);
}`;

  // Gaussian pigment/water splat, additive. rgb = pigment channel densities,
  // a = water. Water-only splats (uPigment = 0) are how the mouse and the
  // first phase of a droplet re-wet the paper.
  const splatPig = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform vec2 uPoint;
uniform float uRadius;
uniform vec3 uPigment;
uniform float uWater;
uniform float uAspect;
void main() {
  vec2 d = vUv - uPoint;
  d.x *= uAspect;
  float g = exp(-dot(d, d) / (uRadius * uRadius));
  frag = vec4(uPigment, uWater) * g;
}`;

  const divergence = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  frag = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

  const pressure = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
void main() {
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float div = texture(uDivergence, vUv).x;
  frag = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`;

  const gradient = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 vel = texture(uVelocity, vUv).xy;
  frag = vec4(vel - 0.5 * vec2(R - L, T - B), 0.0, 1.0);
}`;

  // The watercolor pass — the thing that makes this read as paint on paper
  // rather than smoke. Per spec section 5.
  const watercolor = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uPigment;
uniform vec2 uTexel;
uniform float uSpread;
uniform float uEvapKeep;     /* per-frame wetness retention, exp(-lambda*dt) */
uniform float uWetBlur;      /* per-frame wetness diffusion mix, dt-scaled */
void main() {
  vec4 c = texture(uPigment, vUv);
  vec3 p = max(c.rgb, vec3(0.0));
  float w = clamp(c.a, 0.0, 1.0);
  /* A convex wetness-gated diffusion mix. Appearance effects stay out of the
     conserved state and are applied optically in the render pass. */
  float o = 1.0 + uSpread * w;
  vec2 dx = vec2(uTexel.x, 0.0);
  vec2 dy = vec2(0.0, uTexel.y);
  vec3 s1 = texture(uPigment, vUv + ( dx + dy) * o).rgb;
  vec3 s2 = texture(uPigment, vUv + ( dx - dy) * o).rgb;
  vec3 s3 = texture(uPigment, vUv + (-dx + dy) * o).rgb;
  vec3 s4 = texture(uPigment, vUv + (-dx - dy) * o).rgb;
  vec3 b = 0.25 * (s1 + s2 + s3 + s4);

  /* Water spreads ahead of pigment: fixed-offset wetness blur so moisture
     creeps into dry paper (a texel can't gather with its own gated offset). */
  float ow = 1.3;
  float w1 = texture(uPigment, vUv + ( dx + dy) * ow).a;
  float w2 = texture(uPigment, vUv + ( dx - dy) * ow).a;
  float w3 = texture(uPigment, vUv + (-dx + dy) * ow).a;
  float w4 = texture(uPigment, vUv + (-dx - dy) * ow).a;
  float wb = clamp(0.25 * (w1 + w2 + w3 + w4), 0.0, 1.0);

  vec3 pn = mix(p, b, clamp(uSpread * w * 0.035, 0.0, 0.22));

  /* Evaporation (re-wetting arrives via additive water splats). */
  float wn = mix(w, wb, uWetBlur) * uEvapKeep;

  frag = vec4(pn, wn);
}`;

  // Bounded homeostasis: refill only deficits relative to the seeded start
  // field. Existing pigment above the target is untouched.
  const replenish = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uPigment;
uniform sampler2D uHome;
uniform float uAmount;
void main() {
  vec4 c = texture(uPigment, vUv);
  vec3 target = texture(uHome, vUv).rgb;
  c.rgb += max(target - c.rgb, vec3(0.0)) * uAmount;
  frag = c;
}`;

  const seedArt = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uArt;
uniform float uDomainScale;
void main() {
  vec2 artUv = 0.5 + (vUv - 0.5) * uDomainScale;
  if (any(lessThan(artUv, vec2(0.0))) || any(greaterThan(artUv, vec2(1.0)))) {
    frag = vec4(0.0);
  } else {
    vec3 p = texture(uArt, artUv).rgb;
    frag = vec4(p * 1.08, 0.58 * step(0.002, dot(p, vec3(1.0))));
  }
}`;

  // Full-res render: procedural paper + Beer-Lambert glazing + wet look +
  // hero legibility mask.
  const render = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uPigment;
uniform sampler2D uGrain;
uniform vec2 uGrainScale;
uniform vec2 uGrainTexel;
uniform vec3 uPaper;
uniform mat3 uK;             /* column i = -ln(pigment_i color), CPU-precomputed */
uniform float uDensity;
uniform float uGrainAmount;
uniform float uEdgeDark;
uniform float uGranulation;
uniform vec2 uPigmentTexel;
uniform float uDomainScale;
uniform vec4 uHeroRect;      /* xy = uv min, zw = uv max */
uniform float uHeroRadius;
uniform float uHeroFade;
uniform float uAspect;
void main() {
  vec2 simUv = 0.5 + (vUv - 0.5) / uDomainScale;
  vec4 c = texture(uPigment, simUv);
  vec3 d = max(c.rgb, vec3(0.0));
  float w = clamp(c.a, 0.0, 1.0);

  /* Paper: value-noise tooth lit by a fake normal from the grain gradient,
     plus sparse dark speckle flecks (grain green channel). */
  vec2 guv = vUv * uGrainScale;
  vec4 g = texture(uGrain, guv);
  float gx = texture(uGrain, guv + vec2(uGrainTexel.x, 0.0)).r - g.r;
  float gy = texture(uGrain, guv + vec2(0.0, uGrainTexel.y)).r - g.r;
  vec3 n = normalize(vec3(-gx * 40.0, -gy * 40.0, 1.0));
  vec3 L = normalize(vec3(-0.4, 0.75, 0.9));
  float tooth = 0.88 + 0.24 * max(dot(n, L), 0.0);
  vec3 paper = uPaper * mix(1.0, tooth, uGrainAmount);
  paper *= 1.0 - 0.5 * uGrainAmount * g.g;
  paper *= 1.0 - 0.07 * w;   /* wet paper reads darker */

  /* Hero legibility: rounded-rect falloff thins the wash, as if clear water
     was brushed there. Aspect-corrected so corners stay round. */
  vec2 pa = vec2(vUv.x * uAspect, vUv.y);
  vec2 ca = vec2((uHeroRect.x + uHeroRect.z) * 0.5 * uAspect, (uHeroRect.y + uHeroRect.w) * 0.5);
  vec2 ha = vec2((uHeroRect.z - uHeroRect.x) * 0.5 * uAspect, (uHeroRect.w - uHeroRect.y) * 0.5);
  vec2 q = abs(pa - ca) - max(ha - vec2(uHeroRadius), vec2(0.0));
  float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - uHeroRadius;
  float mask = 1.0 - smoothstep(0.0, uHeroFade, sd);

  /* Beer-Lambert glazing: glazes mix like real watercolor (teal over gold
     goes deep green, never gray mud). */
  vec3 dL = texture(uPigment, simUv - vec2(uPigmentTexel.x, 0.0)).rgb;
  vec3 dR = texture(uPigment, simUv + vec2(uPigmentTexel.x, 0.0)).rgb;
  vec3 dB = texture(uPigment, simUv - vec2(0.0, uPigmentTexel.y)).rgb;
  vec3 dT = texture(uPigment, simUv + vec2(0.0, uPigmentTexel.y)).rgb;
  vec3 edge = max(d - 0.25 * (dL + dR + dB + dT), vec3(0.0));
  float dry = 1.0 - smoothstep(0.12, 0.55, w);
  d *= 1.0 + uGranulation * dry * (g.r - 0.5) * 0.38;
  d += edge * uEdgeDark * dry;
  float od = uDensity * (1.0 - 0.55 * mask);
  vec3 rgb = paper * exp(-(uK * d) * od);

  /* Tiny sheen where the paper is wet. */
  float sheen = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 6.0);
  rgb += w * w * sheen * 0.04;

  frag = vec4(rgb, 1.0);
}`;

  return {
    vertex: vertex,
    advect: advect,
    boundary: boundary,
    drift: drift,
    splatVel: splatVel,
    splatPig: splatPig,
    divergence: divergence,
    pressure: pressure,
    gradient: gradient,
    watercolor: watercolor,
    replenish: replenish,
    seedArt: seedArt,
    render: render,
  };
})();
