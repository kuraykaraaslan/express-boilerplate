/*
 * ComboBox / MultiSelect filter helpers — mirrors NextJS
 *   modules/ui/ComboBox/hooks/useFilter.ts.
 * Plain functions: callers wire them into the component's option list.
 */
(function () {
  if (window.__cbFilter) return;
  window.__cbFilter = {
    /**
     * Hide / show option <li> elements based on a query string.
     * @param {Array<HTMLElement>} optionEls
     * @param {string} query
     * @param {HTMLElement|null} emptyEl  optional "no results" element
     * @returns {number} number of visible options
     */
    applyFilter: function (optionEls, query, emptyEl) {
      var q = (query || '').trim().toLowerCase();
      var visible = 0;
      for (var i = 0; i < optionEls.length; i += 1) {
        var el = optionEls[i];
        var label = (el.dataset.label || '').toLowerCase();
        var desc  = (el.dataset.description || '').toLowerCase();
        var show = !q || label.indexOf(q) !== -1 || desc.indexOf(q) !== -1;
        el.classList.toggle('hidden', !show);
        if (show) visible += 1;
      }
      if (emptyEl) emptyEl.classList.toggle('hidden', visible !== 0);
      return visible;
    },
  };
})();
