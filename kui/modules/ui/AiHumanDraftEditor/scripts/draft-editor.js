/*
 * modules/ui/AiHumanDraftEditor/scripts/draft-editor.js
 *
 * Behaviour of AiHumanDraftEditor (kui-react modules/ui/AiHumanDraftEditor/index.tsx): accept or reject one change,
 * reconsider a rejected one, keep mine, accept all, the edit toggle with its textarea, the highlight that ties a
 * change in one panel to its twin (hover in either panel, focus in the human one), and the polite status
 * announcements. Needs draft-model.js and draft-view.js (window.KuiDraftModel, KuiDraftView) first.
 *
 * The page carries the first render and the state in <script type="application/json" data-dr-data> inside the
 * root. After each change this file asks draft-view.js for the markup of the regions that changed (the AI text,
 * the human text, the edit toggle, the footer) and swaps them in; the textarea is never replaced while it is
 * being typed in, so focus and caret stay. Idempotent: window.KuiAiHumanDraftEditor.autoInit() mounts every
 * [data-dr-root] once.
 *
 * Events on the root (they bubble; see AiHumanDraftEditor.ejs for the contract):
 *   kui:draft-accept-hunk { hunk }   kui:draft-reject-hunk { hunk }   kui:draft-accept-all {}
 *   kui:draft-change { value }       kui:draft-rejected-change { keys }       (the last two are cancelable)
 * API: root.kuiAiHumanDraftEditor, and KuiAiHumanDraftEditor.setValue / setRejected / setAiDraft (root, ...).
 */
