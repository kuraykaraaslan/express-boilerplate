// Fuzzy matcher (subsequence + bonus weighting) — parity with
// /home/kuray/01_NextJS_Components/modules/app/CommandPalette/hooks/useFuzzySearch.tsx.
//
// Scoring rules (higher is better):
//   +100 prefix
//   +30  word boundary (space / - / / / _)
//   +10  consecutive char
//   -1   per char distance gap
//
// TODO M2: swap to a real fuzzysort backend for >500 commands.
(function () {
  if (window.__KuiCmdFuzzy) return;

  function scoreString(haystack, needle) {
    if (!needle) return { score: 0, matches: [] };
    var hay = String(haystack).toLowerCase();
    var need = String(needle).toLowerCase();
    var score = 0;
    var lastMatch = -1;
    var matches = [];
    var h = 0;
    for (var n = 0; n < need.length; n++) {
      var ch = need.charAt(n);
      var found = -1;
      for (var i = h; i < hay.length; i++) {
        if (hay.charAt(i) === ch) { found = i; break; }
      }
      if (found === -1) return null;
      if (found === 0) score += 100;
      else {
        var prev = hay.charAt(found - 1);
        if (prev === ' ' || prev === '-' || prev === '/' || prev === '_') score += 30;
      }
      if (lastMatch !== -1 && found === lastMatch + 1) score += 10;
      if (lastMatch !== -1) score -= (found - lastMatch - 1);
      matches.push(found);
      lastMatch = found;
      h = found + 1;
    }
    return { score: score, matches: matches };
  }

  function scoreItem(el, query) {
    if (!query) return { score: 0, matches: [] };
    var label = el.getAttribute('data-label') || '';
    var s = scoreString(label, query);
    if (s) return s;
    var kws = (el.getAttribute('data-keywords') || '').split(/\s+/).filter(Boolean);
    for (var i = 0; i < kws.length; i++) {
      var sk = scoreString(kws[i], query);
      if (sk) return { score: sk.score * 0.5, matches: [] };
    }
    var cat = el.getAttribute('data-category') || '';
    var sc = scoreString(cat, query);
    if (sc) return { score: sc.score * 0.25, matches: [] };
    return null;
  }

  function highlightLabel(el, matches) {
    var labelSpan = el.querySelector('.cmd-item-label');
    if (!labelSpan) return;
    var original = labelSpan.getAttribute('data-original-label') || labelSpan.textContent;
    if (!matches || !matches.length) {
      labelSpan.textContent = original;
      return;
    }
    var set = Object.create(null);
    for (var i = 0; i < matches.length; i++) set[matches[i]] = true;
    var html = '';
    for (var j = 0; j < original.length; j++) {
      var ch = original.charAt(j);
      // Escape minimally — labels are plain text.
      var esc = ch.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (set[j]) html += '<mark class="bg-warning-subtle text-text-primary rounded-sm px-0.5">' + esc + '</mark>';
      else html += esc;
    }
    labelSpan.innerHTML = html;
  }

  window.__KuiCmdFuzzy = { scoreItem: scoreItem, highlightLabel: highlightLabel };
})();
