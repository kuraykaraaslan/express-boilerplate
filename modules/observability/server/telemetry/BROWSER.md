# Browser SDK recipe: Core Web Vitals and release health (phase 18.7)

A dependency-free script (about 3 KB) that reports, for every page view, the Core Web Vitals (LCP, INP, CLS) and the number of JavaScript errors, tagged
with the release, to the OTLP metrics endpoint. The **Release health** page (`/admin/telemetry/releases`) turns them into one row per release.

## 1. Create a browser key

In the API keys screen create a key whose **only** scope is `telemetry:browser:write`. It is not `telemetry:write`: that scope (server exporters) is
refused from a page's point of view only by convention, whereas this one is narrower by construction. Then open **Release health, Set up**, paste the key's id,
list the exact origins that may use it (`https://www.example.com`, one per line) and keep the rate low (default 60 requests a minute per key).

## 2. Add the tag

```html
<script async defer src="https://YOUR-APP/api/telemetry/web-vitals"
        integrity="sha384-..." crossorigin="anonymous"
        data-endpoint="https://YOUR-APP/api/telemetry/otlp/v1"
        data-key="YOUR_BROWSER_KEY"
        data-release="1.42.0"></script>
```

The Set up tab shows the tag with the real `integrity` value (the SHA-384 of the script as served). Other options: `data-service` (default the page's hostname),
`data-environment` (default `production`), `data-sample` (0 to 1, the share of page views that report). The same values can be given in `window.__NB_VITALS__`
before the script loads.

The script is served by `GET /api/telemetry/web-vitals` as `text/javascript`, with `X-Content-Type-Options: nosniff`, `Access-Control-Allow-Origin: *`,
`Cross-Origin-Resource-Policy: cross-origin`, `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` and an `ETag` (304 on a match).

## What it sends

Once per page view, when the page is hidden or unloaded, one OTLP/JSON request (`fetch` with `keepalive`, no cookies): the gauges `browser_page_views` (1),
`browser_page_views_with_errors` (0 or 1), `browser_js_errors`, `browser_web_vitals_lcp` (ms), `browser_web_vitals_inp` (ms), `browser_web_vitals_cls`, each with
the data point attributes `service.version` and `deployment.environment` and the resource attribute `service.name`. **No URL, no user id, no user agent,
no cookie.** A failed image is not counted as a JavaScript error. Failure is silent and never retried.

## The key is public: what that means and what bounds it

Every visitor can read the key in the page source. That cannot be prevented, so the key is made close to useless to anyone who copies it:

| Guard | Where | What it stops |
|---|---|---|
| Own scope `telemetry:browser:write` | `api_key` scope list, checked by the same verifier as every key | the key cannot write traces, and a `telemetry:write` key is not a browser key |
| Metrics named `browser_*` only, plus logs | `otlp.ingest.ts` (`browser: true`) | writing arbitrary series into the workspace's metric namespace |
| Origin allow-list per key, exact match, fail closed | `telemetry.browser-keys.ts`, `otlp.route.shared.ts` | reuse of a copied key from another website; a key with no configuration is refused |
| Rate limit per key (default 60/min, at most 600) | the shared limiter, key `telemetry:browser:<id>` | volume abuse |
| 64 KB body (also once decompressed) and 200 data points | `BROWSER_LIMITS` | oversized batches |
| The plan's daily volume and metering | `telemetry.plan-guard.ts` (as for every key) | a cost surprise |
| Revocation | the API keys screen | everything, in one click |

**Honest limit:** `Origin` is set by browsers and by nothing else we can trust. A script outside a browser can send any `Origin` it likes, so the allow-list stops
other websites and casual abuse, not a determined attacker with the key. What bounds that attacker is the rest of the table (narrow scope, name rule, rate, size,
plan volume, revocation) and that what they can write is limited to `browser_*` numbers in one workspace. The allow-list lives in a tenant setting
(`observabilityTelemetryBrowserKeys`), not on the `api_key` row, because that entity belongs to another module; the setting is audited on every change.

The CORS preflight (`OPTIONS` on the metrics and logs routes) is unauthenticated by nature: it only echoes a well-formed origin and names the allowed headers. The
decision is made on the real request, from the key and its allow-list, and only an allowed origin gets `Access-Control-Allow-Origin` on the answer.

## Release health

`POST /api/telemetry/query/release-health` (`observability.telemetry.read`): `{ range, environment?, limit? }` answers one row per release: page views, pages with an
error and the error rate, JS errors, and the 75th percentile of LCP, INP and CLS with Google's rating (LCP 2.5 s / 4 s, INP 200 / 500 ms, CLS 0.1 / 0.25).
It uses the gauge aggregations `q75` (quantile of the raw observations in a step) and `total` (their sum). Counts are exact. A percentile cannot be summed across
steps: for a range of 5 minutes or less (one step) it is exact, beyond that it is the page-view-weighted mean of hourly percentiles and the
answer says `approximatePercentiles: true`.

## Not verified live

Tested with fixtures and the memory backend, including the snippet run in a sandbox with a fake browser. Not run in a real browser, against a real Prometheus (the
PromQL for `q75` / `total` is checked as text only), or from a real second origin. Session replay and continuous profiling stay out of scope.