(function (global) {
  'use strict';
  if (global.KuiAiHumanDraftEditor) return;
  var M = global.KuiDraftModel;
  var V = global.KuiDraftView;

  function fromHtml(html) {
    var t = document.createElement('template');
    t.innerHTML = html;
    return t.content.firstElementChild;
  }

  function mount(root) {
    if (root.kuiAiHumanDraftEditor) return root.kuiAiHumanDraftEditor;
    var dataEl = root.querySelector('script[data-dr-data]');
    var cfg;
    try { cfg = JSON.parse(dataEl ? dataEl.textContent || '{}' : '{}'); } catch (e) { cfg = {}; }
    var statusEl = root.querySelector('[data-dr-status]');
    if (!statusEl || !root.querySelector('[data-dr-ai-body]')) return null;

    var state = {
      value: cfg.value == null ? '' : String(cfg.value),
      aiDraft: cfg.aiDraft == null ? '' : String(cfg.aiDraft),
      rejected: Array.isArray(cfg.rejected) ? cfg.rejected.slice() : [],
      editing: false,
      activeKey: null,
      announce: ''
    };
    var controlledRejected = !!cfg.rejectedControlled;
    var ctx = {
      uid: cfg.uid, msg: M.mergeMessages(cfg.messages), model: cfg.model || '', readOnly: !!cfg.readOnly,
      minHeight: typeof cfg.minHeight === 'number' ? cfg.minHeight : 160
    };

    // The diff is computed again only when the texts or the rejected keys changed (hover and focus do not).
    var dirty = true;
    function view() {
      ctx.aiDraft = state.aiDraft;
      ctx.value = state.value;
      ctx.rejected = state.rejected;
      ctx.editing = state.editing;
      ctx.activeKey = state.activeKey;
      if (dirty || !ctx.d) { V.prepare(ctx); dirty = false; }
      return ctx;
    }
    function swap(selector, html) {
      var old = root.querySelector(selector);
      if (!old) return null;
      var next = fromHtml(html);
      old.replaceWith(next);
      return next;
    }
    function textarea() { return root.querySelector('[data-dr-input]'); }

    /** Redraws the regions. `focus` is a selector to focus afterwards (a button the redraw replaced). */
    function render(opts) {
      opts = opts || {};
      view();
      swap('[data-dr-ai-body]', V.aiBody(ctx));
      if (opts.header) swap('[data-dr-human-header]', V.humanHeader(ctx));
      var ta = textarea();
      if (state.editing && !ctx.readOnly) {
        if (!ta) { swap('[data-dr-human-body]', V.humanBody(ctx)); ta = textarea(); if (ta) ta.value = state.value; }
        else if (ta.value !== state.value) ta.value = state.value;
      } else {
        swap('[data-dr-human-body]', V.humanBody(ctx));
      }
      swap('[data-dr-footer]', V.footer(ctx));
      statusEl.textContent = state.announce;
      if (opts.focus) { var f = root.querySelector(opts.focus); if (f) f.focus(); }
    }

    function emit(name, detail, cancelable) {
      var ev = new CustomEvent(name, { bubbles: true, cancelable: !!cancelable, detail: detail });
      return root.dispatchEvent(ev);
    }
    function copyHunk(h) { return { key: h.key, human: h.human, ai: h.ai }; }

    function setValue(next, opts) {
      state.value = String(next == null ? '' : next);
      dirty = true;
      render(opts);
    }
    function setRejected(next, opts) {
      state.rejected = (next || []).map(String);
      dirty = true;
      render(opts);
    }
    function changeValue(next, opts) {
      var applied = emit('kui:draft-change', { value: next }, true);
      if (applied) setValue(next, opts);
      else { var ta = textarea(); if (ta) ta.value = state.value; statusEl.textContent = state.announce; }
    }
    function changeRejected(next, opts) {
      var applied = emit('kui:draft-rejected-change', { keys: next.slice() }, true);
      if (applied && !controlledRejected) setRejected(next, opts);
      else render(opts);
    }

    function rejectedSet() { var s = {}; state.rejected.forEach(function (k) { s[k] = true; }); return s; }
    function hunkAt(i) { var d = view().d; return d.hunks[i - 1] || null; }

    function accept(i) {
      var d = view().d, h = d.hunks[i - 1];
      if (!h) return;
      var next = M.applySegments(d.segments, function (x) { return x.key === h.key ? 'ai' : 'human'; });
      emit('kui:draft-accept-hunk', { hunk: copyHunk(h) });
      state.announce = M.fillMessage(ctx.msg.acceptedAnnounce, { index: d.indexOf(h) });
      // The accepted change is gone: focus lands on the change that now has its number.
      changeValue(next, { focus: '[data-dr-act="accept"][data-dr-i="' + i + '"]' });
    }
    function reject(i) {
      var d = view().d, h = d.hunks[i - 1];
      if (!h) return;
      emit('kui:draft-reject-hunk', { hunk: copyHunk(h) });
      state.announce = M.fillMessage(ctx.msg.rejectedAnnounce, { index: d.indexOf(h) });
      changeRejected(state.rejected.concat([h.key]), { focus: '[data-dr-act="reconsider"][data-dr-i="' + i + '"]' });
    }
    function reconsider(i) {
      var h = hunkAt(i);
      if (!h) return;
      changeRejected(state.rejected.filter(function (k) { return k !== h.key; }), { focus: '[data-dr-act="accept"][data-dr-i="' + i + '"]' });
    }
    function acceptAll() {
      var d = view().d, rej = rejectedSet();
      emit('kui:draft-accept-all', {});
      state.announce = ctx.msg.allAcceptedAnnounce;
      changeValue(M.applySegments(d.segments, function (x) { return rej[x.key] ? 'human' : 'ai'; }));
    }
    function keepMine() {
      var d = view().d, seen = {}, next = [];
      state.rejected.concat(d.hunks.map(function (h) { return h.key; })).forEach(function (k) { if (!seen[k]) { seen[k] = true; next.push(k); } });
      state.announce = ctx.msg.allRejectedAnnounce;
      changeRejected(next);
    }
    function setActive(key) {
      if (state.activeKey === key) return;
      state.activeKey = key;
      view();
      var d = ctx.d;
      Array.prototype.forEach.call(root.querySelectorAll('[data-hunk]'), function (el) {
        var inAi = !!el.closest('[data-dr-ai-body]');
        var i = indexOfEl(el);
        var h = d.hunks[i - 1];
        if (!h) return;
        var rej = d.isRejected(h), active = state.activeKey === h.key;
        el.className = inAi ? M.CLASSES.aiHunk(rej, active) : M.CLASSES.humanHunk(rej, active);
      });
    }
    // A hunk's number is the text of its <sup>; the keys themselves hold a NUL that the HTML parser rewrote.
    function indexOfEl(el) { var sup = el.querySelector('sup'); return sup ? parseInt(sup.textContent, 10) : 0; }
    function keyOfEl(el) { var h = view().d.hunks[indexOfEl(el) - 1]; return h ? h.key : null; }

    root.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-dr-act]') : null;
      if (!btn || !root.contains(btn)) return;
      var i = parseInt(btn.getAttribute('data-dr-i') || '0', 10);
      switch (btn.getAttribute('data-dr-act')) {
        case 'toggle-edit': state.editing = !state.editing; render({ header: true, focus: '[data-dr-act="toggle-edit"]' }); break;
        case 'accept': accept(i); break;
        case 'reject': reject(i); break;
        case 'reconsider': reconsider(i); break;
        case 'accept-all': acceptAll(); break;
        case 'keep-mine': keepMine(); break;
      }
    });
    root.addEventListener('input', function (e) {
      if (!e.target || !e.target.hasAttribute || !e.target.hasAttribute('data-dr-input')) return;
      changeValue(e.target.value);
    });
    root.addEventListener('mouseover', function (e) {
      var el = e.target.closest ? e.target.closest('[data-hunk]') : null;
      if (el && root.contains(el)) setActive(keyOfEl(el));
    });
    root.addEventListener('mouseout', function (e) {
      var el = e.target.closest ? e.target.closest('[data-hunk]') : null;
      if (el && root.contains(el) && !(e.relatedTarget && el.contains(e.relatedTarget))) setActive(null);
    });
    root.addEventListener('focusin', function (e) {
      var el = e.target.closest ? e.target.closest('[data-hunk][role="group"]') : null;
      if (el && root.contains(el)) setActive(keyOfEl(el));
    });
    root.addEventListener('focusout', function (e) {
      var el = e.target.closest ? e.target.closest('[data-hunk][role="group"]') : null;
      if (el && root.contains(el) && !(e.relatedTarget && el.contains(e.relatedTarget))) setActive(null);
    });

    var api = {
      value: function () { return state.value; },
      rejected: function () { return state.rejected.slice(); },
      setValue: function (v) { setValue(v); },
      setRejected: function (keys) { setRejected(keys); },
      setAiDraft: function (text) { state.aiDraft = String(text == null ? '' : text); dirty = true; render(); }
    };
    root.kuiAiHumanDraftEditor = api;
    return api;
  }

  function autoInit(scope) {
    Array.prototype.forEach.call((scope || document).querySelectorAll('[data-dr-root]'), mount);
  }
  function withApi(root, fn) { var api = root && (root.kuiAiHumanDraftEditor || mount(root)); if (api) fn(api); }

  global.KuiAiHumanDraftEditor = {
    mount: mount,
    autoInit: autoInit,
    setValue: function (root, v) { withApi(root, function (a) { a.setValue(v); }); },
    setRejected: function (root, keys) { withApi(root, function (a) { a.setRejected(keys); }); },
    setAiDraft: function (root, text) { withApi(root, function (a) { a.setAiDraft(text); }); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
