// modules/ui/ColorPicker/scripts/color-state.js
//
// Per-instance ColorPicker controller. Loaded once per page (idempotent) and
// then invoked by the partial init script with the instance id.
//
// Mirrors hooks/useColorState.ts + parts/InputRow.tsx behaviour in the
// NextJS sibling.

(function () {
  if (window.KuiColorPickerCore) return;
  var Convert = window.KuiColorConvert;
  if (!Convert) return; // color-convert.js must be inlined first

  function attach(rootSelector, opts) {
    var root = typeof rootSelector === 'string'
      ? document.querySelector(rootSelector)
      : rootSelector;
    if (!root) return null;
    var id = opts.id;
    var onChangeFn = opts.onChangeFn || '';
    var defaultFormat = opts.defaultFormat || 'hex';

    var btn   = root.querySelector('#' + id);
    var pop   = root.querySelector('[data-cp-popover]');
    var swEl  = root.querySelector('[data-cp-swatch]');
    var bar   = root.querySelector('[data-cp-bar]');
    var label = root.querySelector('[data-cp-label]');
    var hex   = root.querySelector('[data-cp-hex]');
    var nat   = root.querySelector('[data-cp-native]');
    var hidden= root.querySelector('[data-cp-input]');
    var noneBtn = root.querySelector('[data-cp-none]');
    var fmtRow  = root.querySelector('[data-cp-fmt]');
    var fmtInput = root.querySelector('[data-cp-fmt-input]');
    var copyBtn  = root.querySelector('[data-cp-copy]');
    if (!btn || !pop) return null;

    var current = (hidden && hidden.value) || (hex && hex.value) || '';
    var rgba = Convert.parseColor(current) || { r: 0, g: 0, b: 0, a: 1 };
    var format = defaultFormat;

    function paintSwatch(v) {
      if (bar) bar.style.background = v || 'transparent';
      if (swEl) {
        if (v) {
          swEl.style.background = v;
          swEl.style.backgroundImage = '';
          swEl.style.backgroundSize = '';
          swEl.style.backgroundPosition = '';
        } else {
          swEl.style.background = 'transparent';
          swEl.style.backgroundImage = 'linear-gradient(45deg, var(--surface-sunken) 25%, transparent 25%, transparent 75%, var(--surface-sunken) 75%), linear-gradient(45deg, var(--surface-sunken) 25%, transparent 25%, transparent 75%, var(--surface-sunken) 75%)';
          swEl.style.backgroundSize = '8px 8px';
          swEl.style.backgroundPosition = '0 0, 4px 4px';
        }
      }
      if (label) label.textContent = v || 'none';
      Array.prototype.forEach.call(root.querySelectorAll('[data-cp-color]'), function (el) {
        if (v && el.getAttribute('data-cp-color').toLowerCase() === v.toLowerCase()) {
          el.classList.add('ring-2', 'ring-border-focus');
        } else {
          el.classList.remove('ring-2', 'ring-border-focus');
        }
      });
    }

    function syncFormatInput() {
      if (!fmtInput) return;
      fmtInput.value = current ? Convert.formatAs(rgba, format) : '';
    }

    function open()  { pop.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); }
    function close() { pop.classList.add('hidden');    btn.setAttribute('aria-expanded', 'false'); }
    function toggle(){ pop.classList.contains('hidden') ? open() : close(); }

    function commit(v) {
      current = v || '';
      if (current) {
        var parsed = Convert.parseColor(current);
        if (parsed) rgba = parsed;
      }
      paintSwatch(current);
      syncFormatInput();
      if (hidden) hidden.value = current;
      if (hex) hex.value = current;
      if (nat && current) {
        var native = Convert.normalizeHex(current);
        if (!native) native = Convert.rgbaToHex({ r: rgba.r, g: rgba.g, b: rgba.b, a: 1 }).slice(0, 7);
        nat.value = native;
      }
      try {
        root.dispatchEvent(new CustomEvent('kui-colorpicker:change', {
          bubbles: true,
          detail: { value: current || null, format: format, id: id },
        }));
      } catch (e) {}
      if (onChangeFn && typeof window[onChangeFn] === 'function') {
        try { window[onChangeFn](current || null, id); } catch (e) {}
      }
    }

    function setFormat(next) {
      format = next;
      Array.prototype.forEach.call(root.querySelectorAll('[data-cp-fmt-btn]'), function (el) {
        var active = el.getAttribute('data-cp-fmt-btn') === next;
        el.setAttribute('aria-selected', active ? 'true' : 'false');
        if (active) {
          el.classList.add('bg-primary', 'text-primary-fg');
          el.classList.remove('text-text-secondary', 'hover:bg-surface-overlay');
        } else {
          el.classList.remove('bg-primary', 'text-primary-fg');
          el.classList.add('text-text-secondary', 'hover:bg-surface-overlay');
        }
      });
      if (current) {
        // Re-emit the same color in the new representation.
        commit(Convert.formatAs(rgba, format));
      } else {
        syncFormatInput();
      }
    }

    btn.addEventListener('click', toggle);

    Array.prototype.forEach.call(root.querySelectorAll('[data-cp-color]'), function (el) {
      el.addEventListener('click', function () {
        commit(el.getAttribute('data-cp-color'));
        close();
      });
    });

    if (hex) {
      hex.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var n = Convert.normalizeHex(hex.value);
          if (n) { commit(n); close(); }
        }
      });
      hex.addEventListener('blur', function () {
        var n = Convert.normalizeHex(hex.value);
        if (n) commit(n);
      });
    }
    if (nat) {
      nat.addEventListener('input', function () { commit(nat.value); });
    }
    if (noneBtn) {
      noneBtn.addEventListener('click', function () { commit(''); close(); });
    }

    if (fmtRow) {
      Array.prototype.forEach.call(fmtRow.querySelectorAll('[data-cp-fmt-btn]'), function (el) {
        el.addEventListener('click', function () {
          setFormat(el.getAttribute('data-cp-fmt-btn'));
        });
      });
    }
    if (fmtInput) {
      function commitFmt() {
        var parsed = Convert.parseColor(fmtInput.value);
        if (parsed) {
          rgba = parsed;
          commit(Convert.formatAs(rgba, format));
        } else {
          syncFormatInput();
        }
      }
      fmtInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitFmt();
        }
      });
      fmtInput.addEventListener('blur', commitFmt);
    }
    if (copyBtn) {
      var copyTimer = null;
      copyBtn.addEventListener('click', function () {
        var text = Convert.formatAs(rgba, format);
        function flash() {
          var iconUse = copyBtn.querySelector('[data-cp-copy-icon]');
          if (iconUse) {
            iconUse.classList.remove('fa-copy');
            iconUse.classList.add('fa-check');
          }
          if (copyTimer) clearTimeout(copyTimer);
          copyTimer = setTimeout(function () {
            if (iconUse) {
              iconUse.classList.remove('fa-check');
              iconUse.classList.add('fa-copy');
            }
          }, 1200);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(flash, function () {});
        } else {
          flash();
        }
      });
    }

    // outside click + esc
    document.addEventListener('mousedown', function (e) {
      if (pop.classList.contains('hidden')) return;
      if (!root.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !pop.classList.contains('hidden')) close();
    });

    // Initial paint
    paintSwatch(current);
    setFormat(format);

    var api = {
      get: function () { return current || null; },
      set: function (v) { commit(v || ''); },
      open: open,
      close: close,
      setFormat: setFormat,
    };

    window.KuiColorPicker = window.KuiColorPicker || { _byId: {}, get: function (i) { return this._byId[i] || null; } };
    window.KuiColorPicker._byId[id] = api;
    return api;
  }

  window.KuiColorPickerCore = { attach: attach };
})();
