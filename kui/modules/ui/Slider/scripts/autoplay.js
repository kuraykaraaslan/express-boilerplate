/*
 * modules/ui/Slider/scripts/autoplay.js
 *
 * Interval-based autoplay. Lifted from the original Slider.ejs unchanged
 * so existing consumers keep working byte-for-byte.
 *
 * TODO M3: pause-on-hover, pause-on-focus-within, pause-on-visibility-change.
 */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__kuiSliderAttachAutoplay) return;

  function attachAutoplay(root, api) {
    // api = { getCurrent, getTotal, getLoop, getInterval, getEnabled, isDragging, goTo, stop }
    if (!api.getEnabled()) return null;
    if (api.getTotal() <= 1) return null;

    var timer = setInterval(function () {
      if (api.isDragging()) return;
      var next = api.getCurrent() + 1;
      if (!api.getLoop() && next >= api.getTotal()) {
        clearInterval(timer);
        return;
      }
      api.goTo(next);
    }, api.getInterval());

    return function stop() { clearInterval(timer); };
  }

  window.__kuiSliderAttachAutoplay = attachAutoplay;
})();
