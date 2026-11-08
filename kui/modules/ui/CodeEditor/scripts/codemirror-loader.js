// modules/ui/CodeEditor/scripts/codemirror-loader.js
//
// CodeMirror engine for the EJS CodeEditor — textarea implementation (M1, M2 and M3).
// Mirrors kui-react modules/ui/CodeEditor/engines/codemirror.tsx, index.tsx,
// parts/Toolbar.tsx and parts/FindBar.tsx.
//
// CodeMirror 6 is NOT yet a project dependency. This script drives the server-rendered
// textarea: it keeps the hidden form input in sync, maintains the gutter's active line,
// emits a `kui-codeeditor:change` CustomEvent on every change, and syncs scroll between the
// textarea, the gutter and the tinted lines (M1); Tab / Shift+Tab indent (Esc, then Tab
// leaves the field), Ctrl/Cmd+/ comment toggle, auto-indent on Enter, bracket and quote
// pairs, the toolbar (find, format, copy, full screen), the find / replace bar
// (Ctrl/Cmd+F), format (Shift+Alt+F) and formatOnSave (Ctrl/Cmd+S) (M2); diagnostics in the
// gutter, tinted lines and the problems list, a completion listbox and a hover card (M3).
// Edits go through the browser's `insertText` where it has one, so Ctrl+Z undoes them like
// typing. The text operations live in scripts/editing.js, the redrawn markup in
// scripts/view.js.
//
// Public surface:
//   KuiCodeEditor.attach(root, opts) → instance (opts: the config the template writes, or
//     functions for format / getSuggestions / getHover, markers, messages, …)
//   KuiCodeEditor.get(id) → { root, getValue, setValue, setMarkers, configure, format,
//     openFind, closeFind } or null
//
// TODO M1+: once @codemirror/state + @codemirror/view + the language bundles ship as deps,
//           swap the textarea for a CM6 EditorView inside the same wrapper. Keep
//           window.KuiCodeEditor.attach as the public surface so this file is the single
//           swap point.
// TODO M4:  minimap + code folding; multi-cursor and bracket-match highlight need CM6.

