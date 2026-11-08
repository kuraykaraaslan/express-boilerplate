/*
 * modules/ui/TraceWaterfall/scripts/trace-waterfall.js
 *
 * Behaviour of TraceWaterfall (kui-react modules/ui/TraceWaterfall/index.tsx): expand and collapse, selection and
 * the detail region, the keyboard of the WAI-ARIA tree pattern (arrows, Home / End, PageUp / PageDown, Enter /
 * Space, Escape, `*`), the critical-path switch, "Expand all" / "Collapse all" and, above `virtualizeThreshold`
 * rows, the windowing. Needs trace-model.js (window.KuiTraceModel) first.
 *
 * The server draws the rows for the state at render time and holds the other rows in <template data-tw-rows> and
 * the span details in <template data-tw-details>; this file only moves those elements around and changes their
 * attributes, it writes no markup of its own besides the detail region's frame and the two spacers.
 *
 * Idempotent: window.KuiTraceWaterfall.autoInit() mounts every [data-tw-root] once. Events on the root (bubble):
 *   kui:trace-select             { id, name }   a span was selected, or cleared (id null)
 *   kui:trace-collapsed-change   { ids }        the collapsed span ids after a click or key
 * A root with data-tw-select-controlled / data-tw-collapse-controlled only emits the event; the host applies the
 * state with KuiTraceWaterfall.select(root, id) / KuiTraceWaterfall.setCollapsed(root, ids).
 */
