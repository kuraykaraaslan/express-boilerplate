/**
 * Pure helpers behind Sentry's `beforeSend` and `tracesSampler`: which errors are noise, and which transactions to trace (and at what rate).
 * No imports — `sentry.init.ts` feeds them from env, so they are unit-testable without the SDK.
 */

/** Next.js control-flow throws (`redirect()`, `notFound()`): not failures, and they would otherwise flood the issue list. */
export const DEFAULT_IGNORED_ERRORS: readonly string[] = ['NEXT_REDIRECT', 'NEXT_NOT_FOUND', 'NEXT_HTTP_ERROR_FALLBACK'];

/** Probe/scrape routes: high volume, no information — never worth a trace. */
export const DEFAULT_UNTRACED_ROUTES: readonly string[] = ['/internal/api/health', '/internal/api/ready', '/internal/api/metrics'];

export function parseList(raw: string | undefined | null): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * `{ tenantId: rate }` from a JSON string. Malformed input and out-of-range rates are dropped (a typo must not turn tracing off or on for everyone).
 */
export function parseTenantRates(raw: string | undefined | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'number' && v >= 0 && v <= 1) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

interface EventLike {
  message?: string;
  exception?: { values?: Array<{ type?: string; value?: string }> };
}
interface HintLike { originalException?: unknown }

/** True when the error matches any pattern (case-sensitive substring of the error name, message or exception type/value). */
export function isIgnoredError(event: EventLike, hint: HintLike | undefined, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;
  const haystack: string[] = [];
  if (event.message) haystack.push(event.message);
  for (const v of event.exception?.values ?? []) { if (v.type) haystack.push(v.type); if (v.value) haystack.push(v.value); }
  const o = hint?.originalException;
  if (o instanceof Error) { haystack.push(o.name, o.message); const digest = (o as { digest?: unknown }).digest; if (typeof digest === 'string') haystack.push(digest); }
  else if (typeof o === 'string') haystack.push(o);
  return patterns.some((p) => haystack.some((h) => h.includes(p)));
}

export interface TracesSamplerConfig {
  baseRate: number;
  untracedRoutes: readonly string[];
  tenantRates: Record<string, number>;
}

interface SamplingContextLike {
  name?: string;
  parentSampled?: boolean;
  attributes?: Record<string, unknown>;
}

const TENANT_IN_PATH = /\/(?:api\/tenant|tenant|t)\/([^/?#]+)/;

/** Best-effort tenant id from the transaction name or request path (`/api/tenant/<id>/…`, `/tenant/<id>/…`, `/t/<id>/…`). */
export function tenantFromContext(ctx: SamplingContextLike): string | null {
  for (const c of [ctx.name, ctx.attributes?.['url.path'], ctx.attributes?.['http.target']]) {
    if (typeof c !== 'string') continue;
    const m = TENANT_IN_PATH.exec(c);
    if (m) return m[1];
  }
  return null;
}

/**
 * Sampling decision for a transaction, in order: an untraced route → 0; an upstream decision (distributed trace) → follow it; a per-tenant rate → that
 * rate; otherwise the base rate (or its runtime override — see `setTracesSampleRateOverride`). Returns a rate in [0, 1] (Sentry treats it as a probability).
 */
export function makeTracesSampler(cfg: TracesSamplerConfig, baseRateOverride: () => number | null = () => null): (ctx: SamplingContextLike) => number {
  return (ctx) => {
    const target = [ctx.name, ctx.attributes?.['url.path'], ctx.attributes?.['http.target']].filter((s): s is string => typeof s === 'string');
    if (target.some((t) => cfg.untracedRoutes.some((r) => t.includes(r)))) return 0;
    if (typeof ctx.parentSampled === 'boolean') return ctx.parentSampled ? 1 : 0;
    const tenant = tenantFromContext(ctx);
    if (tenant && tenant in cfg.tenantRates) return cfg.tenantRates[tenant];
    return baseRateOverride() ?? cfg.baseRate;
  };
}

let _baseRateOverride: number | null = null;

/** Process-local runtime override of the base trace rate (e.g. raise to 1 while debugging, then `null` to restore the env value). Invalid values are ignored. */
export function setTracesSampleRateOverride(rate: number | null): void {
  if (rate === null || (Number.isFinite(rate) && rate >= 0 && rate <= 1)) _baseRateOverride = rate;
}

export function getTracesSampleRateOverride(): number | null {
  return _baseRateOverride;
}
