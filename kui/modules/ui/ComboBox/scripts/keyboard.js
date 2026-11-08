/*
 * ComboBox keyboard helpers — mirrors the NextJS keyboard map in
 *   modules/ui/ComboBox/index.tsx (Arrow / Enter / Esc / Home / End / Tab).
 */
(function () {
  if (window.__cbKeyboard) return;
  window.__cbKeyboard = {
    /**
     * Return the next highlight index given direction and disabled-state.
     * @param {Array<HTMLElement>} visibleEls
     * @param {number} currentVisible
     * @param {1|-1} dir
     * @returns {number} new visible index, or -1 if none.
     */
    nextHighlight: function (visibleEls, currentVisible, dir) {
      if (visibleEls.length === 0) return -1;
      var idx = currentVisible;
      for (var i = 0; i < visibleEls.length; i += 1) {
        idx = (idx + dir + visibleEls.length) % visibleEls.length;
        if (!visibleEls[idx].dataset.disabled) return idx;
      }
      return -1;
    },
    /**
     * Return the index of the first / last enabled visible option.
     * @param {Array<HTMLElement>} visibleEls
     * @param {'first'|'last'} where
     */
    edgeHighlight: function (visibleEls, where) {
      if (where === 'first') {
        for (var i = 0; i < visibleEls.length; i += 1) {
          if (!visibleEls[i].dataset.disabled) return i;
        }
      } else {
        for (var j = visibleEls.length - 1; j >= 0; j -= 1) {
          if (!visibleEls[j].dataset.disabled) return j;
        }
      }
      return -1;
    },
  };
})();
