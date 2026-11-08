/*
 * modules/ui/ConversationTimeline/conversation-model.js
 *
 * Totals and cost formatting of ConversationTimeline: a port of kui-react
 * modules/ui/ConversationTimeline/model.ts. Pure; loaded on the server by ConversationTimeline.ejs through
 * _observability/_load.ejs and by tests/conversation-timeline.test.ts under Node. window.KuiConversationModel.
 */
(function (global) {
  'use strict';
  if (global.KuiConversationModel) return;

  /** Sums over the steps: tokens, cost, time, counts by type, citations kept and dropped, failed steps. */
  function computeTotals(steps) {
    var t = { steps: steps.length, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, durationMs: 0, modelCalls: 0, toolCalls: 0, citationsKept: 0, citationsDropped: 0, errors: 0 };
    steps.forEach(function (s) {
      var tk = s.tokens || {};
      t.inputTokens += tk.input || 0;
      t.outputTokens += tk.output || 0;
      t.cachedTokens += tk.cached || 0;
      t.cost += s.cost || 0;
      t.durationMs += s.durationMs || 0;
      if (s.type === 'model') t.modelCalls++;
      if (s.type === 'tool') t.toolCalls++;
      if (s.type === 'citation') { if (s.citation && s.citation.kept) t.citationsKept++; else t.citationsDropped++; }
      if (s.status === 'error') t.errors++;
    });
    return t;
  }

  /** A money amount: at least two decimals, up to four below one unit (token costs are tiny). */
  function formatCost(amount, currency, locale) {
    currency = currency || 'USD';
    if (!isFinite(amount)) return '–';
    var small = Math.abs(amount) < 1;
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: currency, minimumFractionDigits: 2, maximumFractionDigits: small ? 4 : 2 }).format(amount);
    } catch (e) {
      return amount.toFixed(small ? 4 : 2) + ' ' + currency;
    }
  }

  var api = { computeTotals: computeTotals, formatCost: formatCost };
  global.KuiConversationModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
