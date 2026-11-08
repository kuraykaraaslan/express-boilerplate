// modules/ui/ColorPicker/scripts/eye-dropper.js
// TODO M2: wrap window.EyeDropper() with a Promise + html2canvas fallback.
(function () {
  if (window.KuiColorEyeDropper) return;
  window.KuiColorEyeDropper = {
    supported: typeof window !== 'undefined' && 'EyeDropper' in window,
    pick: function () { return Promise.resolve(null); },
  };
})();
