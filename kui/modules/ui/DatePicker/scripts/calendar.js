// modules/ui/DatePicker/scripts/calendar.js
//
// Vanilla-JS calendar popover used by DatePicker and DateRangePicker EJS
// templates. Mirrors the NextJS Calendar.tsx 1:1 in terms of tokens,
// FontAwesome icons (fa-chevron-left/right, fa-calendar, fa-xmark), grid
// layout and keyboard map.
//
// Initialisation flow:
//   1) `_calendar.ejs` partial renders the trigger + hidden popover shell
//      with `data-kui-datepicker-root`, `data-locale`, `data-mode`
//      (single|range), and `data-value` attributes.
//   2) This script scans the DOM on DOMContentLoaded and re-scans whenever
//      `KUI_DATEPICKER.init(root)` is called explicitly.
//   3) Locale data comes from `window.KUI_DATEPICKER_LOCALE.{tr,en}` — set
//      by `locale-en.js` / `locale-tr.js` which must load BEFORE this file.
//
// TODO M2: range visuals + preset column.
// TODO M3: input-mask + locale-aware typing.
// TODO M4: time strip / timezone.
// TODO M5: bottom-sheet on touch devices.

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // -----------------------------------------------------------------------
  // Date helpers (mirror of NextJS hooks/useDateFns.ts).
  // -----------------------------------------------------------------------
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0); }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function addMonths(d, n) {
    var y = d.getFullYear();
    var m = d.getMonth();
    var day = d.getDate();
    var t = new Date(y, m + n, 1);
    var max = daysInMonth(t.getFullYear(), t.getMonth());
    t.setDate(Math.min(day, max));
    return t;
  }
  function addYears(d, n) { return addMonths(d, n * 12); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function isSameDay(a, b) {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function isSameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }
  function isBefore(a, b) { return startOfDay(a).getTime() < startOfDay(b).getTime(); }
  function isAfter(a, b)  { return startOfDay(a).getTime() > startOfDay(b).getTime(); }
  function clampToBounds(d, min, max) {
    if (min && isBefore(d, min)) return startOfDay(min);
    if (max && isAfter(d, max))  return startOfDay(max);
    return d;
  }
  function isWithinBounds(d, min, max) {
    if (min && isBefore(d, min)) return false;
    if (max && isAfter(d, max))  return false;
    return true;
  }
  function isDisabled(d, disabledDates, min, max) {
    if (!isWithinBounds(d, min, max)) return true;
    if (!disabledDates) return false;
    if (typeof disabledDates === 'function') return disabledDates(d);
    for (var i = 0; i < disabledDates.length; i++) if (isSameDay(disabledDates[i], d)) return true;
    return false;
  }
  function buildMonthGrid(year, month, weekStartsOn) {
    var first = new Date(year, month, 1);
    var firstDow = first.getDay();
    var leading = (firstDow - weekStartsOn + 7) % 7;
    var gridStart = new Date(year, month, 1 - leading);
    var out = [];
    for (var i = 0; i < 42; i++) out.push(addDays(gridStart, i));
    return out;
  }
  function formatDate(d, fmt) {
    if (!d || isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return fmt.replace(/YYYY|YY|MM|M|DD|D/g, function (tok) {
      switch (tok) {
        case 'YYYY': return String(y);
        case 'YY':   return String(y).slice(-2);
        case 'MM':   return pad2(m);
        case 'M':    return String(m);
        case 'DD':   return pad2(day);
        case 'D':    return String(day);
      }
      return tok;
    });
  }
  function fromIso(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) {
      var fallback = new Date(s);
      return isNaN(fallback.getTime()) ? null : startOfDay(fallback);
    }
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  function toIso(d) {
    if (!d) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // Expose helpers globally so keyboard.js (and tests) can reuse them.
  window.KUI_DATEPICKER_HELPERS = {
    startOfDay: startOfDay,
    startOfMonth: startOfMonth,
    addMonths: addMonths,
    addYears: addYears,
    addDays: addDays,
    isSameDay: isSameDay,
    isSameMonth: isSameMonth,
    isBefore: isBefore,
    isAfter: isAfter,
    clampToBounds: clampToBounds,
    isWithinBounds: isWithinBounds,
    isDisabled: isDisabled,
    buildMonthGrid: buildMonthGrid,
    formatDate: formatDate,
    fromIso: fromIso,
    toIso: toIso
  };

  // -----------------------------------------------------------------------
  // Per-instance state.
  // -----------------------------------------------------------------------
  function resolveLocale(code) {
    var bag = window.KUI_DATEPICKER_LOCALE || {};
    return bag[code] || bag.tr || bag.en;
  }

  function makeButton(opts) {
    var btn = document.createElement('button');
    btn.type = 'button';
    if (opts.className) btn.className = opts.className;
    if (opts.ariaLabel) btn.setAttribute('aria-label', opts.ariaLabel);
    if (opts.html != null) btn.innerHTML = opts.html;
    if (opts.text != null) btn.textContent = opts.text;
    if (opts.disabled) btn.disabled = true;
    return btn;
  }

  function tokenClass(d, ctx) {
    var cls = ['relative', 'inline-flex', 'items-center', 'justify-center', 'rounded-md', 'text-sm', 'transition-colors', 'h-8', 'w-8',
      'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-border-focus'];
    if (!ctx.inMonth) cls.push('text-text-disabled');
    if (ctx.disabled) cls.push('opacity-40', 'cursor-not-allowed');
    if (ctx.selected || ctx.rangeStart || ctx.rangeEnd) {
      cls.push('bg-primary', 'text-primary-fg', 'hover:bg-primary-hover');
    } else if (ctx.inMonth && !ctx.disabled) {
      cls.push('text-text-primary', 'hover:bg-surface-overlay');
    }
    if (ctx.today && !ctx.selected && !ctx.rangeStart && !ctx.rangeEnd) {
      cls.push('ring-1', 'ring-inset', 'ring-primary');
    }
    return cls.join(' ');
  }

  // -----------------------------------------------------------------------
  // Calendar instance (single month).
  // -----------------------------------------------------------------------
  function createCalendar(opts) {
    // opts: { locale, month, selected, rangeStart, rangeEnd, min, max,
    //         disabledDates, hidePrev, hideNext, onSelect, onMonthChange }
    var state = {
      view: 'days',
      month: startOfMonth(opts.month || new Date()),
      focus: clampToBounds(opts.selected || opts.month || new Date(), opts.min, opts.max)
    };

    var root = document.createElement('div');
    root.className = 'select-none w-[15.5rem]';

    function render() {
      root.innerHTML = '';
      var locale = opts.locale;

      // Header --------------------------------------------------------------
      var header = document.createElement('div');
      header.className = 'flex items-center justify-between px-2 pt-2 pb-1';

      var prev = makeButton({
        ariaLabel: locale.messages.prevMonth,
        className: 'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        html: '<i class="fa-solid fa-chevron-left h-3.5 w-3.5" aria-hidden="true"></i>'
      });
      if (opts.hidePrev) prev.style.visibility = 'hidden';
      prev.addEventListener('click', function () {
        state.month = addMonths(state.month, -1);
        if (opts.onMonthChange) opts.onMonthChange(state.month);
        render();
      });

      var caption = document.createElement('div');
      caption.className = 'flex items-center gap-1 text-sm font-medium text-text-primary';
      // As in kui-react, the month / year button of the open quick picker keeps a tinted background.
      var monthBtn = makeButton({
        className: 'rounded-md px-2 py-1 hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus' + (state.view === 'months' ? ' bg-surface-overlay' : ''),
        text: locale.months[state.month.getMonth()]
      });
      monthBtn.setAttribute('aria-haspopup', 'listbox');
      monthBtn.setAttribute('aria-expanded', String(state.view === 'months'));
      monthBtn.addEventListener('click', function () {
        state.view = state.view === 'months' ? 'days' : 'months';
        render();
      });
      var yearBtn = makeButton({
        className: 'rounded-md px-2 py-1 hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus' + (state.view === 'years' ? ' bg-surface-overlay' : ''),
        text: String(state.month.getFullYear())
      });
      yearBtn.setAttribute('aria-haspopup', 'listbox');
      yearBtn.setAttribute('aria-expanded', String(state.view === 'years'));
      yearBtn.addEventListener('click', function () {
        state.view = state.view === 'years' ? 'days' : 'years';
        render();
      });
      caption.appendChild(monthBtn);
      caption.appendChild(yearBtn);

      var next = makeButton({
        ariaLabel: locale.messages.nextMonth,
        className: 'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        html: '<i class="fa-solid fa-chevron-right h-3.5 w-3.5" aria-hidden="true"></i>'
      });
      if (opts.hideNext) next.style.visibility = 'hidden';
      next.addEventListener('click', function () {
        state.month = addMonths(state.month, 1);
        if (opts.onMonthChange) opts.onMonthChange(state.month);
        render();
      });

      header.appendChild(prev);
      header.appendChild(caption);
      header.appendChild(next);
      root.appendChild(header);

      if (state.view === 'months') {
        var months = document.createElement('div');
        months.className = 'grid grid-cols-3 gap-1.5 p-2';
        months.setAttribute('role', 'listbox');
        months.setAttribute('aria-label', 'Month');
        for (var mi = 0; mi < 12; mi++) {
          (function (m) {
            var b = makeButton({
              className: (m === state.month.getMonth()
                ? 'rounded-md px-2 py-1.5 text-sm transition-colors bg-primary text-primary-fg '
                : 'rounded-md px-2 py-1.5 text-sm transition-colors text-text-primary hover:bg-surface-overlay ')
                + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              text: locale.monthsShort[m]
            });
            b.setAttribute('role', 'option');
            b.setAttribute('aria-selected', String(m === state.month.getMonth()));
            b.addEventListener('click', function () {
              state.month = new Date(state.month.getFullYear(), m, 1);
              if (opts.onMonthChange) opts.onMonthChange(state.month);
              state.view = 'days';
              render();
            });
            months.appendChild(b);
          })(mi);
        }
        root.appendChild(months);
        return;
      }

      if (state.view === 'years') {
        var years = document.createElement('div');
        years.className = 'max-h-56 overflow-y-auto p-2';
        years.setAttribute('role', 'listbox');
        years.setAttribute('aria-label', 'Year');
        var activeYear = null;
        var grid = document.createElement('div');
        grid.className = 'grid grid-cols-3 gap-1.5';
        for (var dy = -10; dy <= 10; dy++) {
          (function (yy) {
            var disabledY =
              (opts.min && yy < opts.min.getFullYear()) ||
              (opts.max && yy > opts.max.getFullYear());
            var b = makeButton({
              className: (yy === state.month.getFullYear()
                ? 'rounded-md px-2 py-1.5 text-sm transition-colors bg-primary text-primary-fg '
                : 'rounded-md px-2 py-1.5 text-sm transition-colors text-text-primary hover:bg-surface-overlay ')
                + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-40 disabled:cursor-not-allowed',
              text: String(yy),
              disabled: !!disabledY
            });
            b.setAttribute('role', 'option');
            b.setAttribute('aria-selected', String(yy === state.month.getFullYear()));
            if (yy === state.month.getFullYear()) activeYear = b;
            b.addEventListener('click', function () {
              state.month = new Date(yy, state.month.getMonth(), 1);
              if (opts.onMonthChange) opts.onMonthChange(state.month);
              state.view = 'days';
              render();
            });
            grid.appendChild(b);
          })(state.month.getFullYear() + dy);
        }
        years.appendChild(grid);
        root.appendChild(years);
        // kui-react's YearSelect centres the current year when it opens.
        if (activeYear && activeYear.isConnected) activeYear.scrollIntoView({ block: 'center' });
        return;
      }

      // Days view ----------------------------------------------------------
      var gridWrap = document.createElement('div');
      gridWrap.className = 'px-2 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-border-focus rounded-md';
      gridWrap.setAttribute('role', 'grid');
      gridWrap.setAttribute('aria-label', locale.messages.dialogLabel);
      gridWrap.tabIndex = 0;

      var wdRow = document.createElement('div');
      wdRow.className = 'grid grid-cols-7 gap-0.5';
      wdRow.setAttribute('role', 'row');
      for (var w = 0; w < 7; w++) {
        var head = document.createElement('div');
        head.setAttribute('role', 'columnheader');
        head.className = 'py-1 text-center text-[11px] font-medium uppercase tracking-wide text-text-secondary';
        head.textContent = locale.weekdaysShort[(w + locale.weekStartsOn) % 7];
        wdRow.appendChild(head);
      }
      gridWrap.appendChild(wdRow);

      var dayGrid = document.createElement('div');
      dayGrid.className = 'mt-1 grid grid-cols-7 gap-0.5';
      var cells = buildMonthGrid(state.month.getFullYear(), state.month.getMonth(), locale.weekStartsOn);
      var today = startOfDay(new Date());
      cells.forEach(function (d) {
        var ctx = {
          inMonth: isSameMonth(d, state.month),
          disabled: isDisabled(d, opts.disabledDates, opts.min, opts.max),
          selected: isSameDay(d, opts.selected),
          rangeStart: isSameDay(d, opts.rangeStart),
          rangeEnd: isSameDay(d, opts.rangeEnd),
          today: isSameDay(d, today)
        };
        var b = makeButton({
          className: tokenClass(d, ctx),
          text: String(d.getDate()),
          disabled: ctx.disabled
        });
        b.setAttribute('role', 'gridcell');
        b.setAttribute('aria-selected', String(!!(ctx.selected || ctx.rangeStart || ctx.rangeEnd)));
        b.setAttribute('aria-disabled', String(ctx.disabled));
        b.tabIndex = (ctx.inMonth && isSameDay(d, state.focus)) ? 0 : -1;
        b.addEventListener('click', function () {
          if (ctx.disabled) return;
          state.focus = d;
          if (opts.onSelect) opts.onSelect(d);
        });
        dayGrid.appendChild(b);
      });
      gridWrap.appendChild(dayGrid);

      gridWrap.addEventListener('keydown', function (ev) {
        var KB = window.KUI_DATEPICKER_KEYBOARD;
        if (!KB) return;
        var r = KB.applyKey(state.focus, ev, {
          weekStartsOn: locale.weekStartsOn,
          min: opts.min, max: opts.max,
          disabledDates: opts.disabledDates
        });
        if (!r) return;
        state.focus = r.focus;
        if (r.monthChanged) {
          state.month = startOfMonth(r.focus);
          if (opts.onMonthChange) opts.onMonthChange(state.month);
        }
        if (r.shouldSelect && opts.onSelect) opts.onSelect(r.focus);
        if (r.shouldClose && opts.onClose) opts.onClose();
        render();
      });

      var todayWrap = document.createElement('div');
      todayWrap.className = 'mt-2 flex items-center justify-end px-1';
      var todayBtn = makeButton({
        className: 'rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        text: locale.messages.today
      });
      todayBtn.addEventListener('click', function () {
        var target = clampToBounds(today, opts.min, opts.max);
        if (!isWithinBounds(target, opts.min, opts.max)) return;
        state.month = startOfMonth(target);
        state.focus = target;
        if (opts.onMonthChange) opts.onMonthChange(state.month);
        if (!isDisabled(target, opts.disabledDates, opts.min, opts.max) && opts.onSelect) opts.onSelect(target);
        render();
      });
      todayWrap.appendChild(todayBtn);
      gridWrap.appendChild(todayWrap);

      root.appendChild(gridWrap);
    }

    render();
    return {
      el: root,
      update: function (patch) {
        if (patch.selected !== undefined) opts.selected = patch.selected;
        if (patch.rangeStart !== undefined) opts.rangeStart = patch.rangeStart;
        if (patch.rangeEnd !== undefined) opts.rangeEnd = patch.rangeEnd;
        if (patch.month) state.month = startOfMonth(patch.month);
        render();
      },
      setMonth: function (m) { state.month = startOfMonth(m); render(); }
    };
  }

  // -----------------------------------------------------------------------
  // Wire a root element rendered by the EJS partial.
  // -----------------------------------------------------------------------
  function init(root) {
    if (!root || root.dataset.kuiDatepickerInit === '1') return;
    root.dataset.kuiDatepickerInit = '1';

    var localeCode = root.getAttribute('data-locale') || 'tr';
    var locale = resolveLocale(localeCode);
    if (!locale) return;
    var mode = root.getAttribute('data-mode') || 'single'; // single | range
    var format = root.getAttribute('data-format') || locale.displayFormat;
    var min = fromIso(root.getAttribute('data-min'));
    var max = fromIso(root.getAttribute('data-max'));

    var trigger    = root.querySelector('[data-kui-trigger]');
    var displayEl  = root.querySelector('[data-kui-display]');
    var clearBtn   = root.querySelector('[data-kui-clear]');
    var popover    = root.querySelector('[data-kui-popover]');
    var hiddenA    = root.querySelector('[data-kui-input="start"]') || root.querySelector('[data-kui-input]');
    var hiddenB    = root.querySelector('[data-kui-input="end"]');
    // kui-react shows the clear button only while there is a value and the picker is enabled.
    var clearOff   = !!(clearBtn && clearBtn.hasAttribute('data-kui-clear-disabled'));

    function readValue() {
      if (mode === 'range') {
        return {
          start: fromIso(hiddenA ? hiddenA.value : null),
          end:   fromIso(hiddenB ? hiddenB.value : null)
        };
      }
      return fromIso(hiddenA ? hiddenA.value : null);
    }

    function writeValue(v) {
      if (mode === 'range') {
        if (hiddenA) hiddenA.value = toIso(v.start);
        if (hiddenB) hiddenB.value = toIso(v.end);
        var sStr = v.start ? formatDate(v.start, format) : locale.messages.placeholder;
        var eStr = v.end   ? formatDate(v.end,   format) : locale.messages.placeholder;
        if (displayEl) {
          if (!v.start && !v.end) {
            displayEl.textContent = sStr + '  →  ' + eStr;
            displayEl.classList.add('text-text-disabled');
          } else {
            displayEl.textContent = sStr + '  →  ' + eStr;
            displayEl.classList.remove('text-text-disabled');
          }
        }
        if (clearBtn) clearBtn.style.display = (v.start || v.end) && !clearOff ? '' : 'none';
      } else {
        if (hiddenA) hiddenA.value = toIso(v);
        if (displayEl) {
          if (v) {
            displayEl.textContent = formatDate(v, format);
            displayEl.classList.remove('text-text-disabled');
          } else {
            displayEl.textContent = locale.messages.placeholder;
            displayEl.classList.add('text-text-disabled');
          }
        }
        if (clearBtn) clearBtn.style.display = v && !clearOff ? '' : 'none';
      }
    }

    function isoValue() {
      if (mode === 'range') {
        return { start: hiddenA && hiddenA.value ? hiddenA.value : null, end: hiddenB && hiddenB.value ? hiddenB.value : null };
      }
      return hiddenA && hiddenA.value ? hiddenA.value : null;
    }
    // A user's pick: 'kui:datepicker-change' on the root (bubbles, detail { value } as getValue gives it).
    function changed() {
      root.dispatchEvent(new CustomEvent('kui:datepicker-change', { bubbles: true, detail: { value: isoValue() } }));
    }
    var calendars = { left: null, right: null, single: null };
    function asDate(v) {
      if (!v) return null;
      return v instanceof Date ? startOfDay(v) : fromIso(String(v));
    }

    function open() {
      if (!popover) return;
      popover.classList.remove('hidden');
      trigger && trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onDocKey);
    }
    function close() {
      if (!popover) return;
      popover.classList.add('hidden');
      trigger && trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onDocKey);
    }
    function onDocClick(e) {
      if (!root.contains(e.target)) close();
    }
    function onDocKey(e) { if (e.key === 'Escape') close(); }

    // Build the calendar(s) inside the popover.
    if (popover) {
      popover.innerHTML = '';
      // mt-2: in kui-react the popover is a sibling of the trigger inside the picker's `space-y-1`
      // root, so it sits the trigger's 4px bottom margin plus its own mt-1 below the trigger. Here it
      // shares a wrapper with the trigger instead, so the full 8px is its own margin.
      popover.className = popover.className + ' absolute z-30 mt-2 rounded-lg border border-border bg-surface-raised shadow-lg p-1 hidden';

      if (mode === 'range') {
        var current = readValue();
        var startMonth = startOfMonth(current.start || clampToBounds(new Date(), min, max));
        var leftCal, rightCal;
        function onSelect(d) {
          var cur = readValue();
          var day = startOfDay(d);
          if (!cur.start || (cur.start && cur.end)) {
            writeValue({ start: day, end: null });
          } else if (isBefore(day, cur.start)) {
            writeValue({ start: day, end: null });
          } else {
            writeValue({ start: cur.start, end: day });
            close();
          }
          changed();
          var n = readValue();
          leftCal && leftCal.update({ selected: n.start, rangeStart: n.start, rangeEnd: n.end });
          rightCal && rightCal.update({ selected: n.end, rangeStart: n.start, rangeEnd: n.end });
        }
        leftCal = createCalendar({
          locale: locale, month: startMonth,
          selected: current.start, rangeStart: current.start, rangeEnd: current.end,
          min: min, max: max,
          hideNext: true,
          onSelect: onSelect,
          onMonthChange: function (m) { rightCal && rightCal.setMonth(addMonths(m, 1)); },
          onClose: close
        });
        rightCal = createCalendar({
          locale: locale, month: addMonths(startMonth, 1),
          selected: current.end, rangeStart: current.start, rangeEnd: current.end,
          min: min, max: max,
          hidePrev: true,
          onSelect: onSelect,
          onMonthChange: function (m) { leftCal && leftCal.setMonth(addMonths(m, -1)); },
          onClose: close
        });
        calendars.left = leftCal;
        calendars.right = rightCal;
        var holder = document.createElement('div');
        holder.className = 'flex';
        holder.appendChild(leftCal.el);
        holder.appendChild(rightCal.el);
        popover.appendChild(holder);
      } else {
        var v = readValue();
        var cal = createCalendar({
          locale: locale,
          month: startOfMonth(v || clampToBounds(new Date(), min, max)),
          selected: v,
          min: min, max: max,
          onSelect: function (d) { writeValue(d); close(); changed(); },
          onClose: close
        });
        calendars.single = cal;
        popover.appendChild(cal.el);
      }
    }

    if (trigger) {
      trigger.addEventListener('click', function () {
        if (popover && popover.classList.contains('hidden')) open();
        else close();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (mode === 'range') writeValue({ start: null, end: null });
        else writeValue(null);
        changed();
      });
    }

    // Paint initial display.
    writeValue(readValue());

    // Read and set the value from outside (kui-react DatePicker is controlled through value / onChange):
    // root.kuiDatePicker.getValue() gives ISO text ('YYYY-MM-DD' or null; range: { start, end });
    // .setValue(v) takes the same (or Dates) and fires no change event.
    root.kuiDatePicker = {
      getValue: function () { return isoValue(); },
      setValue: function (v) {
        if (mode === 'range') {
          var r = v || {};
          writeValue({ start: asDate(r.start), end: asDate(r.end) });
          var n = readValue();
          if (calendars.left) calendars.left.update({ selected: n.start, rangeStart: n.start, rangeEnd: n.end, month: n.start || undefined });
          if (calendars.right) calendars.right.update({ selected: n.end, rangeStart: n.start, rangeEnd: n.end, month: n.start ? addMonths(startOfMonth(n.start), 1) : undefined });
        } else {
          writeValue(asDate(v));
          var d = readValue();
          if (calendars.single) calendars.single.update({ selected: d, month: d || undefined });
        }
      }
    };
  }

  function autoInit() {
    var roots = document.querySelectorAll('[data-kui-datepicker-root]');
    for (var i = 0; i < roots.length; i++) init(roots[i]);
  }

  window.KUI_DATEPICKER = { init: init, autoInit: autoInit };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();
