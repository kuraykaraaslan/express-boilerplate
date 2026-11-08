/* =========================================================
   store.js — per-instance state container. Plain JS sibling
   of the Zustand store in React's store.ts. Same shape; no
   reactive subscribers (DOM is updated imperatively).
   Exposes K.createStore(initialHtml).
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  var EMPTY_TRIGGER = { open: false, query: '', trigger: -1, pos: null, idx: 0 };

  K.createStore = function (initialHtml) {
    var state = {
      ready: false,
      html: initialHtml || '',
      chars: 0,
      words: 0,
      active: {},

      htmlMode: false,
      htmlSource: '',
      fullscreen: false,

      textColor: null,
      bgColor: null,

      imgOpen: false,
      tableOpen: false,
      emojiOpen: false,
      emojiAnchor: null,

      bubble: { open: false, position: null },
      mention: Object.assign({}, EMPTY_TRIGGER),
      slash:   Object.assign({}, EMPTY_TRIGGER),
      imgSel:  { open: false, el: null, rect: null },
    };

    return {
      state: state,
      getState: function () { return state; },
      set: function (patch) {
        for (var k in patch) state[k] = patch[k];
      },
      // Returns previous value (handy for toggles).
      toggle: function (key) {
        var prev = state[key];
        state[key] = !prev;
        return prev;
      },
      reset: function () {
        state.bubble = { open: false, position: null };
        state.mention = Object.assign({}, EMPTY_TRIGGER);
        state.slash   = Object.assign({}, EMPTY_TRIGGER);
        state.imgSel  = { open: false, el: null, rect: null };
        state.imgOpen = state.tableOpen = state.emojiOpen = false;
      },
    };
  };
})();
