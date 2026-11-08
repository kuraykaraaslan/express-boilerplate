/*
 * modules/ui/Slider/scripts/drag.js
 *
 * M1 — Pointer-based drag with velocity momentum and edge resistance.
 *
 * Mirrors the NextJS hooks/useDrag.ts behaviour byte-for-byte:
 *   - PointerEvent (touch + mouse + pen)
 *   - dragThreshold (default 50 px) below which the gesture snaps back
 *   - velocity momentum (every 0.5 px/ms of release velocity adds one
 *     extra slide of travel)
 *   - edge resistance (×0.4) at the first / last slide in non-loop mode
 *
 * Exposes a single global window.__kuiSliderAttachDrag(root, api).
 *
 * TODO M2: vertical orientation.
 * TODO M5: respect prefers-reduced-motion.
 */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__kuiSliderAttachDrag) return;

  var VELOCITY_PER_EXTRA_SLIDE = 0.5;
  var EDGE_RESISTANCE = 0.4;
  var VELOCITY_SAMPLE_WINDOW_MS = 100;

  function attachDrag(root, api) {
    // api = { getCurrent, getTotal, getLoop, getThreshold, goTo, setOffset, setDragging }
    var track = root.querySelector('[data-slider-track]');
    if (!track) return;

    var startX = 0;
    var samples = [];
    var activePointer = null;

    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (api.getTotal() <= 1) return;
      activePointer = e.pointerId;
      startX = e.clientX;
      samples = [{ x: e.clientX, t: e.timeStamp }];
      api.setDragging(true);
      api.setOffset(0);
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }

    function onMove(e) {
      if (activePointer !== e.pointerId) return;
      var delta = e.clientX - startX;
      var current = api.getCurrent();
      var total = api.getTotal();
      var loop = api.getLoop();
      if (!loop) {
        var atFirst = current === 0 && delta > 0;
        var atLast  = current === total - 1 && delta < 0;
        if (atFirst || atLast) delta *= EDGE_RESISTANCE;
      }
      var now = e.timeStamp;
      samples.push({ x: e.clientX, t: now });
      while (samples.length > 1 && now - samples[0].t > VELOCITY_SAMPLE_WINDOW_MS) {
        samples.shift();
      }
      api.setOffset(delta);
    }

    function onEnd(e) {
      if (activePointer !== e.pointerId) return;
      activePointer = null;
      try { track.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }

      var last = samples[samples.length - 1] || { x: e.clientX, t: e.timeStamp };
      var first = samples[0] || last;
      var totalDelta = e.clientX - startX;
      var dt = Math.max(1, last.t - first.t);
      var velocity = (last.x - first.x) / dt;
      var distance = Math.abs(totalDelta);
      var direction = totalDelta < 0 ? 1 : -1;
      var threshold = api.getThreshold();

      api.setDragging(false);
      api.setOffset(null);
      samples = [];

      if (distance < threshold && Math.abs(velocity) < VELOCITY_PER_EXTRA_SLIDE) return;

      var step = distance >= threshold ? 1 : 0;
      var flickDir = velocity < 0 ? 1 : -1;
      var flickStep = Math.floor(Math.abs(velocity) / VELOCITY_PER_EXTRA_SLIDE);

      var signedStep = direction * step;
      if (flickStep > 0 && flickDir === direction) {
        signedStep = direction * (step + flickStep);
      } else if (flickStep > 0 && step === 0) {
        signedStep = flickDir * flickStep;
      }
      if (signedStep === 0) return;
      api.goTo(api.getCurrent() + signedStep);
    }

    track.addEventListener('pointerdown', onDown);
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onEnd);
    track.addEventListener('pointercancel', onEnd);
  }

  window.__kuiSliderAttachDrag = attachDrag;
})();
