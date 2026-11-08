// modules/ui/ColorPicker/scripts/contrast.js
// TODO M4: WCAG relative-luminance + contrast-ratio + AA/AAA classifier.
(function () {
  if (window.KuiColorContrast) return;
  window.KuiColorContrast = {
    relativeLuminance: function (_c) { return 0; },
    contrastRatio: function (_a, _b) { return 1; },
  };
})();
