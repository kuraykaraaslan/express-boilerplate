// What the webhook console shares between its pages (the port of webhook/ui/webhook-format.helpers.ts, webhook-actions.helpers.ts,
// webhook-secret.dialog.tsx and webhook-delivery-columns.component.tsx): number and date text, the server's refusal reasons as
// sentences, the signing-secret dialog, test / rotate / redeliver / replay, and the deliveries table.
//
//   KuiWebhook.errorMessage(err, fallback)   KuiWebhook.rotateSecret(apiBase, webhook)   KuiWebhook.sendTest(apiBase, id)
//   KuiWebhook.showSecret(secret, 'created'|'rotated')   KuiWebhook.deliveries(container, apiBase, webhook, { canRedeliver, canReplay, onChange })
(function () {
  var K = window.Kui, api = K.api, L = window.KuiList, esc = L.esc;
  function notify(kind, text) { if (L && L.notice) L.notice(kind, text); }
  function num(n) { return new Intl.NumberFormat().format(n); }
  function ms(v) { return v == null || !isFinite(v) ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v) + ' ms'; }
  function ratio(v) { return v == null || !isFinite(v) ? '—' : new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(v); }
  function dateTime(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d); }
  function http(s) { return s == null ? 'no response' : 'HTTP ' + s; }
  function msgOf(err, fallback) { var m = err && err.response && err.response.data && err.response.data.message; return typeof m === 'string' && m ? m : fallback; }

  // The reasons the delivery worker records in errorMessage.
  function deliveryError(m) {
    switch (m) {
      case null: case undefined: case '': return '';
      case 'ENDPOINT_DISABLED': return 'Not sent: the endpoint was disabled before this delivery ran.';
      case 'Queue unavailable: the delivery was not enqueued.': return 'Not sent: the delivery queue was unavailable. Redeliver it.';
      case 'the webhook endpoint no longer exists': return 'Not sent: the endpoint was deleted.';
      default: return m;
    }
  }
  // A refused webhook request as a sentence: each details.reason the routes answer with has its own text.
  function errorMessage(err, fallback) {
    var res = err && err.response, d = res && res.data && res.data.details || {}, reason = typeof d.reason === 'string' ? d.reason : '';
    switch (reason) {
      case 'ENDPOINT_DISABLED': return 'This endpoint is disabled. Enable it first.';
      case 'WEBHOOKS_NOT_IN_PLAN': return 'Webhooks are not included in your plan.';
      case 'DELIVERY_NOT_REDELIVERABLE': return d.status === 'SUCCESS' ? 'This delivery has already succeeded.' : 'This delivery is already queued again.';
      case 'TEST_DELIVERY_NOT_REDELIVERABLE': return 'A test delivery is not redelivered. Send a new test instead.';
      case 'EVENT_FILTERED_OUT': return 'Nothing was sent: this endpoint\'s event filter for ' + (typeof d.event === 'string' ? d.event : '') + ' would drop this payload. Change the payload to match the filter, or change the filter.';
      default: return msgOf(err, fallback);
    }
  }

  // Shows a signing secret once: the value to copy and a responsibility text the person ticks.
  function showSecret(secret, kind) {
    var box = document.createElement('div'); box.className = 'flex items-stretch gap-2';
    var input = document.createElement('input'); input.readOnly = true; input.value = secret; input.setAttribute('aria-label', 'Signing secret');
    input.className = 'min-w-0 flex-1 rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-xs text-text-primary';
    input.addEventListener('focus', function () { input.select(); });
    var copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy';
    copy.className = 'shrink-0 rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-overlay';
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(secret).then(function () { copy.textContent = 'Copied'; }, function () { notify('error', 'Could not copy to the clipboard. Select the secret and copy it by hand.'); });
    });
    box.appendChild(input); box.appendChild(copy);
    var p = window.confirmDialog({
      title: kind === 'created' ? 'Signing secret of the new webhook' : 'New signing secret',
      message: kind === 'created' ? 'Every delivery to this endpoint is signed with this secret. Copy it to the receiver now: it is shown only once.' : 'New webhook signing secret (shown once — copy it now):',
      details: box, acknowledgement: 'I copied the secret. It is not shown again.', confirmLabel: 'Done',
    });
    lockDialog();
    return p;
  }
  // The secret is never shown again, so its dialog cannot be dismissed: no Escape, no click outside, no X, no Cancel; the only way out is the
  // acknowledged Done. (NB's ConfirmDialog has a `dismissible` option that kui-react and kui-ejs do not; this does the same from outside.)
  function lockDialog() {
    var roots = document.querySelectorAll('[data-kui-confirm-dialog]'), root = roots[roots.length - 1];
    if (!root) return;
    [].slice.call(root.querySelectorAll('[data-kui-confirm-close],[data-confirm-cancel]')).forEach(function (b) { b.classList.add('hidden'); });
    root.addEventListener('click', function (e) { if (e.target.closest('[data-kui-confirm-backdrop]')) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    var onKey = function (e) { if (!root.isConnected) { document.removeEventListener('keydown', onKey, true); return; } if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); } };
    document.addEventListener('keydown', onKey, true);
  }

  function sendTest(apiBase, webhookId) {
    return api.post(apiBase + '/' + encodeURIComponent(webhookId) + '/test').then(function (res) {
      var d = res.data && res.data.delivery;
      if (d && d.status === 'SUCCESS') notify('success', 'Test delivered — ' + http(d.responseStatus) + ' in ' + ms(d.duration));
      else notify('error', 'Test failed — ' + (d ? (deliveryError(d.errorMessage) || http(d.responseStatus)) : 'no response'));
    }).catch(function (err) { notify('error', errorMessage(err, 'Test request failed.')); });
  }

  function overlapOpen(w) { var u = w.previousSecretExpiresAt ? Date.parse(w.previousSecretExpiresAt) : NaN; return isFinite(u) && u > Date.now(); }
  // Rotate: confirm, rotate, show the new secret once, and only then say it is done. Resolves true when it was rotated.
  function rotateSecret(apiBase, w) {
    var message = overlapOpen(w)
      ? 'Rotate the signing secret for this webhook?\n\nThe previous secret is still valid until ' + dateTime(w.previousSecretExpiresAt) + ' and keeps that end date: only the current secret is replaced, so subscribers already using it must switch to the new one now. The new secret is shown only once — copy it immediately.'
      : 'Rotate the signing secret for this webhook?\n\nThe previous secret stays valid for 48 hours so subscribers can swap. The new secret is shown only once — copy it immediately.';
    return window.confirmDialog({ title: 'Rotate signing secret', message: message, tone: 'danger', confirmLabel: 'Rotate' }).then(function (ok) {
      if (!ok) return false;
      return api.post(apiBase + '/' + encodeURIComponent(w.webhookId) + '/rotate-secret', { overlapHours: 48 }).then(function (res) {
        var secret = typeof res.data.newSecret === 'string' ? res.data.newSecret : null, until = res.data.webhook && res.data.webhook.previousSecretExpiresAt;
        return (secret ? showSecret(secret, 'rotated') : Promise.resolve(true)).then(function (ack) {
          if (ack) notify('success', until ? 'Webhook secret rotated. The previous secret stays valid until ' + dateTime(until) + '.' : 'Webhook secret rotated. Previous secret valid for 48h.');
          return true;
        });
      }, function (err) { notify('error', errorMessage(err, 'Failed to rotate secret.')); return false; });
    });
  }

  function deadLetterCount(apiBase, id) { return api.get(apiBase + '/' + encodeURIComponent(id) + '/deliveries/replay-dead-letter').then(function (r) { return typeof r.data.count === 'number' ? r.data.count : 0; }); }
  // Replay every dead letter: count them fresh, confirm with that count, replay, say how many were re-queued. Resolves true when something was sent.
  function replay(apiBase, w) {
    return deadLetterCount(apiBase, w.webhookId).then(function (count) {
      if (count === 0) { notify('info', 'There are no dead-lettered deliveries to replay.'); return false; }
      return window.confirmDialog({
        title: 'Re-queue dead-lettered deliveries', tone: 'warning', confirmLabel: 'Re-queue',
        message: 'Re-queue ' + num(count) + ' dead-lettered deliver' + (count === 1 ? 'y' : 'ies') + ' for ' + w.name + '? Each one is sent again to the live endpoint with its original body.',
      }).then(function (ok) {
        if (!ok) return false;
        return api.post(apiBase + '/' + encodeURIComponent(w.webhookId) + '/deliveries/replay-dead-letter').then(function (res) {
          var replayed = Number(res.data.replayed || 0), skipped = Number(res.data.skipped || 0);
          notify('success', skipped > 0 ? num(replayed) + ' re-queued; ' + num(skipped) + ' skipped because another request had already re-queued them.' : num(replayed) + ' dead-lettered deliver' + (replayed === 1 ? 'y' : 'ies') + ' re-queued.');
          return true;
        }, function (err) { notify('error', errorMessage(err, 'Failed to replay dead-lettered deliveries.')); return false; });
      });
    }, function (err) { notify('error', errorMessage(err, 'Could not count the dead-lettered deliveries. Try again.')); return false; });
  }

  var STATUS = { PENDING: ['warning', 'Pending', 'fa-clock'], SUCCESS: ['success', 'Success', 'fa-circle-check'], FAILED: ['error', 'Failed', 'fa-circle-xmark'], DEAD_LETTERED: ['error', 'Dead-lettered', 'fa-circle-xmark'] };
  var redeliverable = function (d) { return (d.status === 'FAILED' || d.status === 'DEAD_LETTERED') && d.event !== 'test'; };

  // The deliveries table of one webhook (the list's modal and the detail page's panel). opts: { canRedeliver, canReplay, onChange }
  function deliveries(container, apiBase, w, opts) {
    opts = opts || {};
    var busy = {}, active = !!w.isActive, listApi = null, replaying = false;
    container.innerHTML = '<div data-wd-banner class="hidden mb-3" role="status"></div><div data-wd-list></div>';
    var banner = container.querySelector('[data-wd-banner]');
    function paintBanner(count) {
      if (!(count > 0)) { banner.className = 'hidden'; return; }
      var notice = count + ' dead-lettered deliver' + (count === 1 ? 'y' : 'ies') + ': every retry was used up.';
      banner.className = 'flex items-start gap-3 rounded-lg border p-3 text-sm bg-warning-subtle border-warning text-warning-fg';
      banner.innerHTML = '<i class="fa-solid fa-triangle-exclamation mt-0.5 shrink-0" aria-hidden="true"></i><span class="flex-1"></span>';
      banner.querySelector('span').textContent = opts.canReplay && !active ? notice + ' Enable the endpoint to replay them.' : notice;
      if (opts.canReplay && active) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'shrink-0 underline underline-offset-2'; b.textContent = 'Replay all';
        b.addEventListener('click', function () {
          if (replaying) return; replaying = true; b.textContent = 'Replaying…';
          replay(apiBase, w).then(function (sent) { if (sent) { listApi.reload(); refreshCount(); if (opts.onChange) opts.onChange(); } }).then(function () { replaying = false; b.textContent = 'Replay all'; });
        });
        banner.appendChild(b);
      }
    }
    function refreshCount() { if (opts.canReplay) deadLetterCount(apiBase, w.webhookId).then(paintBanner, function () { paintBanner(0); }); }
    var columns = [
      { key: 'status', header: 'Status', sortable: true, render: function (d) { var s = STATUS[d.status] || ['neutral', d.status, 'fa-clock']; return '<div class="flex items-center gap-2"><i class="fa-solid ' + s[2] + ' ' + (s[0] === 'success' ? 'text-success' : s[0] === 'error' ? 'text-error' : 'text-warning') + '" aria-hidden="true"></i>' + L.badge(s[0], s[1], { sm: true }) + '</div>'; } },
      { key: 'event', header: 'Event', sortable: true, render: function (d) { return '<span class="font-mono text-xs text-text-primary">' + esc(d.event) + '</span>'; } },
      { key: 'responseStatus', header: 'HTTP', sortable: true, hide: 'sm', render: function (d) { return '<span class="text-xs text-text-secondary tabular-nums">' + (d.responseStatus != null ? d.responseStatus : '—') + '</span>'; } },
      { key: 'errorMessage', header: 'Failure reason', hide: 'md', render: function (d) { var t = deliveryError(d.errorMessage); return t ? '<span class="block max-w-xs truncate text-xs text-text-secondary" title="' + esc(t) + '">' + esc(t) + '</span>' : '<span class="text-xs text-text-secondary">—</span>'; } },
      { key: 'attempts', header: 'Attempts', sortable: true, hide: 'md', render: function (d) { return '<span class="text-xs text-text-secondary tabular-nums">' + num(d.attempts) + ' of ' + num(d.maxAttempts) + '</span>'; } },
      { key: 'duration', header: 'Duration', sortable: true, hide: 'md', render: function (d) { return '<span class="text-xs text-text-secondary tabular-nums">' + ms(d.duration) + '</span>'; } },
      { key: 'nextRetryAt', header: 'Next retry', hide: 'lg', render: function (d) { return '<span class="text-xs text-text-secondary whitespace-nowrap">' + (d.status === 'PENDING' && d.nextRetryAt ? esc(dateTime(d.nextRetryAt)) : '—') + '</span>'; } },
      { key: 'createdAt', header: 'When', sortable: true, render: function (d) { return '<span class="text-xs text-text-secondary whitespace-nowrap">' + esc(dateTime(d.createdAt)) + '</span>'; } },
    ];
    if (opts.canRedeliver) columns.push({ key: '_a', header: '<span class="sr-only">Actions</span>', align: 'right', render: function (d) {
      if (!redeliverable(d)) return '';
      var b = !!busy[d.deliveryId], off = b || !active;
      return '<button type="button" data-act="redeliver"' + (off ? ' disabled' : '') + (!active ? ' title="Enable the endpoint to redeliver."' : '') + ' class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-primary hover:bg-surface-overlay disabled:opacity-50"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>' + (b ? 'Redelivering' : d.status === 'DEAD_LETTERED' ? 'Replay' : 'Redeliver') + '</button>';
    } });
    listApi = L.mount(container.querySelector('[data-wd-list]'), {
      endpoint: apiBase + '/' + encodeURIComponent(w.webhookId) + '/deliveries', pageBase: 1, caption: 'Deliveries', pageSizes: [10, 20, 50],
      sort: { key: 'createdAt', dir: 'desc' }, columns: columns, empty: 'No deliveries yet.',
      onCellAction: function (act, d) {
        if (act !== 'redeliver' || busy[d.deliveryId]) return;
        // Busy until the next read lands, so a second click on the stale row cannot send twice.
        busy[d.deliveryId] = true; listApi.reload();
        api.post(apiBase + '/' + encodeURIComponent(w.webhookId) + '/deliveries/' + encodeURIComponent(d.deliveryId) + '/redeliver').then(function () {
          notify('success', 'Redelivery queued.'); if (opts.onChange) opts.onChange();
        }, function (err) { notify('error', errorMessage(err, 'Failed to redeliver.')); }).then(function () { delete busy[d.deliveryId]; listApi.reload(); refreshCount(); });
      },
    });
    refreshCount();
    return { reload: function () { listApi.reload(); refreshCount(); } };
  }

  window.KuiWebhook = { errorMessage: errorMessage, deliveryError: deliveryError, showSecret: showSecret, sendTest: sendTest, rotateSecret: rotateSecret, replay: replay, deliveries: deliveries, fmt: { num: num, ms: ms, ratio: ratio, dateTime: dateTime, http: http } };
})();
