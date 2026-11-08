/**
 * Sentry lazy initialiser. The `@sentry/nextjs` package is imported only
 * when `SENTRY_DSN` is set — the boilerplate ships zero observability
 * runtime cost for operators who don't opt in, and compiles cleanly even
 * without the dependency installed.
 *
 * Loaded by `instrumentation.ts` (Next.js server boot) and exposes the live
 * Sentry namespace through `getSentry()` for the rest of the module to use.
 */
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { resolveBuildInfo } from '@kuraykaraaslan-labs/common/server/build-info';
import {
  DEFAULT_IGNORED_ERRORS, DEFAULT_UNTRACED_ROUTES, getTracesSampleRateOverride, isIgnoredError, makeTracesSampler, parseList, parseTenantRates,
} from './sentry.filters';
import { scrubBreadcrumb, scrubSentryEvent } from './sentry.scrub';

// Loose runtime-only type; actual package is `await import('@sentry/nextjs')`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SentryNamespace = any;

/**
 * `beforeSend` for errors: the event is scrubbed (no user, body, headers, cookies, ids in paths; see sentry.scrub.ts),
 * then tagged with the R-class identifiers of the request it came from, read from the Logger AsyncLocalStorage context of
 * the async chain that captured it (a tag already on the event, set explicitly by `recordError`, wins). This is the one place tags are attached: scope tags set outside a capture call do not
 * survive Sentry's scope forking, the Logger context does. `userId` is deliberately never read.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function beforeSendHook(event: any): any {
  const scrubbed = scrubSentryEvent(event);
  if (scrubbed === null || typeof scrubbed !== 'object') return scrubbed;
  const ctx = Logger.getContext();
  const tags: Record<string, string> = {};
  if (ctx.tenantId) tags.tenantId = String(ctx.tenantId);
  if (ctx.requestId) tags.requestId = String(ctx.requestId);
  return Object.keys(tags).length > 0 ? { ...scrubbed, tags: { ...tags, ...(scrubbed.tags ?? {}) } } : scrubbed;
}

let _sentry: SentryNamespace | null = null;
let _initialized = false;

export async function initSentry(): Promise<SentryNamespace | null> {
  if (_initialized) return _sentry;
  _initialized = true;

  if (!env.SENTRY_DSN) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('@sentry/nextjs' as string);
    const build = resolveBuildInfo(env);
    const ignored = [...DEFAULT_IGNORED_ERRORS, ...parseList(env.SENTRY_IGNORE_ERRORS)];
    const tracesSampler = makeTracesSampler({
      baseRate: env.SENTRY_TRACES_SAMPLE_RATE,
      untracedRoutes: [...DEFAULT_UNTRACED_ROUTES, ...parseList(env.SENTRY_TRACES_IGNORE_ROUTES)],
      tenantRates: parseTenantRates(env.SENTRY_TRACES_TENANT_RATES),
    }, getTracesSampleRateOverride);
    mod.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      release: build.release,
      // The exact image behind an event: the release is the human-facing version, these two pin the bits.
      initialScope: { tags: { ...(build.gitSha ? { gitSha: build.gitSha } : {}), ...(build.imageDigest ? { imageDigest: build.imageDigest } : {}) } },
      // `tracesSampler` supersedes `tracesSampleRate`: same base rate, plus untraced probe routes, distributed-trace inheritance and per-tenant rates.
      tracesSampler,
      profilesSampleRate: env.SENTRY_PROFILES_SAMPLE_RATE,
      // Nothing identifying a person is sent: the SDK's own PII collection is off, and every event goes through the scrubber.
      sendDefaultPii: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeSend(event: any, hint: any) {
        // Expected / noisy errors (Next control-flow throws + SENTRY_IGNORE_ERRORS) never reach Sentry.
        if (isIgnoredError(event, hint, ignored)) return null;
        return beforeSendHook(event);
      },
      // Transactions carry URLs and span data too; they are scrubbed, not tagged (a transaction is not an error report).
      beforeSendTransaction: scrubSentryEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
    _sentry = mod;
    Logger.info('[observability] Sentry initialised');
    return mod;
  } catch (err) {
    Logger.warn(
      `[observability] @sentry/nextjs not installed — SENTRY_DSN set but the SDK is missing. ` +
        `Install with: npm install @sentry/nextjs. ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export function getSentry(): SentryNamespace | null {
  return _sentry;
}
