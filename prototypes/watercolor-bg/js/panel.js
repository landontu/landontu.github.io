"use strict";
/* Collapsible tuning panel. Exposes one global: WCPanel. Classic script.
   All visual styling lives in style.css (per-property transitions,
   hover/focus-visible states, custom slider thumbs, animated grid collapse). */

const WCPanel = (function () {

  const SLIDERS = [
    { k: 'spread', label: 'Spread', min: 0, max: 0.25, step: 0.002, dp: 3, help: 'Wet pigment diffuses outward faster.' },
    { k: 'drying', label: 'Drying', min: 0, max: 1, step: 0.01, dp: 2, help: 'Water evaporates faster, stopping flow sooner.' },
    { k: 'edgeDark', label: 'Edge darkening', min: 0, max: 1.5, step: 0.01, dp: 2, help: 'Deepens optical pigment at dry wash rims.' },
    { k: 'granulation', label: 'Granulation', min: 0, max: 1, step: 0.01, dp: 2, help: 'Settles visible pigment into the paper tooth.' },
    { k: 'density', label: 'Pigment density', min: 0.3, max: 2.5, step: 0.01, dp: 2, help: 'Changes glaze opacity without changing pigment mass.' },
    { k: 'bloomRate', label: 'Bloom rate', min: 0, max: 20, step: 0.5, dp: 1, unit: '/min', help: 'Adds random water-then-pigment blooms each minute.' },
    { k: 'mouseRadius', label: 'Mouse radius', min: 0.02, max: 0.25, step: 0.005, dp: 3, help: 'Sets the visible brush footprint.' },
    { k: 'mouseStrength', label: 'Mouse strength', min: 0, max: 2, step: 0.01, dp: 2, help: 'Scales directional force from cursor speed.' },
    { k: 'repel', label: 'Repel', min: 0, max: 1, step: 0.01, dp: 2, help: 'Pushes pigment radially away from the cursor.' },
    { k: 'ambientDrift', label: 'Ambient drift', min: 0, max: 1, step: 0.01, dp: 2, help: 'Adds continuous curl motion to wet pigment.' },
  ];

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
    SLIDERS.forEach(function (def) {
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
