/*
 * modules/ui/_observability/format.js
 *
 * Small pure helpers shared by the observability partials (ConversationTimeline, TraceWaterfall, LogViewer).
 * A port of kui-react modules/ui/_shared/format.ts and the `hashIndex` helper of _shared/dom.ts. No DOM, no
 * dependencies. One source for both sides: the partials load it on the server through _load.ejs, and the
 * browser scripts that need it inline it before their own code. Exposed as window.KuiObsFormat (and
 * module.exports under Node).
 */
(function (global) {
  'use strict';
  if (global.KuiObsFormat) return;

  function trim(n, digits) { return String(Number(n.toFixed(digits))); }

  /** A duration in milliseconds as short text: `820 µs`, `12.4 ms`, `1.25 s`, `2 m 5 s`. */
  function formatDurationMs(ms) {
    if (!isFinite(ms)) return '–';
    var abs = Math.abs(ms);
    if (abs === 0) return '0 ms';
    if (abs < 1) return Math.round(ms * 1000) + ' µs';
    if (abs < 10) return trim(ms, 2) + ' ms';
    if (abs < 1000) return trim(ms, 1) + ' ms';
    if (abs < 60000) return trim(ms / 1000, 2) + ' s';
    if (abs < 3600000) {
      var m = Math.floor(abs / 60000);
      var s = Math.round((abs % 60000) / 1000);
      return s === 60 ? (m + 1) + ' m' : s === 0 ? m + ' m' : m + ' m ' + s + ' s';
    }
    var h = Math.floor(abs / 3600000);
    var mm = Math.round((abs % 3600000) / 60000);
    return mm === 60 ? (h + 1) + ' h' : mm === 0 ? h + ' h' : h + ' h ' + mm + ' m';
  }

  /** `1234` -> `1.2k`, `2500000` -> `2.5M`. Under 1000 the number is returned as is. */
  function formatCompact(n) {
    if (!isFinite(n)) return '–';
    var abs = Math.abs(n);
    if (abs < 1000) return String(Number(n.toFixed(abs < 10 ? 1 : 0)));
    if (abs < 1000000) return trim(n / 1000, abs < 10000 ? 1 : 0) + 'k';
    if (abs < 1000000000) return trim(n / 1000000, abs < 10000000 ? 1 : 0) + 'M';
    return trim(n / 1000000000, 1) + 'B';
  }

  /** A percent value with a sensible number of digits: `99.9%`, `0.05%`, `100%`. */
  function formatPercent(value, digits) {
    if (digits === undefined) digits = 2;
    if (!isFinite(value)) return '–';
    return trim(value, digits) + '%';
  }

  /** `HH:mm:ss.SSS` for an epoch-ms timestamp (24 h; in `timeZone` when given, else the runtime's). */
  function formatClock(ms, timeZone) {
    try {
      var opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
      if (timeZone) opts.timeZone = timeZone;
      var parts = new Intl.DateTimeFormat('en-GB', opts).formatToParts(new Date(ms));
      var get = function (t) {
        for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value;
        return '00';
      };
      var frac = String(Math.floor(((ms % 1000) + 1000) % 1000));
      while (frac.length < 3) frac = '0' + frac;
      return get('hour') + ':' + get('minute') + ':' + get('second') + '.' + frac;
    } catch (e) {
      return new Date(ms).toISOString().slice(11, 23);
    }
  }

  /** An epoch-ms number, or an ISO string, as epoch ms (NaN when unparsable). */
  function toEpochMs(value) { return typeof value === 'number' ? value : Date.parse(value); }

  function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** Split `text` around case-insensitive literal matches of `query`: [{ text, match }]. */
  function splitMatches(text, query) {
    var q = String(query == null ? '' : query).trim();
    if (!q) return [{ text: text, match: false }];
    var out = [];
    var re = new RegExp(escapeRegExp(q), 'gi');
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) out.push({ text: text.slice(last, m.index), match: false });
      out.push({ text: m[0], match: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last), match: false });
    return out.length ? out : [{ text: text, match: false }];
  }

  /** Replace `{name}` placeholders in a message template. Unknown placeholders are left in place. */
  function fillMessage(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (whole, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole;
    });
  }

  /** Stable pseudo-hash of a string into 0..n-1 (a stable palette slot per service). */
  function hashIndex(text, n) {
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return Math.abs(h) % Math.max(1, n);
  }

  /** HTML-escape text for an element body or a double-quoted attribute (the browser scripts build markup with it). */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var api = {
    formatDurationMs: formatDurationMs, formatCompact: formatCompact, formatPercent: formatPercent, formatClock: formatClock, toEpochMs: toEpochMs,
    escapeRegExp: escapeRegExp, splitMatches: splitMatches, fillMessage: fillMessage, hashIndex: hashIndex, escapeHtml: escapeHtml
  };
  global.KuiObsFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
