// modules/ui/ColorPicker/scripts/recent.js
// TODO M2: localStorage-backed recent-colors queue (last 12, cross-tab sync).
(function () {
  if (window.KuiColorRecent) return;
  window.KuiColorRecent = {
    list: function () { return []; },
    push: function (_c) { /* TODO M2 */ },
    clear: function () { /* TODO M2 */ },
  };
})();
