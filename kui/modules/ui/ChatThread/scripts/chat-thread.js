/*
 * modules/ui/ChatThread/scripts/chat-thread.js
 *
 * Behaviour of ChatThread (kui-react modules/ui/ChatThread): the reading position and the host's ways to change the
 * thread. The server draws the thread; this file
 *   - sticks the log to the bottom while the reader is there, and once they scroll up counts the new messages behind a
 *     "New messages (n)" button (kui-react's rules: their own new message scrolls down, a swapped list starts at the
 *     bottom again, a page of older messages keeps the line they were reading);
 *   - runs "Load older": notes the distance from the bottom, calls the root's data-chat-older-fn global and emits
 *     'kui:chat-load-older'; the host answers with update();
 *   - runs the message actions: calls the button's data-chat-fn global with (messageId, actionId) and emits
 *     'kui:chat-action' { messageId, actionId }.
 *
 * API (window.KuiChatThread):
 *   update(root, html)          the HTML of a freshly rendered ChatThread (or of its log): the log's content is replaced
 *   append(root, message)       { id, side, author: { name, avatarUrl? }, body (text), at?, time?, delivery? }: a text
 *                               message drawn from the thread's own templates, grouped like the server groups (no day
 *                               separator; use update() for those, attachments and actions)
 *   setTyping(root, label, who) the typing row ("Ada is typing…"; null removes it); `who` = { name, avatarUrl? }
 *   setBody(root, id, text, { pending }) a message's text; `pending` is kui-react's streamed reply (typing dots while
 *                               empty, then a caret, and the article busy), so a reply can grow in place
 *   autoInit(scope), mount(root)
 * Idempotent: autoInit() mounts every [data-chat-root] once.
 */