(function (global) {
  'use strict';
  if (global.KuiTraceWaterfall) return;
  var Model = global.KuiTraceModel;
  var Fmt = global.KuiObsFormat;

  var ACTIVE = ['outline-2', '-outline-offset-2', 'outline-border-focus'];
  var SWITCH_ON = ['border-warning', 'bg-warning-subtle', 'text-warning-fg'];
  var SWITCH_OFF = ['border-border', 'bg-surface-base', 'text-text-primary'];

  function toggleClasses(el, names, on) {
    names.forEach(function (c) { if (on) el.classList.add(c); else el.classList.remove(c); });
  }
  function attrSel(v) { return String(v).replace(/(["\\])/g, '\\$1'); }

  function mount(root) {
    var cfg;
    try { cfg = JSON.parse(root.getAttribute('data-tw-config') || '{}'); } catch (e) { cfg = {}; }
    var msgs = cfg.messages || {};
    var tree = root.querySelector('[data-tw-tree]');
    var body = root.querySelector('[data-tw-body]');
    if (!tree || !body) return;
    var rowHeight = cfg.rowHeight || 28;
    var headerH = cfg.headerH || 28;
    var selectControlled = root.hasAttribute('data-tw-select-controlled');
    var collapseControlled = root.hasAttribute('data-tw-collapse-controlled');
    var rowsTpl = root.querySelector('template[data-tw-rows]');
    var detailsTpl = root.querySelector('template[data-tw-details]');
    var sw = root.querySelector('[data-tw-critical-switch]');

    // ── The rows, in depth-first order of the whole tree ───────────────────────────────────────────
    var els = Array.prototype.slice.call(body.querySelectorAll('[role="treeitem"]'));
    if (rowsTpl) els = els.concat(Array.prototype.slice.call(rowsTpl.content.querySelectorAll('[role="treeitem"]')));
    var items = els.map(function (el) {
      return {
        el: el, id: el.getAttribute('data-span-id'), i: Number(el.getAttribute('data-tw-i')),
        depth: Number(el.getAttribute('aria-level')) - 1, hasKids: el.hasAttribute('aria-expanded'),
        name: el.getAttribute('data-tw-name') || '', label: el.getAttribute('data-tw-label') || '',
        critical: el.hasAttribute('data-tw-critical'), error: el.hasAttribute('data-error'), parent: null
      };
    }).sort(function (a, b) { return a.i - b.i; });
    var byId = {};
    var stack = [];
    items.forEach(function (it) {
      byId[it.id] = it;
      while (stack.length && stack[stack.length - 1].depth >= it.depth) stack.pop();
      it.parent = stack.length ? stack[stack.length - 1] : null;
      stack.push(it);
    });

    // ── State ──────────────────────────────────────────────────────────────────────────────────────
    var state = {
      collapsed: (cfg.collapsed || []).slice(), selected: cfg.selected != null ? cfg.selected : null,
      active: cfg.active != null ? cfg.active : null, criticalOn: cfg.criticalOn !== false
    };
    var vis = [];
    var drawn = { start: -1, end: -1, key: '' };
    var raf = null;

    // The tree can never be taller than its max-height, and its own height follows its content (it is short right
    // after a collapse), so the window is sized for the max-height: a few extra rows are drawn, never too few.
    function viewport() { return cfg.maxHeight || tree.clientHeight || 400; }
    function emit(name, detail) { root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail })); }
    function isCollapsed(id) { return state.collapsed.indexOf(id) !== -1; }
    function visibleItems() {
      var out = [];
      var skip = -1;
      items.forEach(function (it) {
        if (skip >= 0 && it.depth > skip) return;
        skip = -1;
        out.push(it);
        if (it.hasKids && isCollapsed(it.id)) skip = it.depth;
      });
      return out;
    }
    function activeIndex() {
      var want = state.active != null ? state.active : state.selected;
      for (var i = 0; i < vis.length; i++) if (vis[i].id === want) return i;
      return vis.length ? 0 : -1;
    }

    // Row attributes that depend on the state (what kui-react recomputes on each render).
    function paint(it, isActive) {
      var el = it.el;
      var selected = state.selected === it.id;
      el.setAttribute('aria-selected', selected ? 'true' : 'false');
      toggleClasses(el, ['bg-primary-subtle'], selected);
      toggleClasses(el, ['hover:bg-surface-overlay'], !selected);
      toggleClasses(el, ACTIVE, isActive);
      if (it.hasKids) {
        var collapsed = isCollapsed(it.id);
        el.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        var btn = el.querySelector('[data-tw-toggle]');
        if (btn) {
          btn.setAttribute('aria-label', (collapsed ? msgs.expand : msgs.collapse).split('{name}').join(it.name));
          var icon = btn.querySelector('i');
          if (icon) {
            toggleClasses(icon, ['rotate-90', 'rtl:-rotate-90'], !collapsed);
            toggleClasses(icon, ['rtl:rotate-180'], collapsed);
          }
        }
      }
      var crit = state.criticalOn && it.critical;
      if (crit) el.setAttribute('data-critical', 'true'); else el.removeAttribute('data-critical');
      el.setAttribute('aria-label', it.label + (crit ? ', ' + msgs.onCriticalPath : ''));
      if (el.children[0]) toggleClasses(el.children[0], ['border-s-2', 'border-warning'], crit);
      var bar = el.children[1] && el.children[1].firstElementChild;
      // An error bar keeps its own ring: kui-react's class merge lets the error ring win over the critical one.
      if (bar && !it.error) toggleClasses(bar, ['ring-2', 'ring-warning'], crit);
    }

    function spacer(px) {
      var d = document.createElement('div');
      d.setAttribute('aria-hidden', 'true');
      d.style.height = px + 'px';
      return d;
    }

    function render(force) {
      vis = visibleItems();
      var windowed = vis.length > (cfg.threshold == null ? 500 : cfg.threshold);
      var w = windowed
        ? Model.windowFor(vis.length, rowHeight, tree.scrollTop, viewport(), headerH, 8)
        : { start: 0, end: vis.length };
      var ai = activeIndex();
      var key = vis.map(function (it) { return it.id; }).join('\u0000') + '|' + ai + '|' + state.selected + '|' + state.criticalOn + '|' + state.collapsed.join('\u0001');
      if (!force && w.start === drawn.start && w.end === drawn.end && key === drawn.key) return;
      drawn = { start: w.start, end: w.end, key: key };
      // The grid lines are the first child of the body; everything after them is rows and spacers.
      while (body.children.length > 1) body.removeChild(body.lastChild);
      var frag = document.createDocumentFragment();
      if (windowed && w.start > 0) frag.appendChild(spacer(w.start * rowHeight));
      for (var i = w.start; i < w.end; i++) { paint(vis[i], i === ai); frag.appendChild(vis[i].el); }
      if (windowed && vis.length > w.end) frag.appendChild(spacer((vis.length - w.end) * rowHeight));
      body.appendChild(frag);
      if (ai >= 0) tree.setAttribute('aria-activedescendant', vis[ai].el.id); else tree.removeAttribute('aria-activedescendant');
    }

    // ── The detail region ──────────────────────────────────────────────────────────────────────────
    var shownDetail = state.selected;
    function updateDetail() {
      if (!cfg.showDetail) return;
      var section = root.querySelector('[data-tw-detail]');
      var it = state.selected != null ? byId[state.selected] : null;
      if (!it) {
        if (section) section.parentNode.removeChild(section);
        shownDetail = null;
        return;
      }
      if (section && shownDetail === state.selected) return;
      if (!section) {
        section = document.createElement('section');
        section.setAttribute('role', 'region');
        section.setAttribute('aria-label', msgs.details || '');
        section.className = cfg.detailClass || '';
        section.setAttribute('data-tw-detail', '');
        tree.parentNode.insertBefore(section, tree.nextSibling);
      }
      while (section.firstChild) section.removeChild(section.firstChild);
      var src = detailsTpl ? detailsTpl.content.querySelector('[data-tw-for="' + attrSel(it.id) + '"]') : null;
      if (src) Array.prototype.forEach.call(src.childNodes, function (n) { section.appendChild(n.cloneNode(true)); });
      shownDetail = state.selected;
    }

    // ── Actions ────────────────────────────────────────────────────────────────────────────────────
    function setCollapsed(next, fromHost) {
      if (!fromHost) emit('kui:trace-collapsed-change', { ids: next.slice() });
      if (collapseControlled && !fromHost) return;
      state.collapsed = next.slice();
      render(true);
    }
    function select(id, fromHost) {
      if (!fromHost) emit('kui:trace-select', { id: id, name: id != null && byId[id] ? byId[id].name : null });
      if (selectControlled && !fromHost) { render(true); return; }
      state.selected = id;
      render(true);
      updateDetail();
    }
    function toggle(it) {
      if (!it.hasKids) return;
      setCollapsed(isCollapsed(it.id) ? state.collapsed.filter(function (x) { return x !== it.id; }) : state.collapsed.concat([it.id]));
    }
    function scrollToIndex(i) {
      var rowTop = i * rowHeight + headerH;
      var rowBottom = (i + 1) * rowHeight + headerH;
      var h = tree.clientHeight || 400;
      var viewTop = tree.scrollTop + headerH;
      var viewBottom = tree.scrollTop + h;
      if (rowTop < viewTop) tree.scrollTop = Math.max(0, rowTop - headerH);
      else if (rowBottom > viewBottom) tree.scrollTop = rowBottom - h;
    }
    function move(index) {
      var i = Math.min(Math.max(index, 0), vis.length - 1);
      if (!vis[i]) return;
      state.active = vis[i].id;
      scrollToIndex(i);
      render(true);
    }
    function setCritical(on) {
      state.criticalOn = on;
      if (sw) {
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
        toggleClasses(sw, SWITCH_ON, on);
        toggleClasses(sw, SWITCH_OFF, !on);
      }
      render(true);
    }

    // ── Events ─────────────────────────────────────────────────────────────────────────────────────
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t || !root.contains(t)) return;
      if (t.closest('[data-tw-expand-all]')) { setCollapsed([]); return; }
      if (t.closest('[data-tw-collapse-all]')) {
        setCollapsed(items.filter(function (it) { return it.hasKids; }).map(function (it) { return it.id; }));
        return;
      }
      if (t.closest('[data-tw-critical-switch]')) { setCritical(!state.criticalOn); return; }
      if (t.closest('[data-tw-clear]')) { select(null); return; }
      var row = t.closest('[role="treeitem"]');
      if (!row || !tree.contains(row)) return;
      var it = byId[row.getAttribute('data-span-id')];
      if (!it) return;
      if (t.closest('[data-tw-toggle]')) { toggle(it); return; }
      state.active = it.id;
      select(state.selected === it.id ? null : it.id);
    });

    tree.addEventListener('keydown', function (e) {
      if (!vis.length || e.altKey || e.ctrlKey || e.metaKey) return;
      var ai = activeIndex();
      var row = vis[ai];
      if (!row) return;
      var rtl = global.getComputedStyle(tree).direction === 'rtl';
      var open = rtl ? 'ArrowLeft' : 'ArrowRight';
      var close = rtl ? 'ArrowRight' : 'ArrowLeft';
      var page = Math.max(1, Math.floor(((tree.clientHeight || 400) - headerH) / rowHeight) - 1);
      var key = e.key;
      if (key === 'ArrowDown') move(ai + 1);
      else if (key === 'ArrowUp') move(ai - 1);
      else if (key === 'PageDown') move(ai + page);
      else if (key === 'PageUp') move(ai - page);
      else if (key === 'Home') move(0);
      else if (key === 'End') move(vis.length - 1);
      else if (key === open) {
        if (row.hasKids && isCollapsed(row.id)) toggle(row);
        else if (row.hasKids) move(ai + 1);
        else return;
      } else if (key === close) {
        if (row.hasKids && !isCollapsed(row.id)) toggle(row);
        else if (row.parent) { var pi = vis.indexOf(row.parent); if (pi >= 0) move(pi); }
        else return;
      } else if (key === 'Enter' || key === ' ') select(state.selected === row.id ? null : row.id);
      else if (key === 'Escape') { if (state.selected) select(null); else return; }
      else if (key === '*') {
        var sibs = items.filter(function (it) { return it.parent === row.parent; }).map(function (it) { return it.id; });
        setCollapsed(state.collapsed.filter(function (x) { return sibs.indexOf(x) === -1; }));
      } else return;
      e.preventDefault();
    });

    tree.addEventListener('scroll', function () {
      if (vis.length <= (cfg.threshold == null ? 500 : cfg.threshold) || raf !== null) return;
      raf = global.requestAnimationFrame(function () { raf = null; render(false); });
    }, { passive: true });

    // ── The time track: the ruler and the duration labels fit its measured width (kui-react measures it too) ──
    var rulerEl = root.querySelector('[data-tw-ruler]');
    var gridEl = root.querySelector('[data-tw-grid]');
    var trackW = 0;
    function pctOf(t) { return cfg.duration > 0 ? (t / cfg.duration) * 100 : 0; }
    function fitTrack() {
      if (!rulerEl || !gridEl || !Fmt || !Model.rulerLabels) return;
      var w = Math.max(0, Math.floor(rulerEl.getBoundingClientRect().width));
      if (w === trackW) return;
      trackW = w;
      var ruler = Model.rulerLabels(cfg.duration, w, Fmt.formatDurationMs);
      var labels = '';
      var lines = '';
      ruler.forEach(function (r) {
        var p = pctOf(r.t);
        if (r.side) {
          labels += '<span class="absolute top-0 whitespace-nowrap leading-7" style="' +
            (r.side === 'after' ? 'inset-inline-start: ' + p + '%; padding-inline-start: 4px' : 'inset-inline-end: ' + (100 - p) + '%; padding-inline-end: 4px') +
            '">' + Fmt.escapeHtml(r.text) + '</span>';
        }
        lines += '<span class="absolute inset-y-0 border-s border-border" style="inset-inline-start: ' + p + '%"></span>';
      });
      rulerEl.innerHTML = labels;
      gridEl.innerHTML = lines;
      items.forEach(function (it) {
        var span = it.el.querySelector('[data-tw-box]');
        if (!span) return;
        var b = span.getAttribute('data-tw-box').split(' ').map(Number);
        var after = Model.durationLabelSide({ left: b[0], width: b[1] }, span.textContent, w) === 'after';
        span.setAttribute('style', after ? 'inset-inline-start: calc(' + (b[0] + b[1]) + '% + 4px)' : 'inset-inline-end: calc(' + (100 - b[0]) + '% + 4px)');
      });
    }

    render(true);
    updateDetail();
    fitTrack();
    if (rulerEl && typeof ResizeObserver !== 'undefined') new ResizeObserver(fitTrack).observe(rulerEl);
    root.__kuiTrace = {
      select: function (id) { select(id, true); },
      setCollapsed: function (ids) { setCollapsed(ids, true); }
    };
  }

  function autoInit(scope) {
    var nodes = (scope || document).querySelectorAll('[data-tw-root]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__kuiTwMounted) continue;
      nodes[i].__kuiTwMounted = true;
      mount(nodes[i]);
    }
  }

  global.KuiTraceWaterfall = {
    autoInit: autoInit, mount: mount,
    select: function (root, id) { if (root.__kuiTrace) root.__kuiTrace.select(id); },
    setCollapsed: function (root, ids) { if (root.__kuiTrace) root.__kuiTrace.setCollapsed(ids); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
