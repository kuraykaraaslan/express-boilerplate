/*
 * modules/ui/Evidence/scripts/evidence.js
 *
 * Behaviour of CitationChip and EvidenceList. The markup is drawn by the server and works without this
 * file (a chip is a same-page anchor, a row highlights through :target); this only turns what React takes as
 * callbacks into bubbling DOM events:
 *   kui:citation-select  { evidenceId }       a cited chip was used (onSelect); the link still works
 *   kui:evidence-open    { id, href }         a row's link or Open button was used (onOpen)
 * and offers KuiEvidence.setActive(listRoot, id | null), the twin of React's `activeId`.
 *
 * Idempotent: loading the file twice changes nothing. Hooks: [data-ev-chip], [data-ev-open].
 */
(function (global) {
  'use strict';
  if (global.KuiEvidence) return;

  var ACTIVE = ['border-primary', 'bg-primary-subtle'];
  var INACTIVE = ['border-border', 'bg-surface-raised'];

  function fire(el, name, detail) {
    el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
  }

  /** Highlight the row whose data-row-id is `id` (null clears), the way `activeId` does in kui-react. */
  function setActive(root, id) {
    var rows = root.querySelectorAll('li[data-kind]');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var on = id != null && row.getAttribute('data-ev-row') === String(id);
      if (on) row.setAttribute('data-active', 'true'); else row.removeAttribute('data-active');
      var add = on ? ACTIVE : INACTIVE;
      var del = on ? INACTIVE : ACTIVE;
      for (var a = 0; a < add.length; a++) row.classList.add(add[a]);
      for (var d = 0; d < del.length; d++) row.classList.remove(del[d]);
    }
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-ev-chip],[data-ev-open]') : null;
    if (!t) return;
    if (t.hasAttribute('data-ev-chip')) fire(t, 'kui:citation-select', { evidenceId: t.getAttribute('data-ev-chip') });
    else fire(t, 'kui:evidence-open', { id: t.getAttribute('data-ev-open'), href: t.getAttribute('href') });
  });

  global.KuiEvidence = { setActive: setActive };
})(window);
