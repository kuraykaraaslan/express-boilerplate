/*
 * modules/ui/AiHumanDraftEditor/draft-view.js
 *
 * The markup of AiHumanDraftEditor as strings, for the browser script: the same DOM and classes as
 * AiHumanDraftEditor.ejs (and so as kui-react modules/ui/AiHumanDraftEditor/index.tsx). tests/ai-human-draft-editor
 * -parity.test.ts compares both this file's output and the partial's with the HTML kui-react renders. Pure, no DOM.
 * Needs draft-model.js first (window.KuiDraftModel). Exposed as window.KuiDraftView (and module.exports under Node).
 *
 * A context `ctx` is { uid, msg (every message), aiDraft, value, rejected (array of hunk keys), model, readOnly,
 * minHeight, editing, activeKey, announce }; `ctx.d` is KuiDraftModel.derive(...) of it, filled by `prepare`.
 * Hooks of the browser script, not in React: data-dr-root, data-dr-ai-body, data-dr-human-header,
 * data-dr-human-body, data-dr-footer, data-dr-act (toggle-edit | accept | reject | reconsider | accept-all |
 * keep-mine), data-dr-i (the number of the hunk a button belongs to), data-dr-input.
 */
(function (global) {
  'use strict';
  if (global.KuiDraftView) return;
  var M = global.KuiDraftModel;
  var C = M.CLASSES;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function icon(name, cls) { return '<i class="fa-solid fa-' + name + ' ' + cls + '" aria-hidden="true"></i>'; }
  function heightOf(ctx) { return ctx.minHeight === 0 ? '0' : ctx.minHeight + 'px'; }

  /** Fills ctx.d from the texts and the rejected keys. Returns ctx. */
  function prepare(ctx) {
    ctx.d = M.derive(ctx.value, ctx.aiDraft, ctx.rejected);
    return ctx;
  }

  function num(n) { return '<sup aria-hidden="true" class="' + C.num + '">' + n + '</sup>'; }

  function aiHunk(ctx, h) {
    var rejected = ctx.d.isRejected(h);
    var active = ctx.activeKey === h.key;
    return '<span data-hunk="' + esc(h.key) + '"' + (rejected ? ' data-rejected="true"' : '') + ' class="' + C.aiHunk(rejected, active) + '">' +
      num(ctx.d.indexOf(h)) + (h.ai ? esc(h.ai) : '<em class="' + C.emptySide + '">' + esc(ctx.msg.removed) + '</em>') + '</span>';
  }

  function humanHunk(ctx, h) {
    var d = ctx.d, msg = ctx.msg;
    var rejected = d.isRejected(h);
    var active = ctx.activeKey === h.key;
    var index = d.indexOf(h);
    var sum = M.summary(msg, h);
    var strike = !rejected && h.ai ? ' class="' + C.humanStrike + '"' : '';
    var out = '<span role="group" aria-label="' + esc(M.fillMessage(msg.changeLabel, { index: index, total: d.hunks.length })) + '" data-hunk="' + esc(h.key) + '"' +
      (rejected ? ' data-rejected="true"' : '') + ' class="' + C.humanHunk(rejected, active) + '">' + num(index) +
      '<span' + strike + '>' + (h.human ? esc(h.human) : '<em class="' + C.emptySide + '">' + esc(msg.nothing) + '</em>') + '</span>';
    if (rejected) out += '<span class="' + C.rejectedNote + '">(' + esc(msg.rejected) + ')</span>';
    if (!ctx.readOnly) {
      out += '<span class="' + C.chips + '">';
      if (rejected) {
        out += '<button type="button" aria-label="' + esc(M.fillMessage(msg.reconsiderAria, { index: index, summary: sum })) + '" class="' + C.chipReconsider + '" data-dr-act="reconsider" data-dr-i="' + index + '">' +
          icon('rotate-left', C.chipIcon) + esc(msg.reconsider) + '</button>';
      } else {
        out += '<button type="button" aria-label="' + esc(M.fillMessage(msg.acceptAria, { index: index, summary: sum })) + '" class="' + C.chipAccept + '" data-dr-act="accept" data-dr-i="' + index + '">' +
          icon('check', C.chipIcon) + esc(msg.accept) + '</button>' +
          '<button type="button" aria-label="' + esc(M.fillMessage(msg.rejectAria, { index: index, summary: sum })) + '" class="' + C.chipReject + '" data-dr-act="reject" data-dr-i="' + index + '">' +
          icon('xmark', C.chipIcon) + esc(msg.reject) + '</button>';
      }
      out += '</span>';
    }
    return out + '</span>';
  }

  /** The AI panel's text: the draft with every hunk marked. */
  function aiBody(ctx) {
    var out = '<div class="' + C.body + '" style="min-height: ' + heightOf(ctx) + '" data-dr-ai-body>';
    ctx.d.segments.forEach(function (s) { out += s.type === 'equal' ? '<span>' + esc(s.text) + '</span>' : aiHunk(ctx, s.hunk); });
    return out + '</div>';
  }

  /** The human panel's header: the title and the edit toggle. */
  function humanHeader(ctx) {
    var msg = ctx.msg;
    var editing = ctx.editing && !ctx.readOnly;
    var out = '<header class="' + C.panelHeader + '" data-dr-human-header><h3 id="' + esc(ctx.uid) + '-human" class="' + C.panelTitle + '">' + esc(msg.humanPanel) + '</h3>';
    if (!ctx.readOnly) {
      out += '<button type="button" aria-pressed="' + (editing ? 'true' : 'false') + '" class="' + (editing ? C.ghostOn : C.ghost) + '" data-dr-act="toggle-edit">' +
        icon('pen-to-square', C.editButtonIcon) + esc(editing ? msg.review : msg.edit) + '</button>';
    }
    return out + '</header>';
  }

  /** The human panel's text: the person's text with every hunk marked, or the textarea while editing. */
  function humanBody(ctx) {
    if (ctx.editing && !ctx.readOnly) {
      // The parser drops one newline right after <textarea>; React writes a second one to keep a leading newline.
      var v = String(ctx.value);
      return '<textarea aria-label="' + esc(ctx.msg.editorLabel) + '" class="' + C.textarea + '" style="min-height: ' + heightOf(ctx) + '" data-dr-input data-dr-human-body>' +
        (v.charAt(0) === '\n' ? '\n' : '') + esc(v) + '</textarea>';
    }
    var out = '<div class="' + C.body + '" style="min-height: ' + heightOf(ctx) + '" data-dr-human-body>';
    ctx.d.segments.forEach(function (s) { out += s.type === 'equal' ? '<span>' + esc(s.text) + '</span>' : humanHunk(ctx, s.hunk); });
    return out + '</div>';
  }

  /** The line under the panels: how many changes are pending, keep mine and accept all. */
  function footer(ctx) {
    var msg = ctx.msg, d = ctx.d;
    var text = d.hunks.length === 0 ? msg.identical : d.pending.length === 0 ? msg.noPending : M.fillMessage(msg.pending, { count: d.pending.length });
    var out = '<div class="' + C.footer + '" data-dr-footer><p class="' + C.pending + '" data-part="pending">' + esc(text) + '</p>';
    if (!ctx.readOnly && d.pending.length > 0) {
      out += '<div class="' + C.footerButtons + '">' +
        '<button type="button" class="' + C.ghost + '" data-dr-act="keep-mine">' + icon('xmark', C.footerIcon) + esc(msg.keepMine) + '</button>' +
        '<button type="button" class="' + C.primary + '" data-dr-act="accept-all">' + icon('check', C.footerIcon) + esc(msg.acceptAll) + '</button></div>';
    }
    return out + '</div>';
  }

  function aiPanel(ctx) {
    var msg = ctx.msg;
    var badge = ctx.model ? M.fillMessage(msg.aiBadgeModel, { model: ctx.model }) : msg.aiBadge;
    return '<section aria-labelledby="' + esc(ctx.uid) + '-ai" class="' + C.panel + '"><header class="' + C.panelHeader + '"><h3 id="' + esc(ctx.uid) + '-ai" class="' + C.panelTitle + '">' + esc(msg.aiPanel) + '</h3>' +
      '<span data-part="ai-badge" class="' + C.badge + '">' + icon('wand-magic-sparkles', C.badgeIcon) + esc(badge) + '</span></header>' + aiBody(ctx) + '</section>';
  }

  function humanPanel(ctx) {
    return '<section aria-labelledby="' + esc(ctx.uid) + '-human" class="' + C.panel + '">' + humanHeader(ctx) + humanBody(ctx) + '</section>';
  }

  /** Everything inside the root element. */
  function inner(ctx) {
    prepare(ctx);
    return '<div class="' + C.grid + '">' + aiPanel(ctx) + humanPanel(ctx) + '</div>' + footer(ctx) +
      '<div class="' + C.status + '" role="status" aria-live="polite" data-dr-status>' + esc(ctx.announce || '') + '</div>';
  }

  var api = { esc: esc, prepare: prepare, aiBody: aiBody, humanHeader: humanHeader, humanBody: humanBody, footer: footer, inner: inner, heightOf: heightOf };
  global.KuiDraftView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
