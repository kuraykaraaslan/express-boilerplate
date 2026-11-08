/*
 * modules/ui/LocaleSwitcher/scripts/locale-switcher.js
 *
 * Behaviour of LocaleSwitcher. The server draws everything and the menu (a native <details>) works without this
 * file; this adds what kui-react's component does in code:
 *   - choosing an option fires the bubbling, cancelable event 'kui:locale-change' { code, option, originalEvent }
 *     on the option (React's onChange); preventDefault() on it stops a link from navigating; the menu then closes
 *   - Escape closes the menu and returns focus to the trigger; an outside press or focus leaving closes it
 *   - ArrowDown / ArrowUp / Home / End move between the options
 *
 * Idempotent: window.KuiLocaleSwitcher guards a second load. All listeners are delegated on the document, so
 * switchers added later work without a new init. Hooks: [data-ls-root] (with data-ls-options, a JSON array of the
 * options) and [data-locale] on each option.
 */
(function (global) {
  'use strict';
  if (global.KuiLocaleSwitcher) return;

  function rootOf(el) { return el && el.closest ? el.closest('[data-ls-root]') : null; }

  function optionOf(root, code) {
    var list = [];
    try { list = JSON.parse(root.getAttribute('data-ls-options') || '[]'); } catch (e) { list = []; }
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
    return null;
  }

  function close(root) {
    var d = root.querySelector('details');
    if (d && d.open) d.open = false;
  }

  document.addEventListener('click', function (e) {
    var opt = e.target && e.target.closest ? e.target.closest('[data-locale]') : null;
    var root = rootOf(opt);
    if (!opt || !root) return;
    var code = opt.getAttribute('data-locale');
    var ev = new CustomEvent('kui:locale-change', { bubbles: true, cancelable: true, detail: { code: code, option: optionOf(root, code), originalEvent: e } });
    if (!opt.dispatchEvent(ev)) e.preventDefault();
    close(root);
  });

  document.addEventListener('keydown', function (e) {
    var root = rootOf(e.target);
    if (!root) return;
    var d = root.querySelector('details');
    if (d && !d.open) return;
    var items = Array.prototype.slice.call(root.querySelectorAll('[data-locale]'));
    var i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      close(root);
      var s = root.querySelector('summary');
      if (s) s.focus();
      e.preventDefault();
      return;
    }
    var target;
    if (e.key === 'ArrowDown') target = items[Math.min(items.length - 1, i + 1)];
    else if (e.key === 'ArrowUp') target = items[Math.max(0, i - 1)];
    else if (e.key === 'Home') target = items[0];
    else if (e.key === 'End') target = items[items.length - 1];
    else return;
    if (target) target.focus();
    e.preventDefault();
  });

  function outside(e) {
    var open = document.querySelectorAll('[data-ls-root] details[open]');
    for (var i = 0; i < open.length; i++) {
      var root = rootOf(open[i]);
      if (root && !(e.target instanceof Node && root.contains(e.target))) close(root);
    }
  }
  document.addEventListener('mousedown', outside);
  document.addEventListener('touchstart', outside);
  document.addEventListener('focusin', outside);

  global.KuiLocaleSwitcher = { close: close };
})(window);
