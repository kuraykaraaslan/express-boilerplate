/*
 * modules/ui/ConversationTimeline/scripts/conversation-timeline.js
 *
 * Behaviour of ConversationTimeline: the "Show details" / "Hide details" buttons. The server draws every step with
 * its details panel hidden or open; this file only toggles a panel, swaps the button text and turns the chevron.
 *
 * Idempotent: window.KuiConversationTimeline.autoInit() mounts every [data-ct-root] once.
 * Event on the root (bubbles):
 *   kui:conversation-expanded-change   { ids }    the expanded step ids after a click (React: onExpandedChange)
 * A root with data-ct-controlled (the `expandedIds` local) only emits the event and leaves the panel alone, like a
 * controlled React component; the host answers with KuiConversationTimeline.setExpanded(root, ids).
 */
(function (global) {
  'use strict';
  if (global.KuiConversationTimeline) return;

  var CLOSED = ['-rotate-90', 'rtl:rotate-90'];

  function buttons(root) { return Array.prototype.slice.call(root.querySelectorAll('[data-ct-toggle]')); }

  function applyState(root, button, open) {
    var panel = document.getElementById(button.getAttribute('aria-controls'));
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (panel) { if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', ''); }
    var icon = button.querySelector('i');
    if (icon) CLOSED.forEach(function (c) { if (open) icon.classList.remove(c); else icon.classList.add(c); });
    // The label is the text node after the icon.
    var label = open ? root.getAttribute('data-ct-hide') : root.getAttribute('data-ct-show');
    for (var n = button.lastChild; n; n = n.previousSibling) {
      if (n.nodeType === 3) { n.nodeValue = label; return; }
    }
    button.appendChild(document.createTextNode(label));
  }

  function expandedIds(root) {
    return buttons(root).filter(function (b) { return b.getAttribute('aria-expanded') === 'true'; })
      .map(function (b) { return b.getAttribute('data-ct-toggle'); });
  }

  function setExpanded(root, ids) {
    buttons(root).forEach(function (b) { applyState(root, b, ids.indexOf(b.getAttribute('data-ct-toggle')) !== -1); });
  }

  function mount(root) {
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-ct-toggle]') : null;
      if (!t || !root.contains(t)) return;
      var id = t.getAttribute('data-ct-toggle');
      var ids = expandedIds(root);
      var next = ids.indexOf(id) !== -1 ? ids.filter(function (x) { return x !== id; }) : ids.concat([id]);
      if (!root.hasAttribute('data-ct-controlled')) applyState(root, t, next.indexOf(id) !== -1);
      root.dispatchEvent(new CustomEvent('kui:conversation-expanded-change', { bubbles: true, detail: { ids: next } }));
    });
  }

  function autoInit(scope) {
    var nodes = (scope || document).querySelectorAll('[data-ct-root]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__kuiCtMounted) continue;
      nodes[i].__kuiCtMounted = true;
      mount(nodes[i]);
    }
  }

  global.KuiConversationTimeline = { autoInit: autoInit, mount: mount, setExpanded: setExpanded };
})(typeof window !== 'undefined' ? window : globalThis);
