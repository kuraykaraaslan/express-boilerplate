/* =========================================================
   popup-overlays.js — orchestrates the attach* helpers from
   bubble-menu, emoji-picker, suggestion-popup, image-overlay
   for a single editor instance. Parallel of PopupOverlays.tsx.
   Exposes K.attachAllPopups(ctx).
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  K.attachAllPopups = function (ctx) {
    K.attachBubbleMenu(ctx);
    K.attachEmojiPicker(ctx);
    K.attachImageOverlay(ctx);
    K.attachPopupOrchestrator(ctx);
  };
})();
