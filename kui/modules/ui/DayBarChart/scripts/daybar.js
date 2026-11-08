/*
 * modules/ui/DayBarChart/scripts/daybar.js
 *
 * Behaviour of DayBarChart. The server draws the strip, the heading, the summary, the range, the legend and the
 * popover of an initially pinned day; this file adds, as kui-react's component does in code:
 *   - a tooltip on hover and on focus (role="tooltip"), a pinned details popover on click or Enter
 *     (role="dialog", with a close button and the incident links), Escape to release the pin
 *   - a roving tabindex with ArrowLeft / ArrowRight (mirrored in right-to-left pages), Home and End
 *   - the event 'kui:daybar-select' { day, date, popover } on the root (bubbles): React's onSelect. `day` is
 *     { date, availability, incidents } or null when the pin is released; `popover` is the dialog element (or
 *     null), for a page that wants to append to it (React's renderDetails)
 *   - root.kuiDayBarChart.select(date | null): pin from the page. A chart drawn with `selectedDate` is controlled:
 *     a click fires the event and the page decides, by calling select()
 *
 * The popover is built from the root's data-dbc-config (every date and figure already formatted by the server),
 * with the classes of DayBarChart.ejs. Idempotent: window.KuiDayBarChart.autoInit() mounts every [data-dbc-root]
 * once. Hooks: [data-dbc-root], [data-dbc-config], [data-dbc-pop].
 */
