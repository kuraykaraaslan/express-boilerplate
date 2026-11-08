/*
 * modules/ui/DescriptionList/scripts/description-list.js
 *
 * Behaviour of DescriptionList: the copy buttons. A click writes the button's data-dl-copy text to the clipboard,
 * then shows the check icon and the "copied" label for 1.5 s, like kui-react's CopyButton.
 *
 * Idempotent: window.KuiDescriptionList.autoInit() mounts every [data-dl-root] once.
 */
(function (global) {
  'use strict';
  if (global.KuiDescriptionList) return;

  function setDone(root, button, done) {
    var label = root.getAttribute(done ? 'data-dl-copied-label' : 'data-dl-copy-label') || '';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    var icon = button.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-check', done);
      icon.classList.toggle('fa-copy', !done);
    }
  }

  function mount(root) {
    root.addEventListener('click', function (e) {
      var button = e.target && e.target.closest ? e.target.closest('[data-dl-copy]') : null;
      if (!button || !root.contains(button)) return;
      var clipboard = global.navigator && global.navigator.clipboard;
      if (!clipboard || !clipboard.writeText) return;
      clipboard.writeText(button.getAttribute('data-dl-copy') || '').then(function () {
        setDone(root, button, true);
        clearTimeout(button.__kuiDlTimer);
        button.__kuiDlTimer = setTimeout(function () { setDone(root, button, false); }, 1500);
      }, function () {});
    });
  }

  function autoInit(scope) {
    var nodes = (scope || document).querySelectorAll('[data-dl-root]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__kuiDlMounted) continue;
      nodes[i].__kuiDlMounted = true;
      mount(nodes[i]);
    }
  }

  global.KuiDescriptionList = { autoInit: autoInit, mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
