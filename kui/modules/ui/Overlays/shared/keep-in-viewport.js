<script>
/*
 * Keeps an open overlay panel (a menu, a popover) inside the part of the page the viewer can see
 * (EJS parity with kui-react useKeepInViewport). Whatever placed the panel, it is measured once it
 * shows and, when an edge would leave the visible area, shifted back with the CSS `translate`
 * property and capped at the visible width minus the margins. The visible area is the visual
 * viewport where the browser has one (a pinch-zoomed phone, a page wider than the screen).
 *
 * window.__keepInViewport(panel) fits the shown panel and follows resize / scroll; it returns a
 * stop function that removes the listeners and the correction. Call it after un-hiding the panel.
 */
(function () {
  if (window.__keepInViewport) return;
  var MARGIN = 8;
  window.__keepInViewport = function (el) {
    if (!el) return function () {};
    var vv = window.visualViewport;
    function fit() {
      var left = vv ? vv.offsetLeft : 0;
      var width = vv ? vv.width : document.documentElement.clientWidth;
      el.style.translate = '';
      el.style.maxWidth = Math.max(0, width - 2 * MARGIN) + 'px';
      var r = el.getBoundingClientRect();
      var dx = 0;
      if (r.right > left + width - MARGIN) dx = left + width - MARGIN - r.right;
      if (r.left + dx < left + MARGIN) dx = left + MARGIN - r.left;
      if (dx !== 0) el.style.translate = Math.round(dx) + 'px 0';
    }
    if (el.__kivStop) el.__kivStop();
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    var ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    if (ro) ro.observe(el);
    el.__kivStop = function () {
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit, true);
      if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
      if (ro) ro.disconnect();
      el.style.translate = '';
      el.style.maxWidth = '';
      el.__kivStop = null;
    };
    return el.__kivStop;
  };
})();
</script>
