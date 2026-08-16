"use strict";
/* Collapsible tuning panel. Exposes one global: WCPanel. Classic script.
   All visual styling lives in style.css (per-property transitions,
   hover/focus-visible states, custom slider thumbs, animated grid collapse). */

const WCPanel = (function () {

  // NO slider table lives here. The panel is generated from
  // WC_SETTINGS.CONTROLS so that the range, step and default a user sees are
  // the same objects the sim boots from. A second list here is exactly how the
  // site ended up with four macro knobs while the prototype had ten calibrated
  // ones. `opts.controls` is passed in so the panel stays testable in isolation.
  const TOGGLE_SVG =
    '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">' +
    '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none">' +
    '<line x1="3" y1="5.5" x2="17" y2="5.5"/>' +
    '<line x1="3" y1="10" x2="17" y2="10"/>' +
    '<line x1="3" y1="14.5" x2="17" y2="14.5"/>' +
    '</g>' +
    '<g fill="currentColor">' +
    '<circle cx="12.5" cy="5.5" r="2.4"/>' +
    '<circle cx="6.5" cy="10" r="2.4"/>' +
    '<circle cx="10.5" cy="14.5" r="2.4"/>' +
    '</g></svg>';

  function fmt(def, v) {
    return Number(v).toFixed(def.dp) + (def.unit || '');
  }

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function create(opts) {
    const params = opts.params;

    const root = el('div', opts.startOpen ? 'wc-panel open' : 'wc-panel');

    const toggle = el('button', 'wc-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!!opts.startOpen));
    toggle.setAttribute('aria-controls', 'wc-drawer');
    toggle.setAttribute('aria-label', 'Toggle tuning panel (backtick)');
    toggle.title = 'Tuning panel (`)';
    toggle.innerHTML = TOGGLE_SVG;
    root.appendChild(toggle);

    const drawer = el('section', 'wc-drawer');
    drawer.id = 'wc-drawer';
    drawer.setAttribute('aria-label', 'Watercolor tuning');
    const inner = el('div', 'wc-drawer-inner');
    const pad = el('div', 'wc-drawer-pad');
    inner.appendChild(pad);
    drawer.appendChild(inner);
    root.appendChild(drawer);

    // header + fps
    const head = el('header', 'wc-panel-head');
    head.appendChild(el('h2', null, 'Watercolor'));
    const fpsEl = el('span', 'wc-fps', '— fps');
    head.appendChild(fpsEl);
    pad.appendChild(head);

    // Generic segmented radio group; used for start mode, preset and palette.
    function segmented(labelText, values, current, onSelect) {
      const field = el('div', 'wc-field');
      const label = el('span', 'wc-label', labelText);
      label.id = 'wc-' + labelText.toLowerCase().replace(/[^a-z]+/g, '-') + '-label';
      field.appendChild(label);
      const group = el('div', 'wc-seg');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-labelledby', label.id);
      const buttons = {};
      Object.keys(values).forEach(function (key) {
        const b = el('button', null, values[key]);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(key === current()));
        b.addEventListener('click', function () {
          onSelect(key);
          Object.keys(buttons).forEach(function (k) { buttons[k].setAttribute('aria-checked', String(k === current())); });
        });
        buttons[key] = b;
        group.appendChild(b);
      });
      field.appendChild(group);
      pad.appendChild(field);
      return buttons;
    }

    const modeValues = { abstract: 'Generative' };
    if (opts.artAvailable) modeValues.painting = 'Painting';
    const modeButtons = opts.onMode
      ? segmented('Start mode', modeValues, function () { return params.startMode; }, opts.onMode)
      : {};

    const presetLabels = {};
    const presets = opts.presets || (typeof WC_SETTINGS !== 'undefined' ? WC_SETTINGS.PRESETS : {});
    Object.keys(presets).forEach(function (k) { presetLabels[k] = presets[k].label; });
    const presetButtons = opts.onPreset
      ? segmented('Preset', presetLabels, function () { return params.preset; }, function (k) { opts.onPreset(k); })
      : {};

    // composition seed
    let seedInput = null;
    if (opts.onSeed) {
      const seedField = el('div', 'wc-field');
      const seedLabel = el('label', 'wc-label', 'Composition seed');
      seedLabel.htmlFor = 'wc-seed';
      seedInput = document.createElement('input');
      seedInput.id = 'wc-seed';
      seedInput.className = 'wc-number';
      seedInput.type = 'number';
      seedInput.min = '0';
      seedInput.max = '4294967295';
      seedInput.step = '1';
      seedInput.value = String((opts.seed || 0) >>> 0);
      seedInput.addEventListener('change', function () {
        let v = Number(seedInput.value);
        if (!Number.isFinite(v)) v = 0;
        v = Math.max(0, Math.min(4294967295, Math.floor(v))) >>> 0;
        seedInput.value = String(v);
        opts.onSeed(v);
      });
      const newSeed = el('button', 'wc-btn wc-seed-btn', 'New seed');
      newSeed.type = 'button';
      newSeed.addEventListener('click', function () {
        const v = crypto.getRandomValues(new Uint32Array(1))[0];
        seedInput.value = String(v);
        opts.onSeed(v);
      });
      seedField.appendChild(seedLabel);
      seedField.appendChild(seedInput);
      seedField.appendChild(newSeed);
      pad.appendChild(seedField);
    }

    // palette segmented control
    const palField = el('div', 'wc-field');
    const palLabel = el('span', 'wc-label', 'Palette');
    palLabel.id = 'wc-palette-label';
    palField.appendChild(palLabel);
    const seg = el('div', 'wc-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-labelledby', 'wc-palette-label');
    const segButtons = {};
    Object.keys(opts.palettes).forEach(function (key) {
      const b = el('button', null, opts.palettes[key].label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(key === params.palette));
      b.addEventListener('click', function () { selectPalette(key); });
      segButtons[key] = b;
      seg.appendChild(b);
    });
    seg.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const keys = Object.keys(segButtons);
      const i = keys.indexOf(params.palette);
      const next = keys[(i + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
      selectPalette(next);
      segButtons[next].focus();
      e.preventDefault();
    });
    palField.appendChild(seg);
    pad.appendChild(palField);

    function selectPalette(key) {
      Object.keys(segButtons).forEach(function (k) {
        segButtons[k].setAttribute('aria-checked', String(k === key));
      });
      opts.onPalette(key);
    }

    // sliders
    const sliderEls = {};
    const CONTROLS = opts.controls || WC_SETTINGS.CONTROLS;
    CONTROLS.forEach(function (def) {
      const field = el('div', 'wc-field');
      const label = el('label', 'wc-label', def.label);
      label.htmlFor = 'wc-' + def.k;
      const val = el('output', 'wc-val', fmt(def, params[def.k]));
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'wc-range';
      input.id = 'wc-' + def.k;
      input.min = def.min;
      input.max = def.max;
      input.step = def.step;
      input.value = params[def.k];
      const help = el('small', 'wc-help', def.help);
      help.id = 'wc-' + def.k + '-help';
      input.setAttribute('aria-describedby', help.id);
      input.addEventListener('input', function () {
        const v = parseFloat(input.value);
        val.textContent = fmt(def, v);
        opts.onParam(def.k, v);
      });
      field.appendChild(label);
      field.appendChild(val);
      field.appendChild(input);
      field.appendChild(help);
      pad.appendChild(field);
      sliderEls[def.k] = { input: input, val: val, def: def };
    });

    // quality select
    const qField = el('div', 'wc-field');
    const qLabel = el('label', 'wc-label', 'Quality');
    qLabel.htmlFor = 'wc-quality';
    const qSelect = document.createElement('select');
    qSelect.className = 'wc-select';
    qSelect.id = 'wc-quality';
    [512, 768, 1024].forEach(function (r) {
      const o = document.createElement('option');
      o.value = r;
      o.textContent = r + ' dye';
      qSelect.appendChild(o);
    });
    qSelect.value = params.dyeRes;
    qSelect.addEventListener('change', function () {
      opts.onQuality(parseInt(qSelect.value, 10));
    });
    qField.appendChild(qLabel);
    qField.appendChild(qSelect);
    const qHelp = el('small', 'wc-help', 'Sets the pigment-grid detail and GPU cost.');
    qHelp.id = 'wc-quality-help';
    qSelect.setAttribute('aria-describedby', qHelp.id);
    qField.appendChild(qHelp);
    pad.appendChild(qField);

    // action buttons
    const actions = el('div', 'wc-actions');
    const resetBtn = el('button', 'wc-btn', 'Reset wash');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', function () { opts.onReset(); });

    const pauseBtn = el('button', 'wc-btn', 'Pause');
    pauseBtn.type = 'button';
    pauseBtn.setAttribute('aria-pressed', 'false');
    pauseBtn.addEventListener('click', function () {
      setPaused(opts.onPause());
    });

    const copyBtn = el('button', 'wc-btn', 'Copy settings');
    copyBtn.type = 'button';
    let copyTimer = null;
    copyBtn.addEventListener('click', function () {
      const json = JSON.stringify(opts.getSettings(), null, 2);
      const done = function (ok) {
        copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(function () { copyBtn.textContent = 'Copy settings'; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(function () { done(true); }, function () { done(copyViaTextarea(json)); });
      } else {
        done(copyViaTextarea(json));
      }
    });

    actions.appendChild(resetBtn);
    actions.appendChild(pauseBtn);
    actions.appendChild(copyBtn);
    pad.appendChild(actions);

    function copyViaTextarea(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }

    function setOpen(open) {
      root.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    }
    toggle.addEventListener('click', function () {
      setOpen(!root.classList.contains('open'));
    });

    // Backtick toggles the panel from anywhere (skip real text inputs).
    window.addEventListener('keydown', function (e) {
      if (e.key !== '`' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text'))) return;
      setOpen(!root.classList.contains('open'));
      e.preventDefault();
    });

    function setPaused(paused) {
      pauseBtn.textContent = paused ? 'Resume' : 'Pause';
      pauseBtn.setAttribute('aria-pressed', String(paused));
    }

    function setFps(fps) {
      fpsEl.textContent = (fps > 0 ? Math.round(fps) : '—') + ' fps';
    }

    // Re-sync every control from params (used by __wc.setParam).
    function refresh() {
      Object.keys(sliderEls).forEach(function (k) {
        const s = sliderEls[k];
        s.input.value = params[k];
        s.val.textContent = fmt(s.def, params[k]);
      });
      Object.keys(segButtons).forEach(function (k) {
        segButtons[k].setAttribute('aria-checked', String(k === params.palette));
      });
      Object.keys(modeButtons).forEach(function (k) {
        modeButtons[k].setAttribute('aria-checked', String(k === params.startMode));
      });
      Object.keys(presetButtons).forEach(function (k) {
        presetButtons[k].setAttribute('aria-checked', String(k === params.preset));
      });
      qSelect.value = params.dyeRes;
    }

    opts.mount.appendChild(root);

    return {
      root: root,
      setFps: setFps,
      setPaused: setPaused,
      refresh: refresh,
      setOpen: setOpen,
    };
  }

  return { create: create };
})();
