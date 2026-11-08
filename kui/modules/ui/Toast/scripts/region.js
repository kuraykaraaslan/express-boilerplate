<%# modules/ui/Toast/scripts/region.js %>
<%#
  Optional per-page region bootstrapping helper. Most pages don't need this
  — `scripts/store.js` lazily creates regions when `window.toast(...)` fires.
  But preview pages or pages that want stable mount points can include this
  partial after one or more `partials/_region.ejs` blocks; this script just
  makes sure each region exists in the registry the store consults.

  M1 milestone — see PLANS/26-Toast.md.
%>
<script>
(function () {
  if (window.__toastRegionInit) return;
  window.__toastRegionInit = true;

  // Wait for store.js to have set up `window.toast`. If it hasn't yet, defer
  // a tick — the script include order may vary between pages.
  function bootstrap() {
    if (!window.toast) return setTimeout(bootstrap, 0);
    var els = document.querySelectorAll('[data-toast-region]');
    // Touching window.toast is enough — store.js calls getRegion() on demand
    // and reuses existing [data-toast-region] mount points.
    els.forEach(function (el) {
      // No-op: the mere existence of the element is what we need.
      void el;
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
</script>
