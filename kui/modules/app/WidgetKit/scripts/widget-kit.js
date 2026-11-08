// The browser side of a WidgetKit placement (kui-ejs). Idempotent: mounting a card twice does nothing.
//   - the card buttons: full screen, refresh (a bubbling `kui:widget-refresh` event the host page answers), CSV and Excel;
//     in full screen a picture that zooms (`scada.scene`) gets the zoom pane of scripts/zoom-pane.js (window.KuiZoomPane);
//   - the data table's viewer choices (sort, search, page, hidden columns): written into the URL under `wk.<id>.*`
//     (the sort from the kit DataTable's `kui:dt-query-change`, the rest from the widget's own search, pager and
//     column picker), which the server-rendered page reads back (viewerFromQuery) and draws again with the same model;
//   - a markdown action link (`data-wk-element`): a bubbling `kui:widget-element` event the host page answers;
//   - a reloading embed (`data-wk-reload`);
//   - the map: its layer switch shows and hides the layers (`data-wk-layer`), a click on a marker is the bubbling
//     `kui:widget-marker-click` event ({ placement, id, row, href }; not cancelled and with a `href`, the browser goes there);
//   - a pie whose slices answer a click (`data-wk-slice-rows`, the page set `host.hasSliceClick`): the chart's
//     `kui:chart-slice-click` becomes the bubbling `kui:widget-slice-click` event `{ placement, row }`, `row` being the
//     table row the slice came from (kui-react `onSliceClick(row)`);
//   - a chart that selects a range for the page (the page set `host.hasRangeSelect`): the chart's `kui:chart-range-select`
//     becomes the bubbling `kui:widget-range-select` event `{ placement, range }`, `range` being `{ from, to }` (epoch ms)
//     or null for a reset (kui-react `onRangeSelect(range)`);
//   - process symbols and diagrams (`scada.symbol`, `scada.scene`): drawn with their motion (SMIL `animate` and
//     `animateTransform`); for a viewer who prefers reduced motion the svg's clock is paused, so running parts stand
//     still, and it follows the preference if it changes;
//   - a diagram's symbols that have an action (`scada.scene` hit areas, `rect[data-element]` with `data-wk-gestures`, drawn
//     only for what the page lists in `host.elementActions`): a click, a double click, a right click and the keyboard (Enter /
//     Space = click, the context-menu key or Shift+F10 = contextMenu) are the bubbling `kui:element-gesture` event
//     `{ placement, id, gesture }`. A click waits 250 ms for a second click when the symbol also answers a double click (a
//     double click cancels it); the browser's context menu is suppressed only for a symbol that answers contextMenu;
//   - the map's route replay (`[data-wk-replay]`, scripts/map-replay.js) and draggable markers: a drop on a floor plan is the
//     bubbling `kui:widget-control` event, `{ placement, kind: 'set', value: { id, x, y } (whole pixels), respond }`;
//   - the controls: the ControlTile runtime's `kui:control-commit` becomes the bubbling `kui:widget-control` event on the card,
//     `{ placement, kind: 'run' | 'set', value (set only), confirmation, respond(promise) }`. The page's script answers it:
//     run the command, call `detail.respond(promise)` with the promise of the write (a rejection shows the control's
//     failure state and rolls the value back); without `respond` the write counts as done at once. A control is drawn
//     disabled until the page says `host.connected`;
//   - the fit box (`data-part="fit"`, kui-react FitBox): in a fixed-height cell a view whose content has a height of its own
//     (values, attributes, states, progress, controls) is decided from its real layout (settleScale): laid out at full size
//     first, content that fits keeps scale 1 (a dial or a vertical slider is never measured at its largest); content that
//     overflows is laid out as much larger at the scale its overflow asks for and lowered until nothing overflows, drawn
//     scaled down into the body (`data-scale` on the box), never under MIN_FIT_SCALE (then the body scrolls). The scaled box
//     is anchored to the box's top-left corner physically, so a right-to-left page does not push it out of the card. It
//     measures again when the box changes size, when the content changes (new data, another layout under the content box,
//     a style, class or `hidden` change inside it, such as a switch whose state the host set), and when fonts load, once
//     per animation frame (the content box's own attribute records, its style written here, are left out); it stops once
//     the box has left the page. In full screen the view is drawn at its own size, as kui-react's full-screen modal draws
//     it. `fitScale` and MIN_FIT_SCALE are ports of the vendored src/widget-kit/card-logic.ts, one to one
//     (tests/widget-kit-fit-box.test.ts compares them). Without ResizeObserver the view stays at full size.
(function (root) {
  'use strict';
  if (root.KuiWidgetKit) return;

  var KEY = 'wk';
  /** A click waits this long for a second click when the symbol also answers a double click (kui-react's DOUBLE_CLICK_MS). */
  var DOUBLE_CLICK_MS = 250;

  /** The smallest a fitted view is drawn: under it the body scrolls instead, so the text stays readable. */
  var MIN_FIT_SCALE = 0.6;

  /** The scale that fits content `needed` px tall into `available` px: 1 when it fits (or nothing is measured yet), never under MIN_FIT_SCALE. */
  function fitScale(available, needed) {
    if (!(available > 0) || !(needed > available)) return 1;
    return Math.max(MIN_FIT_SCALE, Math.floor((available / needed) * 1000) / 1000);
  }

  /**
   * The content box's style at `scale` (kui-react fitStyle): in flow at full size, or laid out as much larger and drawn
   * scaled down into the box. The scaled box is anchored to the box's top-left corner physically (absolute, `left: 0`), so
   * a right-to-left page, where a block wider than its parent overflows to the left, does not push it out of the card.
   */
  function fitStyle(scale) {
    return scale < 1
      ? { position: 'absolute', top: '0px', left: '0px', width: 100 / scale + '%', height: 100 / scale + '%', transform: 'scale(' + scale + ')', transformOrigin: '0 0' }
      : { height: '100%' };
  }

  function applyFit(content, scale) {
    var st = fitStyle(scale);
    content.style.cssText = '';
    Object.keys(st).forEach(function (k) { content.style[k] = st[k]; });
  }

  function overflows(content) { return content.scrollHeight > content.clientHeight + 1; }

  /**
   * The scale the content needs, decided from its own layout (kui-react settleScale): content that fits the box at full size
   * keeps 1 (a part that flexes, a dial or a vertical slider, is never measured at its largest); content that overflows is
   * laid out at the scale its overflow asks for and lowered until nothing overflows, at most 4 tries, never under
   * MIN_FIT_SCALE. Leaves `content` laid out at the scale it returns.
   */
  function settleScale(box, content) {
    applyFit(content, 1);
    if (!(box.clientHeight > 0) || !overflows(content)) return 1;
    var scale = fitScale(content.clientHeight, content.scrollHeight);
    for (var i = 0; i < 4; i++) {
      applyFit(content, scale);
      if (scale <= MIN_FIT_SCALE || !overflows(content)) return scale;
      scale = Math.max(MIN_FIT_SCALE, Math.floor(scale * (content.clientHeight / content.scrollHeight) * 1000) / 1000);
    }
    applyFit(content, scale);
    return scale;
  }

  /**
   * The fit box of a view whose content has a height of its own (kui-react FitBox): `box` is the `data-part="fit"` div,
   * its first child the box the view is laid out in. Where the cell grows with its content nothing overflows and the
   * scale stays 1. The box clips horizontal overflow (`overflow-x-clip`), so a scrollbar it would add to the body cannot
   * change the height the next measure sees.
   */
  function fit(card, box) {
    var content = box.firstElementChild;
    if (!content || typeof root.ResizeObserver !== 'function') return;
    var scale = 1;
    var frame = 0;
    var live = true;
    var shown = false;
    var resized = null;
    var changed = null;
    var fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    // The box was on the page and left it (the host drew the card again): nothing is measured any more (kui-react's
    // unmount). A card mounted before it is inserted waits for its box to be laid out (the ResizeObserver).
    function stop() {
      live = false;
      if (resized) resized.disconnect();
      if (changed) changed.disconnect();
      if (fonts && typeof fonts.removeEventListener === 'function') fonts.removeEventListener('loadingdone', later);
      if (frame && typeof root.cancelAnimationFrame === 'function') root.cancelAnimationFrame(frame);
      frame = 0;
    }
    function measure() {
      frame = 0;
      if (!live) return;
      if (box.isConnected === false) { if (shown) stop(); return; }
      shown = true;
      // In full screen the card is the whole screen: the view is drawn at its own size (kui-react's modal has no FitBox).
      var next = card.getAttribute('data-wk-full') === 'true' ? 1 : settleScale(box, content);
      var kept = Math.abs(scale - next) < 0.005 ? scale : next;
      applyFit(content, kept);
      scale = kept;
      if (kept < 1) box.setAttribute('data-scale', String(kept));
      else box.removeAttribute('data-scale');
    }
    function later() { if (live && !frame) frame = root.requestAnimationFrame(measure); }
    resized = new root.ResizeObserver(later);
    resized.observe(box);
    // New data, settings (a larger lamp, a font), another layout (a new child of the content box) or a state shown by
    // `hidden` (a switch the host set) can change the content without the cell changing size. The content box's own style
    // is written here, so only its attribute records are left out.
    if (typeof root.MutationObserver === 'function') {
      changed = new root.MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          if (records[i].type !== 'attributes' || records[i].target !== content) { later(); return; }
        }
      });
      changed.observe(content, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    if (fonts) {
      if (fonts.ready && typeof fonts.ready.then === 'function') fonts.ready.then(later);
      if (typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', later);
    }
    measure();
  }

  function paramName(id, k) { return KEY + '.' + id + '.' + k; }

  /** Rewrites the URL with one of this placement's viewer params changed, then loads it. */
  function go(id, changes) {
    var url = new URL(root.location.href);
    Object.keys(changes).forEach(function (k) {
      var v = changes[k];
      if (v === null || v === '') url.searchParams.delete(paramName(id, k));
      else url.searchParams.set(paramName(id, k), v);
    });
    root.location.assign(url.toString());
  }

  function current(id, k) { return new URL(root.location.href).searchParams.get(paramName(id, k)); }

  function fullscreen(card) {
    var on = card.getAttribute('data-wk-full') === 'true';
    var classes = ['fixed', 'inset-0', 'z-50', 'h-screen', 'w-screen', 'rounded-none', 'bg-surface-base'];
    classes.forEach(function (c) { card.classList.toggle(c, !on); });
    card.setAttribute('data-wk-full', on ? 'false' : 'true');
    // A picture that zooms (`data-wk-zoom` on the body, scada.scene) gets the zoom pane in full screen; leaving puts the
    // drawing back as it was (scripts/zoom-pane.js, kui-react PlacementCard + ZoomPane).
    var zoom = root.KuiZoomPane;
    if (zoom && zoom.open) { if (on) zoom.close(card); else zoom.open(card); }
    // One Escape listener per full screen, removed however the card leaves it (Escape or the button again).
    if (card.__wkEscape) { document.removeEventListener('keydown', card.__wkEscape); card.__wkEscape = null; }
    if (!on) {
      card.__wkEscape = function (e) { if (e.key === 'Escape') fullscreen(card); };
      document.addEventListener('keydown', card.__wkEscape);
    }
  }

  function exportData(card) {
    var el = card.querySelector('script[data-wk-export]');
    if (!el) return null;
    try { return JSON.parse(el.textContent || ''); } catch (e) { return null; }
  }

  function mount(card) {
    if (card.getAttribute('data-wk-mounted')) return;
    card.setAttribute('data-wk-mounted', 'true');
    var id = card.getAttribute('data-wk-id') || '';

    card.addEventListener('click', function (e) {
      var t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      var btn = t.closest('[data-wk-action]');
      if (btn && card.contains(btn)) {
        var action = btn.getAttribute('data-wk-action');
        if (action === 'fullscreen') fullscreen(card);
        else if (action === 'refresh' || action === 'retry') card.dispatchEvent(new CustomEvent('kui:widget-refresh', { bubbles: true, detail: { id: id } }));
        else if (action === 'export-csv' || action === 'export-xlsx') {
          var data = exportData(card);
          var X = root.KuiWidgetExport;
          if (!data || !X) return;
          if (action === 'export-csv') X.download(data.name + '.csv', X.toCsvText(data.rows), 'text/csv;charset=utf-8');
          else X.download(data.name + '.xlsx', X.toXlsxBytes(data.rows, data.title), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        }
        return;
      }
      // A markdown `[label](action:id)` the host answers: a bubbling `kui:widget-element` event with the id.
      var element = t.closest('[data-wk-element]');
      if (element && card.contains(element)) {
        card.dispatchEvent(new CustomEvent('kui:widget-element', { bubbles: true, detail: { id: element.getAttribute('data-wk-element'), placement: id } }));
        return;
      }
      var page = t.closest('[data-wk-page]');
      if (page && id && !page.disabled) {
        var p = Number(current(id, 'page') || 1);
        go(id, { page: String(page.getAttribute('data-wk-page') === 'next' ? p + 1 : Math.max(1, p - 1)) });
      }
    });

    // ── map ────────────────────────────────────────────────────────────────────────────────────────────────
    var mapEl = card.querySelector('[data-wk-map] [id$="-map"]');
    function layerOf(box) {
      var ctx = mapEl && mapEl.__kuiMap;
      if (ctx && ctx.setLayerVisible) ctx.setLayerVisible(box.getAttribute('data-wk-layer'), box.checked);
    }
    card.addEventListener('change', function (e) {
      var box = e.target instanceof Element ? e.target.closest('[data-wk-layer]') : null;
      if (box && card.contains(box)) layerOf(box);
    });
    // The map is built when it scrolls into view: a layer switched off before that is applied once it exists.
    card.addEventListener('kui:map-ready', function () {
      card.querySelectorAll('[data-wk-layer]').forEach(function (box) { if (!box.checked) layerOf(box); });
    });
    card.addEventListener('kui:map-marker-click', function (e) {
      var holder = card.querySelector('[data-wk-map-rows]');
      if (!holder || !e.detail) return;
      var data;
      try { data = JSON.parse(holder.getAttribute('data-wk-map-rows') || ''); } catch (err) { return; }
      var markerId = String(e.detail.id);
      var row = data.rows && data.rows[markerId];
      if (!row) return;
      var href = (data.hrefs && data.hrefs[markerId]) || null;
      var again = new CustomEvent('kui:widget-marker-click', { bubbles: true, cancelable: true, detail: { placement: id, id: markerId, row: row, href: href } });
      if (card.dispatchEvent(again) && href) root.location.assign(href);
    });

    // ── a pie's slices ─────────────────────────────────────────────────────────────────────────────────────
    card.addEventListener('kui:chart-slice-click', function (e) {
      var t = e.target instanceof Element ? e.target : null;
      var holder = t && t.closest('[data-wk-slice-rows]');
      if (!holder || !card.contains(holder) || !e.detail) return;
      // The page answers the widget's own event; the chart's low-level one stops at the card.
      e.stopPropagation();
      var rows;
      try { rows = JSON.parse(holder.getAttribute('data-wk-slice-rows') || ''); } catch (err) { return; }
      var row = Array.isArray(rows) ? rows[e.detail.index] : null;
      if (!row || typeof row !== 'object') return;
      card.dispatchEvent(new CustomEvent('kui:widget-slice-click', { bubbles: true, detail: { placement: id, row: row } }));
    });

    // ── a chart's range ────────────────────────────────────────────────────────────────────────────────────
    card.addEventListener('kui:chart-range-select', function (e) {
      if (!e.detail) return;
      e.stopPropagation();
      var r = e.detail.range;
      var range = r && typeof r.from === 'number' && typeof r.to === 'number' && r.from < r.to ? { from: r.from, to: r.to } : null;
      if (r && !range) return;
      card.dispatchEvent(new CustomEvent('kui:widget-range-select', { bubbles: true, detail: { placement: id, range: range } }));
    });

    var replay = card.querySelector('[data-wk-replay]');
    if (replay && root.KuiMapReplay && root.KuiMapReplay.mount) root.KuiMapReplay.mount(card, replay);
    // A marker the viewer moved: written back through the placement's command as ONE request (a rejection is not shown:
    // the marker stays where it was dropped, as in kui-react). Only a movable map has draggable markers.
    card.addEventListener('kui:map-marker-move', function (e) {
      var d = e.detail;
      if (!d || !d.position || d.position.length < 2) return;
      card.dispatchEvent(new CustomEvent('kui:widget-control', {
        bubbles: true,
        detail: {
          placement: id, kind: 'set', value: { id: String(d.id), x: d.position[1], y: d.position[0] }, confirmation: undefined,
          respond: function (p) { Promise.resolve(p).catch(function () {}); },
        },
      }));
    });

    // ── process symbols and diagrams ───────────────────────────────────────────────────────────────────────
    var motion = typeof root.matchMedia === 'function' ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var moving = [];
    card.querySelectorAll('figure[data-symbol] > svg, svg[role="img"]').forEach(function (svg) {
      if (typeof svg.pauseAnimations === 'function' && svg.querySelector('animate, animateTransform')) moving.push(svg);
    });
    if (motion && moving.length) {
      var still = function () {
        moving.forEach(function (svg) { if (motion.matches) svg.pauseAnimations(); else svg.unpauseAnimations(); });
      };
      still();
      if (typeof motion.addEventListener === 'function') motion.addEventListener('change', still);
    }

    // ── a diagram's symbols with actions ───────────────────────────────────────────────────────────────────
    var pending = null;
    function gesturesOf(target) {
      var hit = target instanceof Element ? target.closest('[data-element]') : null;
      if (!hit || !card.contains(hit)) return null;
      // A locked symbol (mode lockout) is named and focusable but runs nothing.
      if (hit.getAttribute('data-locked') === 'true') return null;
      var list = (hit.getAttribute('data-wk-gestures') || '').split(' ');
      return {
        id: hit.getAttribute('data-element'),
        has: function (g) { return list.indexOf(g) >= 0; },
      };
    }
    function gesture(g, elementId) {
      card.dispatchEvent(new CustomEvent('kui:element-gesture', { bubbles: true, detail: { placement: id, id: elementId, gesture: g } }));
    }
    card.addEventListener('click', function (e) {
      var h = gesturesOf(e.target);
      if (!h || !(h.has('click') || h.has('doubleClick'))) return;
      if (pending) clearTimeout(pending);
      if (h.has('doubleClick')) {
        pending = setTimeout(function () { pending = null; if (h.has('click')) gesture('click', h.id); }, DOUBLE_CLICK_MS);
      } else {
        pending = null;
        gesture('click', h.id);
      }
    });
    card.addEventListener('dblclick', function (e) {
      var h = gesturesOf(e.target);
      if (!h || !h.has('doubleClick')) return;
      if (pending) { clearTimeout(pending); pending = null; }
      gesture('doubleClick', h.id);
    });
    card.addEventListener('contextmenu', function (e) {
      var h = gesturesOf(e.target);
      if (!h || !h.has('contextMenu')) return;
      e.preventDefault();
      gesture('contextMenu', h.id);
    });
    card.addEventListener('keydown', function (e) {
      var h = gesturesOf(e.target);
      if (!h) return;
      if ((e.key === 'Enter' || e.key === ' ') && h.has('click')) { e.preventDefault(); gesture('click', h.id); }
      else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && h.has('contextMenu')) { e.preventDefault(); gesture('contextMenu', h.id); }
    });

    // ── controls ───────────────────────────────────────────────────────────────────────────────────────────
    card.addEventListener('kui:control-commit', function (e) {
      var d = e.detail;
      if (!d) return;
      // The page answers the widget's own event; the tile's low-level one stops at the card.
      e.stopPropagation();
      var run = d.kind === 'button';
      var detail = { placement: id, kind: run ? 'run' : 'set', confirmation: d.confirmation, respond: d.respond };
      if (!run) detail.value = d.value;
      card.dispatchEvent(new CustomEvent('kui:widget-control', { bubbles: true, detail: detail }));
    });

    // The table drawn by the kit DataTable (manual mode, kui-react DataTableView): a header sort is its query
    // (`kui:dt-query-change` { query }) and becomes the `wk.<id>.sort` param (back to page 1); the page draws the table
    // again. The sort the page drew is on the widget (`data-wk-query`, JSON { sort: 'key:dir' | '' }); only a change
    // from it navigates, so the table's first report (the drawn query) does nothing.
    var holder = card.querySelector('[data-wk-query]');
    if (holder) {
      var drawnSort = '';
      try { drawnSort = String(JSON.parse(holder.getAttribute('data-wk-query') || '{}').sort || ''); } catch (err) { drawnSort = ''; }
      holder.addEventListener('kui:dt-query-change', function (e) {
        var q = e.detail && e.detail.query;
        if (!q || !id) return;
        var first = Array.isArray(q.sort) ? q.sort[0] : null;
        var next = first && first.key ? first.key + ':' + first.dir : '';
        if (next === drawnSort) return;
        drawnSort = next;
        go(id, { sort: next || 'none', page: null });
      });
    }

    var search = card.querySelector('[data-wk-search]');
    if (search && id) {
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); go(id, { q: search.value.trim(), page: null }); }
      });
    }
    card.querySelectorAll('[data-wk-column]').forEach(function (box) {
      box.addEventListener('change', function () {
        if (!id) return;
        var hidden = [];
        card.querySelectorAll('[data-wk-column]').forEach(function (b) { if (!b.checked) hidden.push(b.getAttribute('data-wk-column')); });
        go(id, { hide: hidden.join(',') });
      });
    });

    var reload = card.querySelector('[data-wk-reload]');
    if (reload) {
      var every = Number(reload.getAttribute('data-wk-reload')) * 1000;
      var frame = reload.querySelector('iframe');
      if (frame && every > 0) setInterval(function () { frame.src = frame.src; }, every);
    }

    // ── the fit box ────────────────────────────────────────────────────────────────────────────────────────
    card.querySelectorAll('[data-part="fit"]').forEach(function (box) { fit(card, box); });
  }

  root.KuiWidgetKit = {
    MIN_FIT_SCALE: MIN_FIT_SCALE,
    fitScale: fitScale,
    fitStyle: fitStyle,
    settleScale: settleScale,
    mount: mount,
    autoInit: function () { document.querySelectorAll('[data-wk-card]').forEach(mount); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
