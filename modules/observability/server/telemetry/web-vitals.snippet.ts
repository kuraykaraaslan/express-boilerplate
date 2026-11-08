/**
 * The browser snippet (phase 18.7): a dependency-free script that sends the Core Web Vitals (LCP, INP, CLS) and the JavaScript error count of
 * ONE page view, tagged with the release, to the OTLP metrics endpoint with a browser ingest key. Served as a static asset by
 * `web-vitals.route.ts` (`GET /api/telemetry/web-vitals.js`) with its own headers; the source lives here so the tests can run it in a sandbox
 * and the setup screen can show its integrity hash.
 *
 * What it sends, once per page view, when the page is hidden or unloaded (the moment the vitals are final):
 *   browser_page_views             1                              (counts page views)
 *   browser_page_views_with_errors 1 when a JS error happened, 0 (error rate = this / page_views)
 *   browser_js_errors              how many `error` and `unhandledrejection` events
 *   browser_web_vitals_lcp         milliseconds   (only when the browser reported it)
 *   browser_web_vitals_inp         milliseconds   (only when there was an interaction)
 *   browser_web_vitals_cls         unitless score
 * as OTLP/JSON gauges, one data point each, with the data point attributes `service.version` (the release) and `deployment.environment`
 * and the resource attribute `service.name`. No URL, no user id, no cookie, no user agent: the only data are the numbers and those three attributes.
 *
 * Configuration (data attributes on the script tag, or `window.__NB_VITALS__` before it loads):
 *   data-endpoint     the OTLP base, e.g. https://app.example.com/api/telemetry/otlp/v1   (required)
 *   data-key          the browser ingest key (scope telemetry:browser:write)               (required)
 *   data-release      the release string, e.g. a git SHA or 1.42.0                         (required)
 *   data-service      service.name, default: the page's hostname
 *   data-environment  deployment.environment, default: production
 *   data-sample       0 to 1, the share of page views that report, default 1
 *
 * Failure is silent by design: it never throws into the page, never retries, never blocks unload.
 */
export const WEB_VITALS_SNIPPET = `(function () {
  'use strict';
  var w = window, d = document, cfg = w.__NB_VITALS__ || {};
  var s = d.currentScript;
  function attr(name) { return cfg[name] != null ? String(cfg[name]) : (s && s.getAttribute('data-' + name)) || ''; }
  var endpoint = attr('endpoint').replace(/\\/+$/, ''), key = attr('key'), release = attr('release');
  if (!endpoint || !key || !release) return;
  var service = attr('service') || (w.location && w.location.hostname) || 'web';
  var env = attr('environment') || 'production';
  var sample = attr('sample') === '' ? 1 : Number(attr('sample'));
  if (!(sample > 0) || (sample < 1 && Math.random() >= sample)) return;

  var lcp = null, cls = 0, clsEntries = [], clsValue = 0, inp = null, errors = 0, sent = false;
  function observe(type, cb, opts) {
    try {
      var o = new PerformanceObserver(function (list) { list.getEntries().forEach(cb); });
      var init = { type: type, buffered: true };
      if (opts) for (var k in opts) init[k] = opts[k];
      o.observe(init);
    } catch (e) { /* the browser does not report this entry type */ }
  }
  observe('largest-contentful-paint', function (e) { lcp = e.renderTime || e.loadTime || e.startTime; });
  observe('layout-shift', function (e) {
    if (e.hadRecentInput) return;
    var first = clsEntries[0], last = clsEntries[clsEntries.length - 1];
    if (clsEntries.length && e.startTime - last.startTime < 1000 && e.startTime - first.startTime < 5000) { clsValue += e.value; clsEntries.push(e); }
    else { clsValue = e.value; clsEntries = [e]; }
    if (clsValue > cls) cls = clsValue;
  });
  observe('event', function (e) {
    if (!e.interactionId) return;
    if (inp === null || e.duration > inp) inp = e.duration;
  }, { durationThreshold: 40 });
  // capture phase, but only errors of the window itself: a failed image or stylesheet is not a JavaScript error
  w.addEventListener('error', function (e) { if (!e.target || e.target === w) errors += 1; }, true);
  w.addEventListener('unhandledrejection', function () { errors += 1; });

  // The release and the environment ride on every data point (a label in every backend), not only on the resource (which Prometheus keeps apart).
  var dims = [{ key: 'service.version', value: { stringValue: release } }, { key: 'deployment.environment', value: { stringValue: env } }];
  function point(name, value, now) { return { name: name, gauge: { dataPoints: [{ timeUnixNano: String(now) + '000000', asDouble: value, attributes: dims }] } }; }
  function send() {
    if (sent) return;
    sent = true;
    var now = Date.now();
    var metrics = [point('browser_page_views', 1, now), point('browser_page_views_with_errors', errors > 0 ? 1 : 0, now), point('browser_js_errors', errors, now)];
    if (lcp !== null) metrics.push(point('browser_web_vitals_lcp', Math.round(lcp), now));
    if (inp !== null) metrics.push(point('browser_web_vitals_inp', Math.round(inp), now));
    if (clsEntries.length || cls > 0) metrics.push(point('browser_web_vitals_cls', Math.round(cls * 1000) / 1000, now));
    var body = JSON.stringify({ resourceMetrics: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
      scopeMetrics: [{ scope: { name: 'nb.web-vitals' }, metrics: metrics }],
    }] });
    try {
      w.fetch(endpoint + '/metrics', { method: 'POST', keepalive: true, mode: 'cors', credentials: 'omit',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: body }).catch(function () {});
    } catch (e) { /* never into the page */ }
  }
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') send(); });
  w.addEventListener('pagehide', send);
})();
`;
