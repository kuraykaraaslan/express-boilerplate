// modules/ui/DiffViewer/scripts/diff.js
//
// Zero-dependency line-based LCS diff used by the EJS DiffViewer.
// Pixel-identical sibling of
// /home/kuray/01_NextJS_Components/modules/ui/DiffViewer/hooks/useDiff.ts.
//
// Public surface (attached to window):
//   window.KuiDiff.computeHunks(oldText, newText, context)
//     -> Hunk[]
//   Hunk  = { oldStart, oldLines, newStart, newLines, changes: Change[] }
//   Change = { type: 'context'|'add'|'remove', oldLine, newLine, content }
//
// TODO M2: swap LCS for Myers diff; add intra-line word diff.
// TODO M5: virtualise via a sliding window when changes.length > 10_000.

(function () {
  if (window.KuiDiff) return;

  function splitLines(s) {
    if (s === '') return [];
    return String(s).split('\n');
  }

  function buildLcsTable(oldLines, newLines) {
    var m = oldLines.length;
    var n = newLines.length;
    var lcs = new Array(m + 1);
    for (var i = 0; i <= m; i++) {
      lcs[i] = new Array(n + 1);
      for (var j = 0; j <= n; j++) lcs[i][j] = 0;
    }
    for (var i2 = 1; i2 <= m; i2++) {
      for (var j2 = 1; j2 <= n; j2++) {
        if (oldLines[i2 - 1] === newLines[j2 - 1]) {
          lcs[i2][j2] = lcs[i2 - 1][j2 - 1] + 1;
        } else {
          lcs[i2][j2] = Math.max(lcs[i2 - 1][j2], lcs[i2][j2 - 1]);
        }
      }
    }
    return lcs;
  }

  function buildChanges(oldLines, newLines, lcs) {
    var out = [];
    var i = oldLines.length;
    var j = newLines.length;
    while (i > 0 && j > 0) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        out.push({ type: 'context', oldLine: i, newLine: j, content: oldLines[i - 1] });
        i--; j--;
      } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
        out.push({ type: 'remove', oldLine: i, newLine: null, content: oldLines[i - 1] });
        i--;
      } else {
        out.push({ type: 'add', oldLine: null, newLine: j, content: newLines[j - 1] });
        j--;
      }
    }
    while (i > 0) {
      out.push({ type: 'remove', oldLine: i, newLine: null, content: oldLines[i - 1] });
      i--;
    }
    while (j > 0) {
      out.push({ type: 'add', oldLine: null, newLine: j, content: newLines[j - 1] });
      j--;
    }
    out.reverse();
    return out;
  }

  function groupIntoHunks(changes, context) {
    if (!changes.length) return [];
    var changeIdx = [];
    for (var i = 0; i < changes.length; i++) {
      if (changes[i].type !== 'context') changeIdx.push(i);
    }
    if (!changeIdx.length) return [];

    var clusters = [];
    var curStart = changeIdx[0];
    var curEnd = changeIdx[0];
    for (var k = 1; k < changeIdx.length; k++) {
      var idx = changeIdx[k];
      if (idx - curEnd <= 2 * context + 1) {
        curEnd = idx;
      } else {
        clusters.push({ start: curStart, end: curEnd });
        curStart = idx;
        curEnd = idx;
      }
    }
    clusters.push({ start: curStart, end: curEnd });

    var hunks = [];
    for (var c = 0; c < clusters.length; c++) {
      var cl = clusters[c];
      var from = Math.max(0, cl.start - context);
      var to = Math.min(changes.length - 1, cl.end + context);
      var slice = changes.slice(from, to + 1);
      var oldStart = 0, newStart = 0;
      for (var s = 0; s < slice.length; s++) {
        if (slice[s].oldLine != null) { oldStart = slice[s].oldLine; break; }
      }
      for (var s2 = 0; s2 < slice.length; s2++) {
        if (slice[s2].newLine != null) { newStart = slice[s2].newLine; break; }
      }
      var oldLines = 0, newLines = 0;
      for (var t = 0; t < slice.length; t++) {
        var ch = slice[t];
        if (ch.type === 'context') { oldLines++; newLines++; }
        else if (ch.type === 'remove') oldLines++;
        else if (ch.type === 'add') newLines++;
      }
      hunks.push({ oldStart: oldStart, oldLines: oldLines, newStart: newStart, newLines: newLines, changes: slice });
    }
    return hunks;
  }

  function computeHunks(oldText, newText, context) {
    var ctx = typeof context === 'number' && context >= 0 ? context : 3;
    var oldLines = splitLines(oldText);
    var newLines = splitLines(newText);
    if (!oldLines.length && !newLines.length) return [];
    var lcs = buildLcsTable(oldLines, newLines);
    var changes = buildChanges(oldLines, newLines, lcs);
    return groupIntoHunks(changes, ctx);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.KuiDiff = {
    computeHunks: computeHunks,
    escapeHtml: escapeHtml,
  };
})();
