// Open / close / nav wiring for the command palette.
// Parity with hooks/useShortcuts.ts. M1 scope.
(function () {
  // Re-define filter + nav handlers; preserve back-compat names from
  // the legacy AppCommandBar.ejs so existing inline handlers keep firing.
  // Lists the commands registered at runtime (window.__KuiCmdStore) next to the palette's
  // own items: same markup as partials/_item.ejs, placed by group rank and order.
  function syncRegistered(id) {
    var list = document.getElementById(id + '-list');
    var store = window.__KuiCmdStore;
    if (!list || !store) return;
    Array.prototype.forEach.call(list.querySelectorAll('[data-cmd-registered]'), function (el) { el.parentNode.removeChild(el); });
    Array.prototype.forEach.call(list.querySelectorAll('.cmd-category[data-cmd-registered-group]'), function (el) {
      if (!el.querySelector('[data-cmd-item]')) el.parentNode.removeChild(el);
    });
    var badgeCls = 'inline-flex items-center gap-1 rounded-full font-medium bg-surface-sunken text-text-secondary px-1.5 py-0 text-[10px]';
    var ord = function (c) { return (typeof c.order === 'number' && isFinite(c.order)) ? c.order : 0; };
    var empty = document.getElementById(id + '-empty');
    store.all().forEach(function (cmd, n) {
      if (!cmd || cmd.hidden) return;
      if (cmd.id && list.querySelector('[data-cmd-id="' + String(cmd.id).replace(/"/g, '') + '"]:not([data-cmd-registered])')) return;
      var group = store.groupOf(cmd);
      var cat = Array.prototype.filter.call(list.querySelectorAll('.cmd-category'), function (c) { return c.getAttribute('data-category') === group; })[0];
      if (!cat) {
        cat = document.createElement('div');
        cat.className = 'cmd-category';
        cat.setAttribute('data-category', group);
        cat.setAttribute('data-rank', String(ord(cmd)));
        cat.setAttribute('data-cmd-registered-group', '');
        var head = document.createElement('div');
        head.className = 'flex items-center gap-2 mb-1 px-4 pt-2';
        var badge = document.createElement('span');
        badge.className = badgeCls;
        badge.textContent = group;
        head.appendChild(badge);
        cat.appendChild(head);
        var after = Array.prototype.filter.call(list.querySelectorAll('.cmd-category'), function (c) {
          return Number(c.getAttribute('data-rank') || 0) > ord(cmd);
        })[0];
        list.insertBefore(cat, after || empty || null);
      } else if (cat.hasAttribute('data-cmd-registered-group')) {
        cat.setAttribute('data-rank', String(Math.min(Number(cat.getAttribute('data-rank') || 0), ord(cmd))));
      }
      var el = document.createElement(cmd.href ? 'a' : 'button');
      if (cmd.href) el.setAttribute('href', cmd.href); else el.setAttribute('type', 'button');
      el.id = id + '-opt-r-' + n;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', 'false');
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-cmd-item', '');
      el.setAttribute('data-cmd-registered', store.key(cmd));
      el.setAttribute('data-label', String(cmd.label || '').toLowerCase());
      el.setAttribute('data-keywords', (cmd.keywords || []).join(' ').toLowerCase());
      el.setAttribute('data-category', group.toLowerCase());
      el.setAttribute('data-order', String(ord(cmd)));
      el.className = 'cmd-item flex w-full items-center justify-between gap-3 px-4 py-2 text-sm transition-colors text-text-primary hover:bg-surface-overlay focus:bg-surface-overlay outline-none';
      var left = document.createElement('span');
      left.className = 'flex items-center gap-2 min-w-0';
      if (cmd.icon) {
        var i = document.createElement('i');
        i.className = cmd.icon + ' w-4 text-center text-text-disabled shrink-0';
        i.style.fontSize = '0.875rem';
        i.setAttribute('aria-hidden', 'true');
        left.appendChild(i);
      }
      var lbl = document.createElement('span');
      lbl.className = 'truncate cmd-item-label';
      lbl.setAttribute('data-original-label', cmd.label || '');
      lbl.textContent = cmd.label || '';
      left.appendChild(lbl);
      el.appendChild(left);
      if (cmd.shortcut) {
        var sc = document.createElement('span');
        sc.className = badgeCls + ' shrink-0';
        sc.textContent = cmd.shortcut;
        el.appendChild(sc);
      }
      var before = Array.prototype.filter.call(cat.querySelectorAll('[data-cmd-item]'), function (it) {
        return Number(it.getAttribute('data-order') || 0) > ord(cmd);
      })[0];
      cat.insertBefore(el, before || null);
    });
  }
  window.__KuiCmdSync = syncRegistered;

  function openCmdBar(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    syncRegistered(id);
    modal.classList.remove('hidden');
    // activate() captures the pre-open focus target (for restore on
    // close), pushes this dialog onto the shared layer stack, and
    // focuses the first focusable element in it — overridden a moment
    // later below, since the search input (not the header's "Esc"
    // close button, which comes first in the DOM) is the intended
    // initial focus target here.
    if (window.__overlayFocusTrap) window.__overlayFocusTrap.activate(id, modal);
    var input = document.getElementById(id + '-input');
    if (input) { input.value = ''; window.cmdBarFilter(id, ''); setTimeout(function(){ input.focus(); }, 10); }
    document.body.style.overflow = 'hidden';
  }

  function closeCmdBar(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    if (window.__overlayFocusTrap) window.__overlayFocusTrap.deactivate(id);
  }

  function setActive(list, items, nextIdx) {
    items.forEach(function (el, i) {
      var on = i === nextIdx;
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        el.classList.add('bg-surface-overlay');
        el.focus({ preventScroll: false });
      } else {
        el.classList.remove('bg-surface-overlay');
      }
    });
    if (items[nextIdx]) {
      var input = document.getElementById(list.id.replace('-list', '-input'));
      if (input) input.setAttribute('aria-activedescendant', items[nextIdx].id);
    }
  }

  window.cmdBarFilter = function (id, query) {
    var q = String(query || '').trim();
    var list = document.getElementById(id + '-list');
    if (!list) return;
    var items = list.querySelectorAll('[data-cmd-item]');
    var categories = list.querySelectorAll('.cmd-category');
    var visible = [];
    var fuzzy = window.__KuiCmdFuzzy;

    items.forEach(function (el) {
      var show = true;
      if (q && fuzzy) {
        var s = fuzzy.scoreItem(el, q);
        if (!s) { show = false; }
        else { fuzzy.highlightLabel(el, s.matches); }
      } else if (q) {
        var lbl = el.getAttribute('data-label') || '';
        show = lbl.indexOf(q.toLowerCase()) !== -1;
      } else if (fuzzy) {
        fuzzy.highlightLabel(el, []);
      }
      el.style.display = show ? '' : 'none';
      el.setAttribute('aria-selected', 'false');
      el.classList.remove('bg-surface-overlay');
      if (show) visible.push(el);
    });

    categories.forEach(function (cat) {
      var any = Array.prototype.some.call(
        cat.querySelectorAll('[data-cmd-item]'),
        function (el) { return el.style.display !== 'none'; }
      );
      cat.style.display = any ? '' : 'none';
    });

    var empty = document.getElementById(id + '-empty');
    if (empty) {
      var showEmpty = visible.length === 0;
      empty.classList.toggle('hidden', !showEmpty);
      var qSpan = empty.querySelector('[data-cmd-empty-q]');
      if (qSpan) qSpan.textContent = query;
    }

    // Mark the first visible item active for combobox semantics.
    if (visible.length) {
      visible.forEach(function (el, i) { el.setAttribute('aria-selected', i === 0 ? 'true' : 'false'); });
      visible[0].classList.add('bg-surface-overlay');
      var input = document.getElementById(id + '-input');
      if (input) input.setAttribute('aria-activedescendant', visible[0].id);
    } else {
      var input2 = document.getElementById(id + '-input');
      if (input2) input2.removeAttribute('aria-activedescendant');
    }
  };

  window.cmdBarKeyNav = function (e, id) {
    var modal = document.getElementById(id);
    var ft = window.__overlayFocusTrap;
    if (ft && modal) ft.handleKey(id, modal, e);
    var list = document.getElementById(id + '-list');
    if (!list) return;
    if (e.key === 'Escape') { closeCmdBar(id); return; }
    var items = Array.prototype.filter.call(
      list.querySelectorAll('[data-cmd-item]'),
      function (el) { return el.style.display !== 'none'; }
    );
    if (!items.length) return;
    var idx = items.findIndex(function (el) { return el.getAttribute('aria-selected') === 'true'; });
    if (idx < 0) idx = 0;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(list, items, (idx + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(list, items, (idx - 1 + items.length) % items.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(list, items, 0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(list, items, items.length - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      var active = items[idx] || items[0];
      if (active) {
        active.click();
        closeCmdBar(id);
      }
    }
  };

  // Trigger / close / ⌘K wiring (registered once globally).
  if (!window.__KuiCmdShortcutsBound) {
    window.__KuiCmdShortcutsBound = true;

    document.addEventListener('click', function (e) {
      var registered = e.target.closest('[data-cmd-registered]');
      if (registered && window.__KuiCmdStore) {
        var k = registered.getAttribute('data-cmd-registered');
        var cmd = window.__KuiCmdStore.all().filter(function (c) { return window.__KuiCmdStore.key(c) === k; })[0];
        var bar = registered.closest('[role="dialog"][id^="cmd-bar-"]');
        if (cmd && typeof cmd.onClick === 'function') cmd.onClick(cmd);
        if (bar) closeCmdBar(bar.id);
        return;
      }
      var trigger = e.target.closest('[data-cmd-trigger]');
      if (trigger) { openCmdBar(trigger.getAttribute('data-cmd-trigger')); return; }
      var closeBtn = e.target.closest('[data-cmd-close]');
      if (closeBtn) { closeCmdBar(closeBtn.getAttribute('data-cmd-close')); return; }
      var sug = e.target.closest('[data-cmd-suggest]');
      if (sug) {
        var modal = sug.closest('[role="dialog"][id^="cmd-bar-"]');
        if (modal) {
          var input = document.getElementById(modal.id + '-input');
          if (input) {
            input.value = sug.getAttribute('data-suggest-label') || '';
            window.cmdBarFilter(modal.id, input.value);
            input.focus();
          }
        }
      }
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        var bars = document.querySelectorAll('[role="dialog"][id^="cmd-bar-"]');
        bars.forEach(function (bar) {
          if (bar.tagName !== 'DIV') return;
          var isOpen = !bar.classList.contains('hidden');
          if (isOpen) closeCmdBar(bar.id); else openCmdBar(bar.id);
        });
      }
      if (e.key === 'Escape') {
        document.querySelectorAll('[role="dialog"][id^="cmd-bar-"]').forEach(function (bar) {
          if (!bar.classList.contains('hidden')) closeCmdBar(bar.id);
        });
      }
    });
  }
})();