(function () {
  if (window.KuiCodeEditor) return;

  var E = window.KuiCodeEditorEditing;
  var V = window.KuiCodeEditorView;
  /** the pointer rests this long on a name before its hover card is asked for */
  var HOVER_DELAY_MS = 400;
  var FULLSCREEN_CLASSES = ['fixed', 'inset-0', 'z-[60]', 'flex', 'flex-col', 'overflow-auto', 'bg-surface-base', 'p-4'];
  var PRESSED_CLASSES = ['bg-primary-subtle', 'text-primary'];
  var instances = {};

  /** a function given directly, or the name of a global one (looked up when it is needed) */
  function fnOf(f) {
    if (typeof f === 'function') return f;
    if (typeof f === 'string' && f && typeof window[f] === 'function') return window[f];
    return null;
  }

  function toggleClasses(el, list, on) {
    if (!el) return;
    for (var i = 0; i < list.length; i++) el.classList.toggle(list[i], !!on);
  }

  function attach(root, opts) {
    opts = opts || {};
    var id = opts.id || root.getAttribute('data-kui-codeeditor');
    if (!id) return null;
    if (instances[id] && instances[id].root === root) { instances[id].configure(opts); return instances[id]; }

    var ta = root.querySelector('[data-kui-codeeditor-textarea]');
    if (!ta) return null;
    var frame = root.querySelector('[data-kui-codeeditor-engine]') || ta.parentElement;
    var body = root.querySelector('[data-kui-codeeditor-body]') || ta.parentElement;
    var gutter = root.querySelector('[data-kui-codeeditor-gutter]');
    var hidden = root.querySelector('[data-kui-codeeditor-input]');
    var toolbar = root.querySelector('[data-kui-codeeditor-toolbar]');
    var findbar = root.querySelector('[data-kui-codeeditor-find]');
    var measure = root.querySelector('[data-kui-codeeditor-measure]');

    var cfg = {
      language: opts.language || root.getAttribute('data-language') || 'plaintext',
      readonly: opts.readonly != null ? !!opts.readonly : !!ta.readOnly,
      tabSize: Number(opts.tabSize) >= 1 ? Math.floor(Number(opts.tabSize)) : 2,
      minHeight: Number(opts.minHeight) > 0 ? Number(opts.minHeight) : (parseFloat(frame.style.minHeight) || 200),
      showToolbar: opts.showToolbar != null ? !!opts.showToolbar : !!toolbar,
      formatOnSave: !!opts.formatOnSave,
      format: opts.format || null,
      getSuggestions: opts.getSuggestions || null,
      getHover: opts.getHover || null,
      messages: V.mergeMessages(opts.messages),
    };
    var markers = opts.markers || [];
    var noteId = id + '-note';
    var problemsId = id + '-problems';
    var listId = id + '-suggest';

    var activeLine = 1;
    var gutterKey = '';
    var escaped = false;
    var typed = null;
    var reqSeq = 0;
    var suggest = null; // { items, index, caret, origin }
    var hoverTimer = null;
    var hoverShown = false;
    var charW = 0;
    var fullscreen = false;
    var findOpen = false;
    var find = { matchCase: false, index: 0 };
    var copiedTimer = null;

    function m() { return cfg.messages; }
    function unit() { return new Array(Math.max(1, cfg.tabSize) + 1).join(' '); }
    function value() { return ta.value; }

    // ── gutter, markers ────────────────────────────────────────────────────

    function byLine() { return V.markersByLine(markers); }

    function updateGutter() {
      var v = value();
      activeLine = v.slice(0, ta.selectionStart || 0).split('\n').length;
      if (!gutter) return;
      var count = Math.max(v.split('\n').length, 1);
      var key = count + '|' + activeLine + '|' + markersKey;
      if (key === gutterKey) return;
      gutterKey = key;
      var lines = byLine();
      gutter.innerHTML = V.gutterRowsHtml(count, activeLine, V.hasAny(lines) ? lines : null);
    }

    var markersKey = '';
    function renderMarkers() {
      markersKey = String(Math.random());
      var lines = byLine();
      var sorted = V.sortMarkers(markers);
      var oldTints = body.querySelector('[data-kui-codeeditor-tints]');
      if (oldTints) oldTints.parentNode.removeChild(oldTints);
      var tints = V.tintsHtml(lines, ta.scrollTop);
      if (tints) body.insertAdjacentHTML('afterbegin', tints);
      var oldList = root.querySelector('[data-kui-codeeditor-problems]');
      if (oldList) oldList.parentNode.removeChild(oldList);
      var list = V.problemsHtml(sorted, m(), problemsId);
      if (list) {
        var note = document.getElementById(noteId);
        if (note && note.parentNode === root) note.insertAdjacentHTML('beforebegin', list);
        else root.insertAdjacentHTML('beforeend', list);
      }
      var described = [document.getElementById(noteId) ? noteId : '', sorted.length ? problemsId : ''].filter(Boolean).join(' ');
      if (described) ta.setAttribute('aria-describedby', described); else ta.removeAttribute('aria-describedby');
      var hasError = /\bborder-error\b/.test(frame.className) || sorted.some(function (mk) { return mk.severity === 'error'; });
      if (hasError) ta.setAttribute('aria-invalid', 'true'); else ta.removeAttribute('aria-invalid');
      gutterKey = '';
      updateGutter();
    }

    function goTo(line, column) {
      var at = E.indexAt(value(), line, column || 1);
      ta.focus();
      ta.setSelectionRange(at, at);
      ta.scrollTop = Math.max(0, (line - 1) * V.LINE_H - ta.clientHeight / 2);
      updateGutter();
    }

    // ── changes ────────────────────────────────────────────────────────────

    /** after every change: the form input, the gutter, the find count and the change event */
    function changed() {
      if (hidden) hidden.value = ta.value;
      updateGutter();
      if (findOpen) refreshFind();
      try {
        root.dispatchEvent(new CustomEvent('kui-codeeditor:change', {
          detail: { value: ta.value, id: id },
          bubbles: true,
        }));
      } catch (_e) { /* noop — older browsers */ }
    }

    /** a new value from outside the keys (format, replace, setValue) */
    function setValue(next) {
      if (typeof next !== 'string' || next === ta.value) return;
      ta.value = next;
      changed();
    }

    /** one edit: through the browser's undo stack where it can, else as a new value with the selection placed after it */
    function apply(e) {
      if (e.from === e.to && !e.text) { ta.setSelectionRange(e.selStart, e.selEnd); updateGutter(); return; }
      var expected = E.applyEdit(ta.value, e);
      ta.setSelectionRange(e.from, e.to);
      var native = false;
      try {
        native = typeof document.execCommand === 'function' && document.execCommand(e.text ? 'insertText' : 'delete', false, e.text);
      } catch (_e) { native = false; }
      if (!(native && ta.value === expected)) {
        ta.value = expected;
        changed();
      }
      ta.setSelectionRange(e.selStart, e.selEnd);
      updateGutter();
    }

    function runFormat() {
      var f = fnOf(cfg.format);
      if (!f || cfg.readonly) return Promise.resolve();
      var before = ta.value;
      return Promise.resolve()
        .then(function () { return f(before); })
        .then(function (next) { if (typeof next === 'string' && next !== before) setValue(next); })
        .catch(function () { /* a formatter that fails leaves the code as it was */ });
    }

    // ── completion ─────────────────────────────────────────────────────────

    function originOf() {
      var p = ta.parentElement;
      return { x: (p ? p.offsetLeft : 0) + ta.offsetLeft, y: (p ? p.offsetTop : 0) + ta.offsetTop };
    }

    function measureChar() {
      if (charW > 0 || !measure) return charW;
      var w = measure.getBoundingClientRect().width;
      charW = w > 0 ? w / 10 : 0;
      return charW;
    }

    function renderSuggest() {
      var old = frame.querySelector('[data-kui-codeeditor-suggest]');
      if (old) old.parentNode.removeChild(old);
      if (!suggest) {
        ta.removeAttribute('aria-controls');
        ta.removeAttribute('aria-activedescendant');
        return;
      }
      var v = value();
      var c = E.cursorAt(v, suggest.caret);
      var cw = measureChar() > 0 ? charW : 8;
      var o = suggest.origin;
      var at = {
        top: c.line * V.LINE_H + V.PAD_Y - ta.scrollTop + o.y + 2,
        left: Math.max(0, (c.column - 1 - E.prefixAt(v, suggest.caret).text.length) * cw + V.PAD_X - ta.scrollLeft + o.x),
      };
      frame.insertAdjacentHTML('beforeend', V.suggestHtml(suggest.items, suggest.index, listId, m(), at));
      ta.setAttribute('aria-controls', listId);
      ta.setAttribute('aria-activedescendant', listId + '-' + suggest.index);
    }

    function closeSuggest() {
      reqSeq++;
      if (!suggest) return;
      suggest = null;
      renderSuggest();
    }

    function requestSuggestions(text, caret, explicit, trigger) {
      var f = fnOf(cfg.getSuggestions);
      if (!f) return;
      var prefix = E.prefixAt(text, caret).text;
      if (!explicit && !prefix) { if (suggest) { suggest = null; renderSuggest(); } return; }
      var seq = ++reqSeq;
      Promise.resolve()
        .then(function () { return f({ language: cfg.language, value: text, cursor: E.cursorAt(text, caret), triggerCharacter: trigger, prefix: prefix }); })
        .then(function (list) {
          if (seq !== reqSeq) return;
          var items = E.filterSuggestions(list || [], prefix);
          suggest = items.length ? { items: items, index: 0, caret: caret, origin: originOf() } : null;
          renderSuggest();
        })
        .catch(function () { if (seq === reqSeq) { suggest = null; renderSuggest(); } });
    }

    function accept(s) {
      var caret = ta.selectionStart != null ? ta.selectionStart : (suggest ? suggest.caret : 0);
      suggest = null;
      reqSeq++;
      renderSuggest();
      apply(E.suggestionEdit(ta.value, caret, s));
    }

    // ── hover ──────────────────────────────────────────────────────────────

    function setHover(h) {
      var old = frame.querySelector('[data-kui-codeeditor-hover]');
      if (old) old.parentNode.removeChild(old);
      hoverShown = !!h;
      if (h) frame.insertAdjacentHTML('beforeend', V.hoverHtml(h.text, h));
    }

    function clearHoverTimer() {
      if (hoverTimer !== null) window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }

    function onMouseMove(e) {
      var f = fnOf(cfg.getHover);
      if (!f || measureChar() <= 0) return;
      var r = ta.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      var line = Math.floor((y + ta.scrollTop - V.PAD_Y) / V.LINE_H) + 1;
      var column = Math.floor((x + ta.scrollLeft - V.PAD_X) / charW) + 1;
      clearHoverTimer();
      var v = value();
      var text = v.split('\n')[line - 1];
      if (text === undefined || line < 1 || column < 1 || column > text.length) { if (hoverShown) setHover(null); return; }
      var word = E.wordAt(v, E.indexAt(v, line, column));
      if (!word) { if (hoverShown) setHover(null); return; }
      var o = originOf();
      var at = { x: x + o.x, y: (line * V.LINE_H) + V.PAD_Y - ta.scrollTop + o.y + 2 };
      hoverTimer = window.setTimeout(function () {
        hoverTimer = null;
        Promise.resolve()
          .then(function () { return f({ language: cfg.language, value: v, word: word, cursor: { line: line, column: column } }); })
          .then(function (h) { setHover(h && h.contents ? { text: h.contents, x: at.x, y: at.y } : null); })
          .catch(function () { setHover(null); });
      }, HOVER_DELAY_MS);
    }

    function onMouseLeave() {
      clearHoverTimer();
      setHover(null);
    }

    // ── keys ───────────────────────────────────────────────────────────────

    function onKeyDown(e) {
      var s = ta.selectionStart || 0, en = ta.selectionEnd || 0;
      var mod = e.ctrlKey || e.metaKey;
      var v = ta.value;
      typed = !mod && !e.altKey && e.key && e.key.length === 1 ? e.key : null;
      if (hoverShown) setHover(null);
      if (suggest) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          var n = suggest.items.length;
          suggest.index = (suggest.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
          renderSuggest();
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(suggest.items[suggest.index]); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSuggest(); return; }
      }
      if (mod && !e.altKey && e.key && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); return; }
      if (e.shiftKey && e.altKey && !mod && e.code === 'KeyF') { if (fnOf(cfg.format) && !cfg.readonly) { e.preventDefault(); runFormat(); } return; }
      if (cfg.readonly) return;
      if (e.key === 'Escape') { escaped = true; return; }
      if (e.key === 'Tab' && !mod && !e.altKey) {
        // Esc, then Tab: the key moves the focus on, as everywhere else on the page
        if (escaped) { escaped = false; return; }
        e.preventDefault();
        apply(E.indentEdit(v, s, en, e.shiftKey, unit()));
        return;
      }
      escaped = false;
      var token = E.commentTokenOf(cfg.language);
      if (mod && !e.altKey && e.key === '/' && token) { e.preventDefault(); apply(E.commentEdit(v, s, en, token)); return; }
      if (mod && e.key === ' ' && fnOf(cfg.getSuggestions)) { e.preventDefault(); requestSuggestions(v, s, true); return; }
      if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && !e.isComposing) { e.preventDefault(); apply(E.enterEdit(v, s, en, unit())); return; }
      if (e.key === 'Backspace' && !mod && !e.altKey) {
        var edit = E.backspaceEdit(v, s, en);
        if (edit) { e.preventDefault(); apply(edit); closeSuggest(); }
        return;
      }
      if (typed) {
        var pair = E.pairEdit(v, s, en, typed);
        if (pair) { e.preventDefault(); apply(pair); }
      }
    }

    function onInput() {
      changed();
      if (!fnOf(cfg.getSuggestions)) return;
      var next = ta.value;
      var caret = ta.selectionStart != null ? ta.selectionStart : next.length;
      var ch = typed;
      if (ch && /[\w$.]/.test(ch)) requestSuggestions(next, caret, false, ch);
      else if (suggest) {
        // Backspace keeps the list while a name is still being typed
        if (ch === null && E.prefixAt(next, caret).text) requestSuggestions(next, caret, false);
        else { suggest = null; renderSuggest(); }
      }
    }

    function onScroll() {
      if (gutter) gutter.scrollTop = ta.scrollTop;
      var tints = body.querySelector('[data-kui-codeeditor-tints]');
      if (tints) tints.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
      if (suggest) renderSuggest();
    }

    // ── find / replace ─────────────────────────────────────────────────────

    function findEl(sel) { return findbar ? findbar.querySelector(sel) : null; }
    var queryEl = findEl('[data-kui-codeeditor-find-query]');
    var replEl = findEl('[data-kui-codeeditor-find-replacement]');
    var countEl = findEl('[data-kui-codeeditor-find-count]');

    function hits() { return E.findMatches(ta.value, queryEl ? queryEl.value : '', find.matchCase); }
    function current(h) { return h.length ? Math.min(find.index, h.length - 1) : 0; }

    function refreshFind() {
      if (!findbar) return;
      var h = hits();
      var at = current(h);
      var q = queryEl ? queryEl.value : '';
      if (countEl) countEl.textContent = q ? (h.length ? V.fmt(m().findCount, { current: at + 1, total: h.length }, [at + 1, h.length]) : m().findNone) : '';
      var buttons = findbar.querySelectorAll('[data-kui-codeeditor-find-action]');
      for (var i = 0; i < buttons.length; i++) {
        var act = buttons[i].getAttribute('data-kui-codeeditor-find-action');
        if (act === 'case') {
          buttons[i].setAttribute('aria-pressed', String(find.matchCase));
          toggleClasses(buttons[i], PRESSED_CLASSES, find.matchCase);
        } else if (act !== 'close') {
          buttons[i].disabled = !h.length;
        }
      }
    }

    function show(i) {
      var h = hits();
      var hit = h[i];
      if (!hit) return;
      find.index = i;
      ta.setSelectionRange(hit[0], hit[1]);
      // scroll the match into view: the line times the line height, kept in the middle
      var line = ta.value.slice(0, hit[0]).split('\n').length;
      ta.scrollTop = Math.max(0, (line - 1) * V.LINE_H - ta.clientHeight / 2);
      refreshFind();
    }

    function step(d) {
      var h = hits();
      if (h.length) show((current(h) + d + h.length) % h.length);
    }

    function setFrameTop() {
      frame.classList.toggle('rounded-t-none', cfg.showToolbar || findOpen);
    }

    function setToolbarPressed(action, on) {
      var b = toolbar ? toolbar.querySelector('[data-kui-codeeditor-action="' + action + '"]') : null;
      if (!b) return;
      b.setAttribute('aria-pressed', String(!!on));
      if (action === 'find') toggleClasses(b, PRESSED_CLASSES, on);
    }

    function openFind() {
      if (!findbar) return;
      if (!findOpen) {
        findOpen = true;
        findbar.hidden = false;
        setFrameTop();
        setToolbarPressed('find', true);
        refreshFind();
      }
      if (queryEl) { queryEl.focus(); queryEl.select(); }
    }

    function closeFind() {
      if (!findbar || !findOpen) return;
      findOpen = false;
      findbar.hidden = true;
      // the bar starts afresh next time, as kui-react's unmounted FindBar does
      if (queryEl) queryEl.value = '';
      if (replEl) replEl.value = '';
      find.matchCase = false;
      find.index = 0;
      refreshFind();
      setFrameTop();
      setToolbarPressed('find', false);
    }

    if (findbar) {
      if (queryEl) {
        queryEl.addEventListener('input', function () { find.index = 0; refreshFind(); });
        queryEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); ta.focus(); }
        });
      }
      findbar.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-kui-codeeditor-find-action]') : null;
        if (!b || b.disabled) return;
        var act = b.getAttribute('data-kui-codeeditor-find-action');
        var h = hits();
        if (act === 'case') { find.matchCase = !find.matchCase; refreshFind(); }
        else if (act === 'prev') step(-1);
        else if (act === 'next') step(1);
        else if (act === 'close') closeFind();
        else if (cfg.readonly) return;
        else if (act === 'replace') {
          var hit = h[current(h)];
          if (hit) setValue(ta.value.slice(0, hit[0]) + (replEl ? replEl.value : '') + ta.value.slice(hit[1]));
        } else if (act === 'replace-all') {
          setValue(E.replaceAllText(ta.value, queryEl ? queryEl.value : '', replEl ? replEl.value : '', find.matchCase).value);
        }
      });
    }

    // ── toolbar, full screen, copy ─────────────────────────────────────────

    function onFullscreenKey(e) {
      if (e.key === 'Escape' && !e.defaultPrevented) setFullscreen(false);
    }

    function setFullscreen(on) {
      on = !!on;
      if (on === fullscreen) return;
      fullscreen = on;
      if (on) root.setAttribute('data-fullscreen', ''); else root.removeAttribute('data-fullscreen');
      toggleClasses(root, FULLSCREEN_CLASSES, on);
      frame.classList.toggle('flex-1', on);
      var h = (on ? Math.max(cfg.minHeight, 480) : cfg.minHeight) + 'px';
      frame.style.minHeight = h;
      ta.style.minHeight = h;
      if (gutter) gutter.style.minHeight = h;
      var b = toolbar ? toolbar.querySelector('[data-kui-codeeditor-action="fullscreen"]') : null;
      if (b) {
        var label = on ? m().exitFullscreen : m().fullscreen;
        b.setAttribute('aria-label', label);
        b.setAttribute('title', label);
        b.setAttribute('aria-pressed', String(on));
        var icon = b.querySelector('i');
        if (icon) { icon.classList.toggle('fa-maximize', !on); icon.classList.toggle('fa-minimize', on); }
      }
      if (on) window.addEventListener('keydown', onFullscreenKey);
      else window.removeEventListener('keydown', onFullscreenKey);
    }

    function copy(b) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).catch(function () {});
      } catch (_e) { /* no clipboard */ }
      if (!b) return;
      var icon = b.querySelector('i');
      function state(copied) {
        var label = copied ? m().copied : m().copy;
        b.setAttribute('aria-label', label);
        b.setAttribute('title', label);
        if (icon) { icon.classList.toggle('fa-copy', !copied); icon.classList.toggle('fa-check', copied); }
      }
      state(true);
      if (copiedTimer !== null) window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(function () { copiedTimer = null; state(false); }, 1500);
    }

    function syncFormatButton() {
      var b = toolbar ? toolbar.querySelector('[data-kui-codeeditor-action="format"]') : null;
      if (b) b.hidden = !(cfg.format && !cfg.readonly);
    }

    if (toolbar) {
      toolbar.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-kui-codeeditor-action]') : null;
        if (!b) return;
        var act = b.getAttribute('data-kui-codeeditor-action');
        if (act === 'find') { if (findOpen) closeFind(); else openFind(); }
        else if (act === 'format') runFormat();
        else if (act === 'copy') copy(b);
        else if (act === 'fullscreen') setFullscreen(!fullscreen);
      });
    }

    // Ctrl/Cmd+S formats first; the key still reaches the page (a host's save).
    root.addEventListener('keydown', function (e) {
      if (!cfg.formatOnSave || !fnOf(cfg.format)) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key && e.key.toLowerCase() === 's') runFormat();
    }, true);

    // A row of the problems list jumps to its spot.
    root.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-kui-codeeditor-problems] button[data-line]') : null;
      if (b) goTo(Number(b.getAttribute('data-line')), Number(b.getAttribute('data-column')) || 1);
    });

    // A suggestion picked with the pointer (mousedown keeps the focus in the field).
    frame.addEventListener('mousedown', function (e) {
      var li = e.target && e.target.closest ? e.target.closest('[data-kui-codeeditor-suggest] [role="option"]') : null;
      if (!li || !suggest) return;
      e.preventDefault();
      var s = suggest.items[Number(li.getAttribute('data-index'))];
      if (s) accept(s);
    });

    ta.addEventListener('keydown', onKeyDown);
    ta.addEventListener('input', onInput);
    ta.addEventListener('keyup', updateGutter);
    ta.addEventListener('click', updateGutter);
    ta.addEventListener('focus', updateGutter);
    ta.addEventListener('scroll', onScroll);
    ta.addEventListener('blur', closeSuggest);
    ta.addEventListener('mousemove', onMouseMove);
    ta.addEventListener('mouseleave', onMouseLeave);

    function configure(next) {
      next = next || {};
      if ('format' in next) cfg.format = next.format || null;
      if ('getSuggestions' in next) {
        cfg.getSuggestions = next.getSuggestions || null;
        if (cfg.getSuggestions) ta.setAttribute('aria-autocomplete', 'list'); else ta.removeAttribute('aria-autocomplete');
      }
      if ('getHover' in next) cfg.getHover = next.getHover || null;
      if ('formatOnSave' in next) cfg.formatOnSave = !!next.formatOnSave;
      if (Number(next.tabSize) >= 1) cfg.tabSize = Math.floor(Number(next.tabSize));
      if (next.language) cfg.language = next.language;
      if (next.messages) {
        for (var k in next.messages) if (next.messages[k] != null) cfg.messages[k] = next.messages[k];
      }
      syncFormatButton();
      if ('markers' in next) { markers = next.markers || []; renderMarkers(); }
    }

    var instance = {
      root: root,
      getValue: value,
      setValue: setValue,
      setMarkers: function (list) { markers = list || []; renderMarkers(); },
      configure: configure,
      format: runFormat,
      openFind: openFind,
      closeFind: closeFind,
    };
    instances[id] = instance;

    syncFormatButton();
    if (cfg.getSuggestions) ta.setAttribute('aria-autocomplete', 'list');
    markersKey = String(Math.random());
    updateGutter();
    return instance;
  }

  window.KuiCodeEditor = {
    attach: attach,
    get: function (id) { return instances[id] || null; },
  };
})();
