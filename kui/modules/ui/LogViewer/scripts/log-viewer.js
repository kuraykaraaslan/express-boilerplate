/*
 * modules/ui/LogViewer/scripts/log-viewer.js
 *
 * Behaviour of LogViewer (kui-react modules/ui/LogViewer/index.tsx): search (filter or highlight with match
 * stepping), severity and field facet chips, the wrap toggle, selection with the context buttons, copy, the follow
 * mode of a live tail (pauses when the user scrolls up, counts new lines, resumes at the bottom), the keyboard of the
 * listbox, the row window, and the producer side of React's useLogStream (KuiLogViewer.push). Needs format.js,
 * log-model.js and log-view.js (window.KuiObsFormat, KuiLogModel, KuiLogView) first.
 *
 * The page carries the first window of rows, the config in data-lv-config and the lines as JSON in
 * <script type="application/json" data-lv-data>. After every change this file asks log-view.js for the markup of each
 * region (clear button, match stepper, follow button, drop and line counters, facet chips, rows, "new lines" button,
 * status, detail) and rewrites the regions whose markup changed; the search box, the wrap checkbox and the listbox
 * itself are never replaced, so focus and scroll position stay.
 *
 * Idempotent: window.KuiLogViewer.autoInit() mounts every [data-lv-root] once. Events on the root (bubble):
 *   kui:log-select         { id, line }    a line was selected, or cleared (id null, line null)
 *   kui:log-copy           { id, line }    a line was copied
 *   kui:log-query-change   { query }
 *   kui:log-wrap-change    { wrap }
 *   kui:log-follow-change  { follow }
 * `query`, `wrap` and `follow` given as locals are controlled: the script only emits their events and the host
 * answers with KuiLogViewer.setQuery / setWrap / setFollow (select does the same for the selection when
 * `selectedId` was given). KuiLogViewer.push(root, lines, { dropped }) and setLines(root, lines, { dropped }) feed it.
 */
