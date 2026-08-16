"use strict";
/* THE one definition of every watercolor knob: canonical default, panel range,
   step, precision, and help text.

   Both surfaces load THIS file and nothing else defines a default:
     - the site            index.html            -> watercolor/settings.js
     - the prototype shell prototypes/watercolor-bg/index.html -> ../../watercolor/settings.js
   There is no second copy of the numbers, so the two cannot drift again. If you
   change a default, change it here; the panel range moves with it because the
   panel is generated from CONTROLS rather than from a parallel list.

   The values marked "owner calibration" are the measured set from the owner's
   panel screenshot and must not be re-derived from presets. Presets are named
   *departures* from this baseline, never its source. */

const WC_SETTINGS = (function () {

  /* Every live knob. `def` is canonical; `min`/`max` bound the panel slider.

     2026-08-12 ambient-flow round. The twelve pre-existing defaults below are
     the OWNER'S OWN hand-tuned panel state (data/wc-ambient-f3/owner-settings.json),
     not a re-derivation: he drove the live panel until the canvas read right and
     exported. Do not "restore" any of them from the older calibration without a
     measured reason. What he moved, and why it matters downstream:
       bloomRate    8    -> 19.5   his lever 2, "more random spurts"
       ambientDrift 0.35 -> 0.46   more continuous curl
       density      0.50 -> 0.57   his lever 1, read as "more pigment"
       drying       0.12 -> 0.36   3x; crisper rims, but it is also the reason
                                   the wetness floor now works much harder
       spread       0.06 -> 0.034  tighter, less mush
       mouseRadius  0.080-> 0.045  finer brush
       mouseStrength0.38 -> 0.59   compensates the smaller brush
       edgeDark     1.50 -> 1.25, grainAmount 0.60 -> 0.20  (paper reads quieter)
     The three bloom* knobs after them are NEW this round and are the mechanical
     home of his lever 3 ("decrease the velocity of the spurts"). */
  const CONTROLS = [
    { k: 'spread', label: 'Spread', min: 0, max: 0.25, step: 0.002, dp: 3, def: 0.034,
      help: 'Wet pigment diffuses outward faster.' },
    { k: 'drying', label: 'Drying', min: 0, max: 1, step: 0.01, dp: 2, def: 0.36,
      help: 'Water evaporates faster, stopping flow sooner.' },
    { k: 'edgeDark', label: 'Edge darkening', min: 0, max: 1.5, step: 0.01, dp: 2, def: 1.25,
      help: 'Deepens optical pigment at dry wash rims.' },
    { k: 'granulation', label: 'Granulation', min: 0, max: 1, step: 0.01, dp: 2, def: 0.20,
      help: 'Settles visible pigment into the paper tooth.' },
    { k: 'grainAmount', label: 'Paper texture', min: 0, max: 1, step: 0.01, dp: 2, def: 0.20,
      help: 'Strength of the paper tooth lighting and speckle.' },
    { k: 'density', label: 'Pigment density', min: 0.3, max: 2.5, step: 0.01, dp: 2, def: 0.57,
      help: 'Changes glaze opacity without changing pigment mass.' },
    { k: 'bloomRate', label: 'Blooms (off-canvas)', min: 0, max: 40, step: 0.5, dp: 1, unit: '/min', def: 19.5,
      help: 'Base rate of pigment blooms drifting in from outside the frame. The coverage governor raises this on its own whenever the canvas runs pale, so 0 does not mean "no inflow".' },

    /* ---- lever 3: how a bloom ENTERS. Two knobs, deliberately separate. ----

       These were hard-coded in sim.js `_spawnDroplet` until this round
       (`speed = 170 + 70*R()`, then `vx / simW * 0.42`), which is why there was
       no way to answer the owner's "the blooms shoot through the canvas and
       repel everything outward" from the panel at all.

       They are two knobs because they are two different physical things that
       the old single `speed` conflated, and the failure the owner described is
       ONLY the first of them:
         bloomSpeed  the impulse stamped into the VELOCITY field at the spawn
                     point. This is the jet. At the old ~205 cells/s it is a
                     shove roughly three quarters of the pointer's own force cap
                     (MAX_FORCE 280) arriving in one frame, several times a
                     minute, from off-screen — that is the thing that punches
                     across the frame and shoves the standing wash aside.
         bloomDrift  how fast the bloom's own centre travels inward, in visible
                     screen-widths per second. This is what "a bloom drifting
                     in" looks like; it deposits pigment along the way.
       Halving one is not the same as halving the other. Cutting only the jet
       and leaving drift alone keeps the delivery; cutting only drift leaves the
       shove. Cutting drift ALSO shortens penetration, which is the trap: at the
       old fixed 1.6 s trail life, a slower bloom simply dies near the edge and
       the visible canvas gets nothing. So sim.js no longer stores a life at
       all — it stores a REACH (how far in, in screen-widths) and derives
       life = reach / drift. Slowing the drift now buys a longer, gentler,
       equally deep arrival instead of a short one that never lands. */
    { k: 'bloomSpeed', label: 'Bloom entry force', min: 0, max: 260, step: 5, dp: 0, def: 70,
      help: 'How hard an arriving bloom shoves the wash. The old fixed value was ~205; high values read as jets punching across the frame and pushing everything outward.' },
    { k: 'bloomDrift', label: 'Bloom drift speed', min: 0.03, max: 0.5, step: 0.005, dp: 3, unit: 'w/s', def: 0.150,
      help: 'How fast a bloom travels inward, in screen-widths per second. Lower is slower and more ambient; penetration depth is held constant for you (the trail simply lasts longer).' },
    { k: 'bloomPigment', label: 'Bloom pigment', min: 0, max: 16, step: 0.1, dp: 1, def: 8.0,
      help: 'Total colour one bloom lays down over its whole trail, independent of how long that trail takes. Raise for a fuller canvas; the coverage governor still caps the level.' },

    { k: 'restoreRate', label: 'Restoration', min: 0, max: 0.08, step: 0.001, dp: 3, def: 0.030,
      help: 'How fast deficits refill toward the drifting home field.' },
    { k: 'mouseRadius', label: 'Mouse radius', min: 0.02, max: 0.25, step: 0.005, dp: 3, def: 0.045,
      help: 'Sets the visible brush footprint.' },
    { k: 'mouseStrength', label: 'Mouse strength', min: 0, max: 2, step: 0.01, dp: 2, def: 0.59,
      help: 'Scales directional force from cursor speed.' },
    { k: 'repel', label: 'Repel', min: 0, max: 1, step: 0.01, dp: 2, def: 0.24,
      help: 'Pushes pigment radially away from the cursor.' },
    { k: 'ambientDrift', label: 'Ambient drift', min: 0, max: 1, step: 0.01, dp: 2, def: 0.46,
      help: 'Adds continuous curl motion to wet pigment.' },
  ];

  /* Non-slider defaults. dyeRes 1024 is the owner's exported quality setting. */
  const OTHER = {
    palette: 'moonlit-dragon',
    startMode: 'abstract',
    preset: 'calibrated',
    dyeRes: 1024,
  };

  /* The coverage governor's contract. These are not user knobs: they are the
     structural guarantee that the canvas can never empty, whatever the sliders
     say. See sim.js `_governorTick`. */
  const GOVERNOR = {
    enabled: true,

    // The reference the thermostat holds is the seeded composition's own
    // measured mass (sim.js `_captureHome`). `refScale` multiplies it, and it
    // is the ONLY honest home for the owner's lever 1, "more pigment on the
    // canvas".
    //
    // This matters more than it looks. bloomRate and bloomPigment control
    // pigment INFLOW; the governor controls the LEVEL. Raising inflow alone
    // does not raise the level at all — it drives massRatio over `highBand`,
    // the excess branch fires, `doseScale` collapses to ~0, and every extra
    // bloom the owner asked for arrives carrying water and no colour. The
    // canvas ends up at exactly the old level with a busier delivery. So the
    // band has to move with the inflow or the governor spends the whole run
    // undoing the tuning. Applied to MASS only: `covRef` is already ~0.93 and
    // saturates at 1.0, so scaling it would manufacture a coverage deficit that
    // can never be satisfied and pin the deficit branch on forever.
    //
    // 1.05, conservatively — and READ THE SECOND PARAGRAPH before touching it,
    // because the obvious reason for this number is not the true one.
    //
    // The 5-minute idle run at 1.20 showed the canvas flattening: `sdLum` (the
    // structure measure) fell monotonically 0.096 -> 0.047 while `massRatio`
    // climbed to 1.49, i.e. the wash sat permanently above `highBand` (1.12)
    // with the governor stuck in its excess branch. The obvious diagnosis was
    // "the reference is too high"; 1.05 was measured against exactly that
    // hypothesis and REFUTED it. At 1.05 the level barely moved (mass -9%)
    // while the reference dropped 12.5%, so `massRatio` came out HIGHER
    // (1.19-1.49 against 1.09-1.44) and `sdLum` came out slightly LOWER
    // (0.079/0.079/0.068/0.057 against 0.088/0.092/0.073/0.063 at t=30/60/90/120).
    //
    // The reason is structural: in this regime the equilibrium level is not set
    // by `ref` at all. Above the band `doseScale` throttles to 0.35*(1-excess)
    // but the base `bloomRate` is deliberately never throttled (blooms are the
    // only water source — see `_governorTick`), so pigment keeps arriving at
    // roughly a fifth of a very large inflow while the only sink is slow
    // transport loss and a 0.015/s bleed. Moving `ref` moves the governor's
    // opinion, not the physics. **The lever for over-fill is pigment INFLOW
    // (`bloomPigment`, `bloomRate`) or a larger `excessBleed`, not `refScale`.**
    // 1.05 is kept because a leaner reference is the safer default over a long
    // session, not because it fixed the flattening — it did not.
    //
    // One thing that does generalise: judge any change here on `sdLum`, never
    // on coverage. Coverage and mass both scored 100% while the canvas was
    // visibly flattening; the acceptance criterion cannot see this failure.
    refScale: 1.05,

    lowBand: 0.92,        // below 92% of the reference the governor pushes inflow up
    highBand: 1.12,       // above 112% it throttles inflow toward zero
    maxBloomRate: 30,     // /min ceiling the governor may reach on its own
    maxRestoreGain: 2.5,  // multiplier it may apply to restoreRate
    // Multiplicative sink applied to ALL pigment while above the band.
    // DEFAULT OFF, deliberately. It is a far more powerful tool than it looks:
    // 0.08/s sustained removes 91% of the wash in 30 s, and because the
    // measurement is filtered, it keeps firing after the real mass has already
    // fallen. That combination emptied the canvas to 14% of reference under
    // drag abuse — the governor destroying the thing it exists to protect.
    // The ceiling on "too much paint" is `bloomScale` throttling inflow to
    // zero; natural transport loss then brings the level down on its own,
    // without a uniform evaporation that no watercolor does anyway.
    // Small, and gated on genuinely being above the band. Zero was also wrong:
    // with no sink at all the untouched canvas ratcheted to 1.9x reference and
    // abuse to 5.5x. 0.08/s was destructive (91% of the wash in 30 s, round 6);
    // an order of magnitude below that gives the level somewhere to go without
    // being able to strip the paper.
    excessBleed: 0.015,
    sampleHz: 4,          // GPU reductions + 256-byte readbacks per second
    // Damping. Inflow takes ~1.6 s to arrive (bloom transit), so a pure
    // proportional loop overshoots, bleeds the overshoot, undershoots, and the
    // canvas visibly pulses for the first minute or two. `damping` is the
    // derivative term in seconds — it backs the levers off in proportion to how
    // fast coverage is ALREADY rising. `slewTau` stops the levers themselves
    // from stepping instantaneously.
    // Under drag abuse the pointer is itself a large periodic disturbance, so
    // the loop needs more phase margin than the idle case suggests: at
    // damping 4 / slewTau 2.5 the abuse scenario ran a growing limit cycle
    // (mass 0.41 -> 0.57 -> 0.40 -> 0.76 over 90 s), which reads as the canvas
    // visibly pulsing. Authority is unchanged in kind — it just arrives slower.
    // Wetness floor. Visible mean wetness below this is treated as a deficit
    // and answered with extra (colourless) blooms, because a dry wash is a
    // still wash and a frozen backdrop breaks the contract as badly as an
    // empty one.
    wetFloor: 0.14,
    wetBoostFrac: 0.8,   // fraction of maxBloomRate the wetness lever may claim

    damping: 5.0,
    slewTau: 5.0,
  };

  /* Presets are DEPARTURES from the calibration, expressed as overrides only.
     A preset never silently supplies a value it does not name — anything it
     omits keeps the canonical default above. 'calibrated' is the identity. */
  // Re-pointed 2026-08-12. These were departures from the PREVIOUS calibration
  // and several had silently inverted against the owner's new baseline: `calm`
  // asked for drying 0.30 where the baseline is now 0.36 (so "calm" was WETTER
  // and livelier than calibrated), and `lively`/`inky` both specified a
  // bloomRate BELOW the baseline's 19.5, i.e. "lively" was quieter than normal.
  // A preset that moves the wrong way is worse than no preset. Each one now
  // names only knobs it genuinely departs from, in the direction its label
  // claims, including the new bloom* entry knobs.
  const PRESETS = {
    calibrated: { label: 'Calibrated', over: {} },
    calm:   { label: 'Calm',   over: { spread: 0.024, drying: 0.46, bloomRate: 12, bloomSpeed: 45, bloomDrift: 0.10, ambientDrift: 0.24, mouseStrength: 0.42 } },
    lively: { label: 'Lively', over: { spread: 0.055, drying: 0.26, bloomRate: 28, bloomSpeed: 110, bloomDrift: 0.22, ambientDrift: 0.62, mouseStrength: 0.72 } },
    stormy: { label: 'Stormy', over: { spread: 0.11, drying: 0.16, bloomRate: 36, bloomSpeed: 200, bloomDrift: 0.34, ambientDrift: 0.85, mouseStrength: 0.95, repel: 0.40 } },
    inky:   { label: 'Inky',   over: { spread: 0.018, drying: 0.50, bloomRate: 14, bloomPigment: 11, edgeDark: 1.50, granulation: 0.55, density: 0.85 } },
  };

  function defaults() {
    const p = {};
    Object.keys(OTHER).forEach(function (k) { p[k] = OTHER[k]; });
    CONTROLS.forEach(function (c) { p[c.k] = c.def; });
    return p;
  }

  /* Apply a preset on top of the canonical defaults. Always starts from
     `defaults()`, so switching preset A -> B can never leak A's overrides. */
  function withPreset(key) {
    const p = defaults();
    const preset = PRESETS[key] ? key : 'calibrated';
    p.preset = preset;
    const over = PRESETS[preset].over;
    Object.keys(over).forEach(function (k) { p[k] = over[k]; });
    return p;
  }

  function control(k) {
    for (let i = 0; i < CONTROLS.length; i++) if (CONTROLS[i].k === k) return CONTROLS[i];
    return null;
  }

  return {
    CONTROLS: CONTROLS,
    OTHER: OTHER,
    GOVERNOR: GOVERNOR,
    PRESETS: PRESETS,
    defaults: defaults,
    withPreset: withPreset,
    control: control,
  };
})();