(function (global) {
  'use strict';
  if (global.KuiDayBarChart) return;

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) n.setAttribute(k, attrs[k]);
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function icon(cls) { return el('i', { 'class': cls, 'aria-hidden': 'true' }); }
  function clamp(i, n) { return Math.min(Math.max(i, 0), Math.max(0, n - 1)); }

  var POP_CLASS = 'absolute top-full z-20 mt-2 w-64 max-w-[90vw] rounded-md border border-border bg-surface-raised p-3 text-sm shadow-lg';
  var CLOSE_CLASS = '-m-1 flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';
  var LINK_CLASS = 'text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';

  /** The popover of day `d` (config entry); `pinned` makes it the dialog with a close button and links. */
  function buildPopover(cfg, d, i, pinned) {
    var n = cfg.days.length;
    var pct = n > 1 ? (i / (n - 1)) * 100 : 50;
    var listed = pinned ? d.incidents : d.incidents.slice(0, 3);
    var kids = [];
    var head = [el('p', { 'class': 'font-semibold text-text-primary' }, [d.dateText])];
    if (pinned) {
      var close = el('button', { type: 'button', 'aria-label': cfg.messages.close, 'class': CLOSE_CLASS }, [icon('fa-solid fa-xmark h-3 w-3')]);
      head.push(close);
    }
    kids.push(el('div', { 'class': 'flex items-start justify-between gap-2' }, head));
    kids.push(el('p', { 'class': 'text-text-secondary' }, [d.availText + ' · ' + d.statusText]));
    if (listed.length) {
      kids.push(el('ul', { 'class': 'flex flex-col gap-1' }, listed.map(function (inc) {
        var title = inc.href && pinned ? el('a', { href: inc.href, 'class': LINK_CLASS }, [inc.title]) : document.createTextNode(inc.title);
        var inner = [title];
        if (inc.severityText) inner.push(el('span', { 'class': 'ms-1 text-xs text-text-secondary' }, ['(' + inc.severityText + ')']));
        return el('li', { 'class': 'flex items-start gap-1.5' }, [icon('fa-solid fa-triangle-exclamation mt-1 h-3 w-3 shrink-0 text-warning'), el('span', { 'class': 'min-w-0' }, inner)]);
      })));
    }
    if (!pinned && d.incidents.length > listed.length) kids.push(el('p', { 'class': 'text-xs text-text-secondary' }, [d.more]));
    var attrs = {
      id: cfg.popId,
      role: pinned ? 'dialog' : 'tooltip',
      'aria-label': pinned ? cfg.messages.details : null,
      'class': POP_CLASS,
      'data-dbc-pop': '',
      style: 'inset-inline-start: ' + pct + '%; transform: translateX(-' + pct + '%)'
    };
    return el('div', attrs, [el('div', { 'class': 'flex flex-col gap-1.5' }, kids)]);
  }

  function mount(root) {
    if (root.kuiDayBarChart) return;
    var cfg;
    try { cfg = JSON.parse(root.getAttribute('data-dbc-config') || '{}'); } catch (e) { cfg = {}; }
    cfg.days = cfg.days || [];
    var strip = root.querySelector('[role="group"]');
    if (!strip) return;
    var wrap = strip.parentNode;
    var buttons = Array.prototype.slice.call(strip.querySelectorAll('button[data-day]'));
    var n = buttons.length;
    var state = { focusIdx: Math.max(0, n - 1), hoverIdx: null, pinned: cfg.pinned || null, focused: false, shownKey: null };

    function indexOfDate(date) {
      for (var i = 0; i < cfg.days.length; i++) if (cfg.days[i].date === date) return i;
      return -1;
    }
    function pinnedIdx() { return state.pinned ? indexOfDate(state.pinned) : -1; }
    function active() { return clamp(state.focusIdx, n); }

    function render() {
      var pIdx = pinnedIdx();
      var a = active();
      var shown = pIdx >= 0 ? pIdx : state.hoverIdx != null ? state.hoverIdx : (state.focused ? a : null);
      buttons.forEach(function (b, i) {
        b.setAttribute('tabindex', i === a ? '0' : '-1');
        if (shown === i) b.setAttribute('aria-describedby', cfg.popId); else b.removeAttribute('aria-describedby');
        if (pIdx === i) b.setAttribute('aria-expanded', 'true'); else b.removeAttribute('aria-expanded');
        var bar = b.querySelector('span[aria-hidden="true"]:last-child');
        if (bar) { bar.classList.toggle('ring-2', pIdx === i); bar.classList.toggle('ring-primary', pIdx === i); }
      });
      var key = shown === null ? '' : shown + (pIdx >= 0 ? ':pinned' : ':tip');
      var current = root.querySelector('[data-dbc-pop]');
      if (key !== state.shownKey || (key && !current)) {
        if (current) current.parentNode.removeChild(current);
        if (shown !== null) wrap.appendChild(buildPopover(cfg, cfg.days[shown], shown, pIdx >= 0));
        state.shownKey = key;
      }
    }
    // The first render must not rebuild the server-drawn popover: only record its key.
    (function () { var p = pinnedIdx(); state.shownKey = p >= 0 ? p + ':pinned' : ''; })();

    function emit(idx) {
      var d = idx === null || idx < 0 ? null : cfg.days[idx];
      var day = d ? { date: d.date, availability: d.availability, incidents: d.incidents } : null;
      root.dispatchEvent(new CustomEvent('kui:daybar-select', { bubbles: true, detail: { day: day, date: d ? d.date : null, popover: root.querySelector('[data-dbc-pop][role="dialog"]') } }));
    }
    function pin(idx) {
      var d = idx === null || idx < 0 ? null : cfg.days[idx];
      if (!cfg.controlled) { state.pinned = d ? d.date : null; render(); }
      emit(idx);
    }
    function move(idx) {
      state.focusIdx = clamp(idx, n);
      render();
      if (buttons[state.focusIdx]) buttons[state.focusIdx].focus();
    }

    strip.addEventListener('keydown', function (e) {
      var rtl = global.getComputedStyle(strip).direction === 'rtl';
      var next = rtl ? 'ArrowLeft' : 'ArrowRight';
      var prev = rtl ? 'ArrowRight' : 'ArrowLeft';
      var a = active();
      if (e.key === next) move(a + 1);
      else if (e.key === prev) move(a - 1);
      else if (e.key === 'Home') move(0);
      else if (e.key === 'End') move(n - 1);
      else if (e.key === 'Escape' && pinnedIdx() >= 0) pin(null);
      else return;
      e.preventDefault();
    });
    strip.addEventListener('focusin', function (e) {
      state.focused = true;
      var i = buttons.indexOf(e.target);
      if (i !== -1) state.focusIdx = i;
      render();
    });
    strip.addEventListener('focusout', function (e) {
      if (!e.relatedTarget || !strip.contains(e.relatedTarget)) { state.focused = false; render(); }
    });
    strip.addEventListener('mouseover', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-day]') : null;
      var i = b ? buttons.indexOf(b) : -1;
      if (i !== -1 && i !== state.hoverIdx) { state.hoverIdx = i; render(); }
    });
    wrap.addEventListener('mouseleave', function () { state.hoverIdx = null; render(); });
    strip.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-day]') : null;
      var i = b ? buttons.indexOf(b) : -1;
      if (i === -1) return;
      state.focusIdx = i;
      pin(pinnedIdx() === i ? null : i);
    });
    root.addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('[data-dbc-pop] button[aria-label]') : null;
      if (!c || !wrap.contains(c)) return;
      var shown = pinnedIdx();
      pin(null);
      move(shown >= 0 ? shown : 0);
    });

    root.kuiDayBarChart = {
      select: function (date) {
        var i = date == null ? -1 : indexOfDate(date);
        state.pinned = i >= 0 ? cfg.days[i].date : null;
        render();
      }
    };
    render();
  }

  function autoInit() {
    var roots = document.querySelectorAll('[data-dbc-root]');
    for (var i = 0; i < roots.length; i++) mount(roots[i]);
  }

  global.KuiDayBarChart = { autoInit: autoInit, mount: mount, buildPopover: buildPopover };
})(window);