(function (global) {
  'use strict';
  if (global.KuiLogViewer) return;
  var F = global.KuiObsFormat;
  var M = global.KuiLogModel;
  var V = global.KuiLogView;

  function normLine(l) {
    l = l || {};
    var out = { id: String(l.id), ts: l.ts, severity: M.LOG_SEVERITIES.indexOf(l.severity) !== -1 ? l.severity : 'info', message: l.message == null ? '' : String(l.message) };
    if (l.source) out.source = String(l.source);
    if (l.fields && typeof l.fields === 'object') out.fields = l.fields;
    return out;
  }

  function copyText(text) {
    var nav = global.navigator;
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      return nav.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  /** A stable key for the element that has focus inside a region, to focus its twin after the region is rewritten. */
  function focusKey(el) {
    if (el.hasAttribute('data-lv-facet-key')) return '[data-lv-facet-key="' + attr(el.getAttribute('data-lv-facet-key')) + '"][data-lv-facet-value="' + attr(el.getAttribute('data-lv-facet-value')) + '"]';
    if (el.hasAttribute('data-lv-context')) return '[data-lv-context="' + el.getAttribute('data-lv-context') + '"]';
    if (el.hasAttribute('data-lv-copy')) return '[data-lv-copy]';
    if (el.hasAttribute('data-lv-clear-filters')) return '[data-lv-clear-filters]';
    return null;
  }
  function attr(v) { return String(v).replace(/(["\\])/g, '\\$1'); }

  function mount(root) {
    var cfg;
    var lines;
    try { cfg = JSON.parse(root.getAttribute('data-lv-config') || '{}'); } catch (e) { cfg = {}; }
    try { lines = JSON.parse(root.querySelector('script[data-lv-data]').textContent || '[]'); } catch (e) { lines = []; }
    var listEl = root.querySelector('[data-lv-list]');
    var statusEl = root.querySelector('[data-lv-status]');
    if (!listEl || !statusEl) return;
    var probe = root.querySelector('[data-lv-probe]');
    var controlled = cfg.controlled || {};
    var msg = cfg.messages;
    var maxLines = cfg.maxLines || 10000;
    var tz = cfg.timeZone || undefined;

    var s = {
      lines: lines, q: cfg.ui.query, wrap: !!cfg.ui.wrap, following: !!cfg.ui.following, selected: cfg.ui.selected,
      severities: new Set(), facets: {}, expansions: {}, activeId: null, matchPos: 0, dropped: cfg.dropped || 0, status: '',
      seenAtPause: lines.length, pausedByScroll: false, charW: 0, listW: 0
    };
    var last = {};
    var cur = null;       // the last view
    var statusTimer = null;
    var raf = null;

    function emit(name, detail) { root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail })); }
    function lineById(id) { for (var i = 0; i < s.lines.length; i++) if (s.lines[i].id === id) return s.lines[i]; return null; }

    function ctx() {
      return {
        uid: cfg.uid, msg: msg, lines: s.lines,
        ui: {
          query: s.q, searchMode: cfg.searchMode, hideSearch: cfg.hideSearch, wrap: s.wrap, following: s.following, selected: s.selected,
          severities: s.severities, facets: s.facets, expansions: s.expansions, activeId: s.activeId, matchPos: s.matchPos, dropped: s.dropped,
          height: cfg.height, contextStep: cfg.contextStep, timeZone: tz, status: s.status,
          newWhilePaused: s.following ? 0 : Math.max(0, s.lines.length - s.seenAtPause)
        },
        env: { facetFields: cfg.facetFields || undefined, listWidth: s.listW, charWidth: s.charW, scrollTop: listEl.scrollTop, viewport: listEl.clientHeight || cfg.height }
      };
    }

    // Rewrites `existing` (or inserts, or removes) with `html`, keeping the focus on the twin of the focused element.
    function swap(existing, html, insert) {
      var key = null;
      if (existing && document.activeElement && existing.contains(document.activeElement)) key = focusKey(document.activeElement);
      var holder = null;
      if (existing && html) { existing.insertAdjacentHTML('beforebegin', html); holder = existing.previousElementSibling; }
      if (existing) existing.parentNode.removeChild(existing);
      if (!existing && html) { insert(html); }
      if (key) {
        var scope = holder || root;
        var twin = scope.querySelector(key) || (key.indexOf('data-lv-context') !== -1 ? scope.querySelector('[data-lv-copy]') : null);
        if (twin) twin.focus();
      }
    }

    function slot(name, html, apply) {
      if (last[name] === html) return;
      last[name] = html;
      apply(html);
    }

    function sync() {
      var v = V.view(ctx());
      cur = v;
      // The clear-search button
      var searchWrap = root.querySelector('[data-lv-search-wrap]');
      if (searchWrap) {
        slot('clear', V.clearButton(v), function (html) {
          var ex = searchWrap.querySelector('[data-lv-clear-search]');
          if (ex) ex.parentNode.removeChild(ex);
          if (html) searchWrap.insertAdjacentHTML('beforeend', html);
        });
      }
      // The match stepper
      slot('nav', V.nav(v), function (html) {
        var ex = root.querySelector('[data-lv-nav]');
        if (ex) ex.parentNode.removeChild(ex);
        if (html) root.querySelector('[data-lv-wrap-label]').insertAdjacentHTML('beforebegin', html);
      });
      var wrapInput = root.querySelector('[data-lv-wrap]');
      if (wrapInput && wrapInput.checked !== s.wrap) wrapInput.checked = s.wrap;
      // The follow button is patched in place, so it keeps focus.
      var fb = root.querySelector('[data-lv-follow]');
      slot('follow', V.followClass(v) + '|' + V.followInner(v), function () {
        fb.className = V.followClass(v);
        fb.setAttribute('aria-pressed', s.following ? 'true' : 'false');
        fb.innerHTML = V.followInner(v);
      });
      // The drop and line counters
      slot('tail', V.tail(v), function (html) {
        Array.prototype.forEach.call(root.querySelectorAll('[data-lv-dropped], [data-lv-count]'), function (n) { n.parentNode.removeChild(n); });
        if (html) fb.insertAdjacentHTML('afterend', html);
      });
      // The facet chips
      slot('facets', V.facets(v), function (html) {
        swap(root.querySelector('[data-lv-facets]'), html, function (h) { root.querySelector('[data-lv-toolbar]').insertAdjacentHTML('afterend', h); });
      });
      // The rows
      slot('rows', V.rows(v), function (html) { listEl.innerHTML = html; });
      var ad = V.listAttrs(v);
      var adId = ad ? /aria-activedescendant="([^"]*)"/.exec(ad)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
      if (adId) listEl.setAttribute('aria-activedescendant', adId); else listEl.removeAttribute('aria-activedescendant');
      // The "new lines" button
      slot('newlines', V.newLines(v), function (html) {
        var ex = listEl.parentNode.querySelector('[data-lv-newlines]');
        if (ex) ex.parentNode.removeChild(ex);
        if (html) listEl.insertAdjacentHTML('afterend', html);
      });
      if (statusEl.textContent !== s.status) statusEl.textContent = s.status;
      // The selected line
      slot('detail', V.detail(v), function (html) {
        swap(root.querySelector('[data-lv-detail]'), html, function (h) { statusEl.insertAdjacentHTML('afterend', h); });
      });
      return v;
    }

    // Draw, then stay at the newest line when following (the window is redrawn once the scroll position is final).
    function update() {
      sync();
      if (s.following) { listEl.scrollTop = listEl.scrollHeight; sync(); }
    }

    function setStatus(text, clearAfter) {
      s.status = text;
      if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
      if (clearAfter) statusTimer = setTimeout(function () { s.status = ''; statusEl.textContent = ''; statusTimer = null; }, clearAfter);
    }

    // ── Controlled-or-local values ─────────────────────────────────────────────────────────────────
    function setQuery(q, fromHost) {
      if (!fromHost) emit('kui:log-query-change', { query: q });
      if (controlled.query && !fromHost) { var input = root.querySelector('[data-lv-search]'); if (input) input.value = s.q; return; }
      s.q = q;
      s.matchPos = 0;
      var inp = root.querySelector('[data-lv-search]');
      if (inp && inp.value !== q) inp.value = q;
      update();
    }
    function setWrap(on, fromHost) {
      if (!fromHost) emit('kui:log-wrap-change', { wrap: on });
      if (controlled.wrap && !fromHost) { var cb = root.querySelector('[data-lv-wrap]'); if (cb) cb.checked = s.wrap; return; }
      s.wrap = on;
      update();
    }
    function setFollowing(on, fromHost) {
      if (!fromHost) emit('kui:log-follow-change', { follow: on });
      if (controlled.follow && !fromHost) return;
      s.following = on;
    }
    function select(id, fromHost) {
      if (!fromHost) emit('kui:log-select', { id: id, line: id ? lineById(id) : null });
      if (controlled.selected && !fromHost) return;
      s.selected = id;
    }

    // ── Follow ─────────────────────────────────────────────────────────────────────────────────────
    function jumpToLatest() {
      s.pausedByScroll = false;
      setFollowing(true);
      setStatus(msg.resume);
      listEl.scrollTop = listEl.scrollHeight;
      update();
    }
    function toggleFollow() {
      if (s.following) { s.pausedByScroll = false; s.seenAtPause = s.lines.length; setFollowing(false); setStatus(msg.paused); update(); }
      else jumpToLatest();
    }
    function onScroll() {
      var atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 24;
      if (s.following && !atBottom) {
        s.pausedByScroll = true;
        s.seenAtPause = s.lines.length;
        setFollowing(false);
        setStatus(msg.paused);
      } else if (!s.following && atBottom && s.pausedByScroll) {
        // Back at the newest line after a scroll-pause: resume. A pause chosen with the button stays until the button.
        s.pausedByScroll = false;
        setFollowing(true);
        setStatus(msg.resume);
      }
      sync();
    }

    // ── Rows, keyboard, selection ──────────────────────────────────────────────────────────────────
    function scrollToIndex(i) {
      var o = cur.d.offsets;
      var rowTop = o[i], rowBottom = o[i + 1], h = listEl.clientHeight || cfg.height;
      if (rowTop < listEl.scrollTop) listEl.scrollTop = rowTop;
      else if (rowBottom > listEl.scrollTop + h) listEl.scrollTop = rowBottom - h;
    }
    function move(index) {
      var rows = cur.d.rows;
      var i = Math.min(Math.max(index, 0), rows.length - 1);
      if (i < 0) return;
      var id = s.lines[rows[i]].id;
      s.activeId = id;
      select(id);
      scrollToIndex(i);
      sync();
    }
    listEl.addEventListener('keydown', function (e) {
      var rows = cur.d.rows;
      if (!rows.length || e.altKey || e.ctrlKey || e.metaKey) return;
      var ai = cur.activeIndex;
      var page = Math.max(1, Math.floor((listEl.clientHeight || cfg.height) / (M.LINE_H + M.ROW_PAD * 2)) - 1);
      var k = e.key;
      if (k === 'ArrowDown') move(ai + 1);
      else if (k === 'ArrowUp') move(ai - 1);
      else if (k === 'PageDown') move(ai + page);
      else if (k === 'PageUp') move(ai - page);
      else if (k === 'Home') move(0);
      else if (k === 'End') { move(rows.length - 1); if (!s.following) jumpToLatest(); }
      else if (k === 'Escape') { if (cur.selected) { select(null); sync(); } else return; }
      else return;
      e.preventDefault();
    });
    listEl.addEventListener('scroll', function () {
      if (raf !== null) return;
      raf = global.requestAnimationFrame(function () { raf = null; onScroll(); });
    }, { passive: true });

    function stepMatch(dir) {
      var hm = cur.d.highlight;
      if (!hm.length) return;
      s.matchPos = (s.matchPos + dir + hm.length) % hm.length;
      var idx = cur.d.rows.indexOf(hm[s.matchPos]);
      if (idx >= 0) move(idx); else sync();
    }

    function copy(id) {
      var line = lineById(id);
      if (!line) return;
      var ms = F.toEpochMs(line.ts);
      copyText(M.formatLineText(line, isFinite(ms) ? F.formatClock(ms, tz) : '')).then(function (ok) {
        setStatus(ok ? msg.copied : msg.copyFailed, 1800);
        statusEl.textContent = s.status;
        if (ok) emit('kui:log-copy', { id: id, line: line });
      });
    }

    function toggleFacet(key, value) {
      if (key === 'severity') {
        if (s.severities.has(value)) s.severities.delete(value); else s.severities.add(value);
      } else {
        var set = new Set(s.facets[key] || []);
        if (set.has(value)) set.delete(value); else set.add(value);
        s.facets[key] = set;
      }
      update();
    }
    function clearFilters() {
      s.severities = new Set();
      s.facets = {};
      s.expansions = {};
      if (cfg.searchMode === 'filter') setQuery('');
      else update();
    }
    function expandContext(side) {
      if (!cur.selected) return;
      var c = s.expansions[cur.selected] || { before: 0, after: 0 };
      var next = { before: c.before, after: c.after };
      if (side === 'hide') delete s.expansions[cur.selected];
      else { next[side] = c[side] + cfg.contextStep; s.expansions[cur.selected] = next; }
      update();
    }

    // ── Events ─────────────────────────────────────────────────────────────────────────────────────
    root.addEventListener('input', function (e) {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-lv-search')) setQuery(e.target.value);
    });
    root.addEventListener('change', function (e) {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-lv-wrap')) setWrap(e.target.checked);
    });
    root.addEventListener('keydown', function (e) {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-lv-search') && e.key === 'Enter' && cfg.searchMode === 'highlight') {
        e.preventDefault();
        stepMatch(e.shiftKey ? -1 : 1);
      }
    });
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t || !root.contains(t)) return;
      var b;
      if ((b = t.closest('[data-lv-clear-search]'))) { setQuery(''); return; }
      if (t.closest('[data-lv-prev]')) { stepMatch(-1); return; }
      if (t.closest('[data-lv-next]')) { stepMatch(1); return; }
      if (t.closest('[data-lv-follow]')) { toggleFollow(); return; }
      if (t.closest('[data-lv-newlines]')) { jumpToLatest(); return; }
      if (t.closest('[data-lv-clear-filters]')) { clearFilters(); return; }
      if ((b = t.closest('[data-lv-facet-key]'))) { if (!b.disabled) toggleFacet(b.getAttribute('data-lv-facet-key'), b.getAttribute('data-lv-facet-value')); return; }
      if ((b = t.closest('[data-lv-context]'))) { expandContext(b.getAttribute('data-lv-context')); return; }
      if ((b = t.closest('[data-lv-copy]'))) { copy(b.getAttribute('data-lv-copy')); return; }
      if ((b = t.closest('[data-lv-row]')) && listEl.contains(b)) {
        var id = b.getAttribute('data-lv-row');
        s.activeId = id;
        select(cur.selected === id ? null : id);
        sync();
      }
    });

    // ── Measuring (kui-react measures the same two things, after layout) ────────────────────────────
    function measure() {
      var w = listEl.clientWidth;
      var cw = probe ? probe.getBoundingClientRect().width / 20 : 0;
      if (w === s.listW && (cw <= 0 || cw === s.charW)) return;
      s.listW = w;
      if (cw > 0) s.charW = cw;
      if (s.wrap) update();
    }
    if (typeof global.ResizeObserver === 'function') new global.ResizeObserver(measure).observe(listEl);

    // ── The producer side ──────────────────────────────────────────────────────────────────────────
    function setLines(next, opts) {
      s.lines = next.map(normLine);
      if (opts && typeof opts.dropped === 'number') s.dropped = opts.dropped;
      update();
    }
    function push(batch, opts) {
      var incoming = (Array.isArray(batch) ? batch : [batch]).map(normLine);
      var r = M.appendWindow(s.lines, incoming, maxLines);
      s.lines = r.lines;
      s.dropped += r.dropped + (opts && opts.dropped > 0 ? opts.dropped : 0);
      update();
    }

    var rect = listEl.getBoundingClientRect();
    s.listW = listEl.clientWidth || (rect && rect.width) || 0;
    if (probe) { var pw = probe.getBoundingClientRect().width / 20; if (pw > 0) s.charW = pw; }
    update();
    root.__kuiLog = {
      setLines: setLines, push: push,
      setQuery: function (q) { setQuery(String(q == null ? '' : q), true); },
      setWrap: function (on) { setWrap(!!on, true); update(); },
      setFollow: function (on) { setFollowing(!!on, true); if (!on) s.seenAtPause = s.lines.length; update(); },
      select: function (id) { select(id == null ? null : String(id), true); sync(); }
    };
  }

  function autoInit(scope) {
    var nodes = (scope || document).querySelectorAll('[data-lv-root]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__kuiLvMounted) continue;
      nodes[i].__kuiLvMounted = true;
      mount(nodes[i]);
    }
  }
  function call(root, name, a, b) { if (root && root.__kuiLog) root.__kuiLog[name](a, b); }

  global.KuiLogViewer = {
    autoInit: autoInit, mount: mount,
    push: function (root, lines, opts) { call(root, 'push', lines, opts); },
    setLines: function (root, lines, opts) { call(root, 'setLines', lines, opts); },
    setQuery: function (root, q) { call(root, 'setQuery', q); },
    setWrap: function (root, on) { call(root, 'setWrap', on); },
    setFollow: function (root, on) { call(root, 'setFollow', on); },
    select: function (root, id) { call(root, 'select', id); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