(function (global) {
  'use strict';
  if (global.KuiChatThread) return;

  var GROUP_WINDOW_MS = 5 * 60 * 1000;

  function fill(t, v) { return String(t || '').replace(/\{(\w+)\}/g, function (a, k) { return k in v ? String(v[k]) : a; }); }
  function logOf(root) { return root.querySelector('[data-chat-log]'); }
  function state(root) { return root.__kuiChat || (root.__kuiChat = { atBottom: true, unseen: 0, anchor: null }); }
  function articles(root) { return logOf(root).querySelectorAll('article[data-message-id]'); }
  function threshold(root) { var n = parseFloat(root.getAttribute('data-chat-stick')); return isNaN(n) ? 48 : n; }
  function isBottom(root) { var el = logOf(root); return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold(root); }
  function toEnd(root, smooth) {
    var el = logOf(root);
    if (smooth && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  }
  function initials(name) {
    return String(name || '').trim().split(/\s+/).map(function (w) { return w[0] || ''; }).slice(0, 2).join('').toUpperCase() || '?';
  }

  function renderJump(root) {
    var s = state(root);
    var wrap = root.querySelector('[data-chat-jump]');
    if (!wrap) return;
    wrap.hidden = !(s.unseen > 0 && !s.atBottom);
    var text = wrap.querySelector('[data-chat-jump-text]');
    if (text) text.textContent = fill(root.getAttribute('data-chat-new'), { count: s.unseen });
  }

  function snapshot(root) {
    var a = articles(root);
    return { first: a[0] ? a[0].getAttribute('data-message-id') : undefined, last: a.length ? a[a.length - 1].getAttribute('data-message-id') : undefined };
  }

  /** kui-react's rules after the list changed (its `lastId` block and its layout effect). */
  function afterChange(root, before) {
    var s = state(root);
    var el = logOf(root);
    var a = articles(root);
    var lastEl = a.length ? a[a.length - 1] : null;
    var last = lastEl ? lastEl.getAttribute('data-message-id') : undefined;
    var first = a[0] ? a[0].getAttribute('data-message-id') : undefined;
    if (last !== before.last) {
      var appended = false;
      if (before.last !== undefined) for (var i = 0; i < a.length; i++) if (a[i].getAttribute('data-message-id') === before.last) appended = true;
      if (!appended || (lastEl && lastEl.getAttribute('data-chat-side') === 'own')) { s.atBottom = true; s.unseen = 0; }
      else if (!s.atBottom) s.unseen += 1;
    }
    if (s.anchor !== null && first !== before.first) {
      el.scrollTop = el.scrollHeight - s.anchor;
      s.anchor = null;
    } else if (s.atBottom) {
      toEnd(root);
    }
    renderJump(root);
  }

  function update(root, html) {
    var before = snapshot(root);
    var holder = document.createElement('template');
    holder.innerHTML = html;
    var freshLog = holder.content.querySelector('[data-chat-log]');
    var fresh = freshLog || holder.content;
    var el = logOf(root);
    while (el.firstChild) el.removeChild(el.firstChild);
    while (fresh.firstChild) el.appendChild(fresh.firstChild);
    if (freshLog) {
      ['aria-busy', 'aria-label'].forEach(function (name) {
        if (freshLog.hasAttribute(name)) el.setAttribute(name, freshLog.getAttribute(name)); else el.removeAttribute(name);
      });
    }
    afterChange(root, before);
  }

  function template(root, kind) {
    var t = root.querySelector('template[data-chat-template="' + kind + '"]');
    return t && t.content.firstElementChild ? t.content.firstElementChild.cloneNode(true) : null;
  }

  function avatarBoxOf(node) {
    var box = node.firstElementChild;
    return box && box.classList.contains('w-8') ? box : null;
  }

  function setAvatar(box, author) {
    if (!box) return;
    var img = box.querySelector('img');
    var span = box.querySelector('span');
    if (author.avatarUrl) {
      if (!img) {
        img = document.createElement('img');
        img.className = 'h-8 w-8 text-xs rounded-full object-cover border border-border shrink-0';
        if (span) box.replaceChild(img, span); else box.appendChild(img);
      }
      img.setAttribute('src', author.avatarUrl);
      img.setAttribute('alt', author.name || '?');
    } else if (span) {
      span.setAttribute('aria-label', author.name || '?');
      span.textContent = initials(author.name);
    }
  }

  function append(root, message) {
    if (!message || message.id == null) return;
    var side = message.side === 'own' || message.side === 'system' ? message.side : 'other';
    var node = template(root, side);
    if (!node) return;
    var before = snapshot(root);
    var el = logOf(root);
    var author = message.author || { name: '' };
    var at = message.at != null ? new Date(message.at) : new Date();
    var valid = !isNaN(at.getTime());
    var time = message.time != null ? message.time : valid ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(at) : '';

    // The empty line goes once there is a message: the default one, an emptyPartial root marked data-chat-empty, or
    // the bare emptyMessage text.
    Array.prototype.slice.call(el.querySelectorAll('[data-chat-empty]')).forEach(function (n) { n.parentNode.removeChild(n); });
    Array.prototype.slice.call(el.childNodes).forEach(function (n) { if (n.nodeType === 3 && n.nodeValue.trim()) el.removeChild(n); });

    var a = articles(root);
    var prev = a.length ? a[a.length - 1] : null;
    var grouped = Boolean(root.getAttribute('data-chat-group') !== 'false' && side !== 'system' && prev &&
      prev.getAttribute('data-chat-side') === side && prev.getAttribute('data-chat-author') === author.name && valid &&
      prev.hasAttribute('data-chat-at') && at.getTime() - Number(prev.getAttribute('data-chat-at')) <= GROUP_WINDOW_MS);

    node.setAttribute('data-message-id', String(message.id));
    node.setAttribute('aria-label', fill(root.getAttribute('data-chat-label-template'), { author: author.name, time: time }));
    if (side !== 'system') {
      node.setAttribute('data-chat-author', author.name);
      if (valid) node.setAttribute('data-chat-at', String(at.getTime())); else node.removeAttribute('data-chat-at');
    }
    var bubble = side === 'system' ? node.firstElementChild : node.querySelector('[data-part="bubble"]');
    if (bubble) bubble.textContent = message.body == null ? '' : String(message.body);
    var timeEl = node.querySelector('time');
    if (timeEl) {
      if (time) {
        timeEl.textContent = time;
        if (valid) timeEl.setAttribute('datetime', at.toISOString()); else timeEl.removeAttribute('datetime');
      } else timeEl.parentNode.removeChild(timeEl);
    }
    if (side === 'own') {
      var tick = node.querySelector('.sr-only');
      var tickBox = tick ? tick.parentNode : null;
      if (tickBox && !message.delivery) tickBox.parentNode.removeChild(tickBox);
      else if (tickBox) {
        var icon = tickBox.querySelector('i');
        if (icon) {
          icon.classList.toggle('fa-check', message.delivery === 'sent');
          icon.classList.toggle('fa-check-double', message.delivery !== 'sent');
          icon.classList.toggle('text-info', message.delivery === 'read');
          icon.classList.toggle('text-text-disabled', message.delivery !== 'read');
        }
        var words = JSON.parse(root.getAttribute('data-chat-delivery') || '{}');
        if (words[message.delivery]) tick.textContent = words[message.delivery];
      }
    }
    if (side !== 'system') {
      var name = node.querySelector('p');
      if (name) { if (grouped) name.parentNode.removeChild(name); else name.textContent = author.name; }
      var box = avatarBoxOf(node);
      if (box) {
        if (grouped) {
          box.classList.add('invisible');
          box.setAttribute('aria-hidden', 'true');
          while (box.firstChild) box.removeChild(box.firstChild);
        } else setAvatar(box, author);
      }
      if (grouped) { node.classList.remove('mt-3'); node.classList.add('mt-0.5'); }
      // A meta row left without content goes, as kui-react draws none.
      var meta = node.querySelector('.tabular-nums.mt-1');
      if (meta && !meta.firstElementChild && !meta.textContent.trim()) meta.parentNode.removeChild(meta);
    } else {
      var p = node.querySelector('p');
      if (p && !p.firstElementChild && !p.textContent.trim()) p.parentNode.removeChild(p);
    }
    var typing = el.querySelector('[data-part="typing"]');
    if (typing) el.insertBefore(node, typing); else el.appendChild(node);
    afterChange(root, before);
  }

  function setTyping(root, label, who) {
    var el = logOf(root);
    var old = el.querySelector('[data-part="typing"]');
    if (old) old.parentNode.removeChild(old);
    if (label) {
      var node = template(root, 'typing');
      if (!node) return;
      var text = node.querySelector('[data-chat-typing-label]');
      if (text) text.textContent = label;
      setAvatar(avatarBoxOf(node), who || { name: '?' });
      el.appendChild(node);
    }
    if (state(root).atBottom) toEnd(root);
  }

  function setBody(root, id, text, opts) {
    var article = logOf(root).querySelector('article[data-message-id="' + String(id).replace(/["\\]/g, '\\$&') + '"]');
    if (!article) return;
    var bubble = article.querySelector('[data-part="bubble"]');
    if (!bubble) return;
    var pending = Boolean(opts && opts.pending);
    var value = text == null ? '' : String(text);
    while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
    if (pending && !value) {
      var dots = template(root, 'typing');
      var source = dots ? dots.querySelector('.animate-pulse') : null;
      if (source && source.parentNode) {
        var row = source.parentNode.cloneNode(true);
        row.classList.add('py-1.5', 'opacity-70');
        bubble.appendChild(row);
      }
    } else {
      bubble.appendChild(document.createTextNode(value));
      if (pending) {
        var caret = document.createElement('span');
        caret.setAttribute('aria-hidden', 'true');
        caret.className = 'ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-current opacity-60';
        bubble.appendChild(caret);
      }
    }
    if (pending) {
      var sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = root.getAttribute('data-chat-writing') || '';
      bubble.appendChild(sr);
      article.setAttribute('aria-busy', 'true');
    } else article.removeAttribute('aria-busy');
    if (state(root).atBottom) toEnd(root);
  }

  function mount(root) {
    var el = logOf(root);
    if (!el) return;
    el.addEventListener('scroll', function () {
      var s = state(root);
      var bottom = isBottom(root);
      s.atBottom = bottom;
      if (bottom) s.unseen = 0;
      renderJump(root);
    });
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var older = t.closest('[data-chat-older]');
      if (older && root.contains(older)) {
        state(root).anchor = el.scrollHeight - el.scrollTop;
        var fn = root.getAttribute('data-chat-older-fn');
        if (fn && typeof global[fn] === 'function') global[fn]();
        root.dispatchEvent(new CustomEvent('kui:chat-load-older', { bubbles: true }));
        return;
      }
      var jump = t.closest('[data-chat-jump] button');
      if (jump && root.contains(jump)) {
        var s = state(root);
        s.unseen = 0;
        s.atBottom = true;
        renderJump(root);
        toEnd(root, true);
        return;
      }
      var action = t.closest('[data-chat-action]');
      if (action && root.contains(action) && !action.disabled) {
        var detail = { messageId: action.getAttribute('data-chat-message'), actionId: action.getAttribute('data-chat-action') };
        var name = action.getAttribute('data-chat-fn');
        if (name && typeof global[name] === 'function') global[name](detail.messageId, detail.actionId);
        root.dispatchEvent(new CustomEvent('kui:chat-action', { bubbles: true, detail: detail }));
      }
    });
    toEnd(root);
  }

  function autoInit(scope) {
    var nodes = (scope || document).querySelectorAll('[data-chat-root]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__kuiChatMounted) continue;
      nodes[i].__kuiChatMounted = true;
      mount(nodes[i]);
    }
  }

  global.KuiChatThread = { autoInit: autoInit, mount: mount, update: update, append: append, setTyping: setTyping, setBody: setBody };
})(typeof window !== 'undefined' ? window : globalThis);
