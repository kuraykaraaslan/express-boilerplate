/*
 * modules/ui/TimeWindowSelect/scripts/time-window-select.js
 *
 * DOM binding for TimeWindowSelect. Requires time-window-logic.js (window.KuiTimeWindowLogic),
 * whose createTimeWindowDraft holds the state and handlers of kui-react's component; this
 * file only wires events and paints.
 *
 * Mounted by KuiTimeWindowSelect.autoInit() from `[data-kui-tws]` + `data-kui-tws-config` (JSON).
 * The panel lives in a controlled Popover (`open: false`): the trigger, an outside click and
 * Escape only ask (`kui:popover-openchange`); opening restarts the draft from the applied
 * value, closing drops it. Update applies the draft, dispatches 'kui:timewindow-change' on the
 * root `#<idPrefix>` (bubbles, detail: the value), calls the global function named by
 * `onChange`, and closes.
 *
 * Runtime API on the root element: root.__timeWindow = { getValue(), setValue(value) }
 */
(function (global) {
  'use strict';
  var L = global.KuiTimeWindowLogic;
  if (!L || global.KuiTimeWindowSelect) return;

  var CHIP_ON = ['bg-primary', 'text-primary-fg'];
  var CHIP_OFF = ['bg-surface-sunken', 'text-text-secondary', 'hover:text-text-primary'];
  var TAB_ON = ['bg-primary', 'text-primary-fg', 'shadow-sm'];
  var TAB_OFF = ['text-text-secondary', 'hover:bg-surface-overlay', 'hover:text-text-primary'];

  function swap(el, on, onCls, offCls) {
    (on ? offCls : onCls).forEach(function (c) { el.classList.remove(c); });
    (on ? onCls : offCls).forEach(function (c) { el.classList.add(c); });
  }
  function setValueIfChanged(el, v) { if (el && el.value !== v) el.value = v; }
  // A value the server did not render an option for still shows.
  function ensureOption(sel, val) {
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === val) return;
    var o = document.createElement('option'); o.value = val; o.textContent = val; sel.appendChild(o);
  }

  function mount(group) {
    var cfg;
    try { cfg = JSON.parse(group.getAttribute('data-kui-tws-config') || '{}'); } catch (e) { cfg = {}; }
    var root = document.getElementById(cfg.id);
    var trigger = document.getElementById(cfg.id + '-trigger');
    if (!root || !trigger) return;
    var m = cfg.messages || {};
    var st = L.createTimeWindowDraft({ value: cfg.value || null, presets: cfg.presets || [], calendarPeriods: cfg.calendarPeriods || [], tabs: cfg.tabs, aggregations: cfg.aggregations, maxSpanMs: cfg.maxSpanMs });
    var maxBuckets = typeof cfg.maxBuckets === 'number' ? cfg.maxBuckets : 500;

    function q(sel) { return group.querySelector(sel); }
    function qa(sel) { return group.querySelectorAll(sel); }
    var tabs = qa('[data-kui-tws-tab]');
    var panels = qa('[data-kui-tws-panel]');
    var options = qa('[data-kui-tws-option]');
    var radios = qa('[data-kui-tws-radio]');
    var presets = qa('[data-kui-tws-preset]');
    var rtAmount = q('[data-kui-tws-amount="rt"]');
    var rtUnit = q('[data-kui-tws-unit="rt"]');
    var hAmount = q('[data-kui-tws-amount="h"]');
    var hUnit = q('[data-kui-tws-unit="h"]');
    var current = q('[data-kui-tws-current]');
    var soFar = q('[data-kui-tws-so-far]');
    var range = q('[data-kui-tws-range]');
    var fromLabel = q('[data-kui-tws-from-label]');
    var toLabel = q('[data-kui-tws-to-label]');
    var from = q('[data-kui-tws-from]');
    var to = q('[data-kui-tws-to]');
    var past = q('[data-kui-tws-past]');
    var aggSel = q('[data-kui-tws-aggregation]');
    var intervalSel = q('[data-kui-tws-interval]');
    var tzSel = q('[data-kui-tws-timezone]');
    var tooLong = q('[data-kui-tws-too-long]');
    var buckets = q('[data-kui-tws-buckets]');
    var cancelBtn = q('[data-kui-tws-cancel]');
    var updateBtn = q('[data-kui-tws-update]');
    var summaryEl = trigger.querySelector('[data-kui-tws-summary]');

    function selectedKind(kind, v) {
      return kind === 'rt-last' ? v.rtKind === 'last'
        : kind === 'rt-current' ? v.rtKind === 'current'
          : kind === 'h-last' ? v.hKind === 'last'
            : kind === 'h-range' ? v.hKind === 'range'
              : v.hKind === 'period';
    }

    function paint() {
      var v = st.view();
      var i;
      for (i = 0; i < tabs.length; i++) {
        var on = tabs[i].getAttribute('data-kui-tws-tab') === v.tab;
        tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
        tabs[i].tabIndex = on ? 0 : -1;
        swap(tabs[i], on, TAB_ON, TAB_OFF);
      }
      for (i = 0; i < panels.length; i++) panels[i].hidden = panels[i].getAttribute('data-kui-tws-panel') !== v.tab;
      for (i = 0; i < options.length; i++) swap(options[i], selectedKind(options[i].getAttribute('data-kui-tws-option'), v), ['border-primary'], ['border-border']);
      for (i = 0; i < radios.length; i++) radios[i].checked = selectedKind(radios[i].getAttribute('data-kui-tws-radio'), v);
      for (i = 0; i < presets.length; i++) {
        var active = presets[i].getAttribute('data-kui-tws-preset') === v.activePreset;
        presets[i].setAttribute('aria-checked', active ? 'true' : 'false');
        swap(presets[i], active, CHIP_ON, CHIP_OFF);
      }
      setValueIfChanged(rtAmount, v.amount);
      setValueIfChanged(hAmount, v.amount);
      if (rtUnit) rtUnit.value = v.unit;
      if (hUnit) hUnit.value = v.unit;
      if (hAmount) hAmount.disabled = v.hKind !== 'last';
      if (hUnit) hUnit.disabled = v.hKind !== 'last';
      if (current) { current.value = v.currentPeriod; current.disabled = v.rtKind !== 'current'; }
      if (soFar) { soFar.checked = v.soFar; soFar.disabled = v.rtKind !== 'current'; }
      if (range) range.hidden = !v.showRange;
      var zone = v.timezone || m.browserZone;
      if (fromLabel) fromLabel.textContent = String(m.fromIn).replace('{zone}', zone);
      if (toLabel) toLabel.textContent = String(m.toIn).replace('{zone}', zone);
      if (from && to && v.showRange) {
        setValueIfChanged(from, v.from); from.max = v.to;
        setValueIfChanged(to, v.to); to.min = v.from;
      }
      if (past) { past.value = v.pastPeriod; past.disabled = v.hKind !== 'period'; }
      if (aggSel) aggSel.value = v.aggregation;
      if (intervalSel) intervalSel.value = v.interval;
      if (tzSel) { if (v.timezone) ensureOption(tzSel, v.timezone); tzSel.value = v.timezone; }
      if (tooLong) {
        tooLong.hidden = !v.tooLong;
        tooLong.textContent = v.tooLong ? String(m.tooLong).replace('{days}', String(v.maxSpanDays)) : '';
      }
      if (buckets) {
        buckets.hidden = v.bucketCount === null;
        var warn = v.bucketCount !== null && v.bucketCount > maxBuckets;
        swap(buckets, warn, ['text-warning'], ['text-text-secondary']);
        buckets.textContent = v.bucketCount === null ? '' : String(warn ? m.bucketsTooMany : m.buckets).replace('{count}', String(v.bucketCount));
      }
      if (updateBtn) updateBtn.disabled = !v.canApply;
    }

    function paintTrigger() {
      var text = L.summarize(st.state.value, m);
      if (summaryEl) summaryEl.textContent = text;
      trigger.setAttribute('aria-label', m.open + ': ' + text);
    }

    function on(el, type, fn) { if (el) el.addEventListener(type, function (e) { fn(e); paint(); }); }

    root.addEventListener('kui:popover-openchange', function (e) {
      if (e.target !== root) return;
      if (e.detail && e.detail.open) {
        st.begin();
        paint();
        global.openPopover(cfg.id);
      } else {
        global.closePopover(cfg.id);
      }
    });

    for (var t = 0; t < tabs.length; t++) {
      (function (tab) {
        var name = tab.getAttribute('data-kui-tws-tab');
        on(tab, 'click', function () { st.switchTab(name); });
        tab.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); st.otherTab(name); paint(); }
        });
      })(tabs[t]);
    }
    var SELECT = {
      'rt-last': st.selectRealtimeLast, 'rt-current': st.selectCurrent,
      'h-last': st.selectHistoryLast, 'h-range': st.selectRange, 'h-period': st.selectPast,
    };
    for (var r = 0; r < radios.length; r++) {
      (function (radio) {
        on(radio, 'change', function () { if (radio.checked) SELECT[radio.getAttribute('data-kui-tws-radio')](); });
      })(radios[r]);
    }
    for (var p = 0; p < presets.length; p++) {
      (function (btn) { on(btn, 'click', function () { st.selectPreset(btn.getAttribute('data-kui-tws-preset')); }); })(presets[p]);
    }
    on(rtAmount, 'input', function () { st.setRealtimeDuration(rtAmount.value, rtUnit.value); });
    on(rtUnit, 'change', function () { st.setRealtimeDuration(rtAmount.value, rtUnit.value); });
    on(hAmount, 'input', function () { st.setHistoryDuration(hAmount.value, hUnit.value); });
    on(hUnit, 'change', function () { st.setHistoryDuration(hAmount.value, hUnit.value); });
    on(current, 'change', function () { st.setCurrentPeriod(current.value); });
    on(soFar, 'change', function () { st.setSoFar(soFar.checked); });
    ['input', 'change'].forEach(function (type) {
      on(from, type, function () { st.setFrom(from.value); });
      on(to, type, function () { st.setTo(to.value); });
    });
    on(past, 'change', function () { st.setPastPeriod(past.value); });
    on(aggSel, 'change', function () { st.setAggregation(aggSel.value); });
    on(intervalSel, 'change', function () { st.setInterval(intervalSel.value); });
    on(tzSel, 'change', function () { st.setTimezone(tzSel.value); });

    if (cancelBtn) cancelBtn.addEventListener('click', function () { global.closePopover(cfg.id); });
    if (updateBtn) updateBtn.addEventListener('click', function () {
      var next = st.apply();
      if (!next) return;
      paintTrigger();
      root.dispatchEvent(new CustomEvent('kui:timewindow-change', { bubbles: true, detail: next }));
      if (cfg.onChange && typeof global[cfg.onChange] === 'function') global[cfg.onChange](next);
      global.closePopover(cfg.id);
    });

    root.__timeWindow = {
      getValue: function () { return st.state.value; },
      setValue: function (value) { st.setValue(value); paintTrigger(); },
    };
  }

  global.KuiTimeWindowSelect = {
    mount: mount,
    autoInit: function (scope) {
      var nodes = (scope || document).querySelectorAll('[data-kui-tws]');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].__kuiTwsMounted) continue;
        nodes[i].__kuiTwsMounted = true;
        mount(nodes[i]);
      }
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
