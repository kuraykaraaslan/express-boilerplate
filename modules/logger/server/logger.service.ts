import winston from 'winston';
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '@kuraykaraaslan-labs/env';
import { DailyFileStream } from './logger.daily-file';

const { combine, timestamp, json, printf } = winston.format;
const timestampFormat = 'MMM-DD-YYYY HH:mm:ss';

/**
 * Per-request context that automatically tags every Logger.info/warn/error
 * call with the active tenant + user + request IDs. Populated by the proxy
 * (or route handler) via `Logger.runWithContext({ ... }, fn)`; downstream
 * code that calls `Logger.info(...)` has no knowledge of context propagation.
 *
 * `class` is the telemetry class of the lines written inside the context (docs/phases/02-fleet/01-data-classification):
 * `R` is the regional default, `X` marks lines that may carry restricted content (SQL text, raw payloads) and must
 * never reach the default log stream of a node. `G` (global) is deliberately not a value: a log line is never global.
 * Once a context is `X`, nothing opened inside it can lower it back to `R`.
 *
 * `nodeId` is the fleet node id (FLEET_NODE_ID). It is not the random per-process id `process_host` calls nodeId.
 * A node process has one value for its whole life, so the logger fills it from the env; a context only overrides it
 * in a test.
 */
export interface LogContext {
  tenantId?: string;
  userId?: string;
  requestId?: string;
  class?: 'R' | 'X';
  nodeId?: string;
  [k: string]: string | number | boolean | undefined;
}

const contextStore = new AsyncLocalStorage<LogContext>();

function currentContext(): LogContext {
  return contextStore.getStore() ?? {};
}

/** Drops a `class` that is not R or X (a caller outside the type system), and keeps X sticky inside an X context. */
function sanitizeContext(ctx: LogContext, enclosing: LogContext): LogContext {
  const out: LogContext = { ...ctx };
  if (out.class !== undefined && out.class !== 'R' && out.class !== 'X') delete out.class;
  if (enclosing.class === 'X') out.class = 'X';
  return out;
}

// Serverless platforms (Vercel, AWS Lambda) and the edge runtime expose a
// read-only filesystem (only /tmp is writable), so a file transport cannot create
// `logs/`. Detect those and log to the console instead — which is also what their
// log drains ingest.
function isServerless(): boolean {
  return !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NEXT_RUNTIME === 'edge'
  );
}

// Everything below is read from the env module once, at import. The LOG_*
// fields are lenient in the schema, so an unusable value arrives here as `undefined`; an env mock that omits them does too.
const ROLE = env.FLEET_ROLE ?? 'single';
const TO_STDOUT = env.LOG_TO_STDOUT === true;
const NODE_ID = env.FLEET_NODE_ID;

// LOG_TO_STDOUT selects the console in any NODE_ENV: a container's log driver reads stdout, and a file inside the
// container is never seen by it. Otherwise the daily file under logs/, rolled when the day changes.
const TO_CONSOLE = TO_STDOUT || env.NODE_ENV === 'vercel' || env.NODE_ENV === 'development' || isServerless();

function makeTransports(level: string) {
  if (TO_CONSOLE) return [new winston.transports.Console()];
  return [new winston.transports.Stream({ stream: new DailyFileStream('logs', () => new Date(), env.LOG_RETENTION_DAYS ?? 14), level })];
}

// Structured-JSON output when LOG_FORMAT=json (machine ingestion / cloud log pipelines); otherwise the human-readable
// single-line format. Unset keeps `text`, except on a node/fleet role writing to stdout, which is read by a collector.
const JSON_FORMAT = (env.LOG_FORMAT ?? (ROLE !== 'single' && TO_STDOUT ? 'json' : 'text')) === 'json';

// Value-pattern redaction of the warn/error MESSAGE text. The escape hatch (LOG_REDACT_MESSAGES=false) exists for a
// single-role operator who greps literal values; a node or fleet role always redacts.
const REDACT_MESSAGES = env.LOG_REDACT_MESSAGES !== false || ROLE !== 'single';

// Info-log sampling under high load: LOG_SAMPLE_RATE in (0,1) keeps that
// fraction of info logs; warn/error are never sampled.
const SAMPLE_RATE = (() => {
  const n = Number(env.LOG_SAMPLE_RATE);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 1;
})();

const CONTROL_RE = /[\u0000-\u0008\u000a-\u001f\u007f\u2028\u2029]/g;
function oneLine(text: string): string {
  return String(text).replace(CONTROL_RE, (c) => (c === '\n' ? '\\n' : c === '\r' ? '\\r' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
}

function makeLogger(level: string) {
  return winston.createLogger({
    level,
    format: combine(
      timestamp({ format: timestampFormat }),
      json(),
      printf(({ level: l, message, timestamp: ts }) => {
        const ctx = currentContext();
        const nodeId = ctx.nodeId ?? NODE_ID;
        if (JSON_FORMAT) {
          return JSON.stringify({
            ts, level: l, message,
            ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
            ...(ctx.userId ? { userId: ctx.userId } : {}),
            ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
            ...(nodeId ? { nodeId } : {}),
            // A node says R out loud, so a collector can tell "regional" from "never classified".
            ...(ctx.class || nodeId ? { class: ctx.class ?? 'R' } : {}),
          });
        }
        const tags: string[] = [];
        if (ctx.tenantId) tags.push(`tenant=${ctx.tenantId}`);
        if (ctx.userId) tags.push(`user=${ctx.userId}`);
        if (ctx.requestId) tags.push(`req=${ctx.requestId}`);
        if (nodeId) tags.push(`node=${nodeId}`);
        if (ctx.class) tags.push(`class=${ctx.class}`);
        const tagStr = tags.length ? ` [${tags.join(' ')}]` : '';
        // logger.02: one record is one line. CR, LF, the Unicode line separators and other control characters anywhere in the
        // line (message, string arguments, context tags such as a tenant id taken from the URL) are written escaped, so a
        // caller cannot forge a second record. (The JSON format escapes them by construction.)
        return oneLine(`[${ts}] [${l}]${tagStr}: ${message}`);
      }),
    ),
    transports: makeTransports(level),
  });
}

// Mutable so the app can expand the denylist at boot (env LOG_REDACT_KEYS or
// per-tenant security settings) without editing this file.
const REDACTED_KEYS = new Set([
  'password', 'token', 'secret', 'authorization', 'apiKey', 'api_key',
  'accessToken', 'refreshToken', 'privateKey', 'creditCard', 'cvv', 'ssn',
]);
for (const k of (env.LOG_REDACT_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  REDACTED_KEYS.add(k);
}

/**
 * 38-security 5.6 (logger.01): key matching is case-insensitive and ignores `-`, `_` and spaces, so `Password`, `ACCESS_TOKEN`,
 * `client_secret` and `x-api-key` are all the same key. Besides an exact match against the (normalised) denylist, a key that CONTAINS one of
 * these fragments is sensitive: the spellings real code uses (`passwordHash`, `webhookSecret`, `sessionToken`, `smtpPass`) never need
 * listing one by one. Over-redacting a field such as `tokenCount` costs a log value; under-redacting costs a credential.
 */
const normKey = (k: string): string => k.toLowerCase().replace(/[-_\s]+/g, '');
const SENSITIVE_FRAGMENTS = ['password', 'passwd', 'secret', 'token', 'apikey', 'authorization', 'cookie', 'privatekey', 'creditcard', 'cardnumber', 'cvv', 'credential', 'bearer'];
const SENSITIVE_EXACT = new Set(['ssn', 'otp', 'totp', 'pin', 'pass']);
function isSensitiveKey(k: string): boolean {
  const n = normKey(k);
  if (SENSITIVE_EXACT.has(n) || n.endsWith('pass')) return true;
  if (SENSITIVE_FRAGMENTS.some((f) => n.includes(f))) return true;
  for (const r of REDACTED_KEYS) if (normKey(r) === n) return true;
  return false;
}

// Value-level (pattern) redaction — catches PII/secrets that slip through as
// plain string values regardless of their key name.
const VALUE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, label: '[JWT]' },
  // 38-security 5.6: an Authorization value and `key=value` / `"key":"value"` credentials inside a string (axios-style errors carry the
  // request body and headers as text).
  { re: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, label: 'Bearer [REDACTED]' },
  { re: /(["']?(?:password|passwd|secret|client_secret|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token)["']?\s*[:=]\s*)(["']?)[^\s,"'&}]+/gi, label: '$1$2[REDACTED]' },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, label: '[EMAIL]' },
  // The boundaries are the whole point: "13–19 digits with optional separators"
  // also describes a UUID and an international phone number, and this pattern
  // ate both.
  //
  //   • `(?<![+\w-])` / `(?![\w-])` require the run to be a WHOLE token. A UUID
  //     (`00000000-0000-4000-8000-000000000000`) has a digit or a hyphen on
  //     every side of every 13–19 digit window inside it, so none of them match.
  //     With a plain `\b` it redacted every tenant id in the audit log as
  //     `[CARD][CARD]` — the identifier those rows exist to carry.
  //   • The `+` in the lookbehind keeps it off E.164. A card and a long
  //     international number are the same length; the difference is that a card
  //     is never written with a leading `+`. Without it a German mobile
  //     (`+4915112345678`) logged as `+[CARD]`.
  //   • Ending on `\d` rather than the optional separator stops the match
  //     swallowing the following space, which produced `[CARD]today`.
  { re: /(?<![+\w-])(?:\d[ -]?){12,18}\d(?![\w-])/g, label: '[CARD]' },
  { re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, label: '[IBAN]' },
];
function redactString(s: string): string {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const { re, label } of VALUE_PATTERNS) out = out.replace(re, label);
  return out;
}

// Tenants with temporarily-elevated (debug) logging, set at runtime.
const elevatedTenants = new Set<string>();
const GLOBAL_DEBUG = env.LOG_LEVEL === 'debug';

const MAX_REDACT_DEPTH = 10;
const MAX_REDACT_KEYS = 2_000;

export default class Logger {
  private static infoLogger = makeLogger('info');
  private static errorLogger = makeLogger('error');
  private static warnLogger = makeLogger('warn');

  /**
   * Recursively walk `obj` and replace the values of any keys that match the
   * sensitive-key list with `"[REDACTED]"`. Caps at MAX_REDACT_DEPTH levels
   * deep and bails out early once MAX_REDACT_KEYS total keys have been visited
   * to prevent DoS on unexpectedly large payloads.
   */
  private static redact(obj: unknown, depth = 0, ancestors: WeakSet<object> = new WeakSet()): unknown {
    // Beyond the cap the subtree is DROPPED, never passed through: a secret nested deeper than the cap must not be written (logger.01).
    if (depth > MAX_REDACT_DEPTH) return obj !== null && typeof obj === 'object' ? '[REDACTED: too deep]' : obj;
    if (obj !== null && typeof obj === 'object') {
      // A cycle is named, not walked to the depth cap and dropped.
      if (ancestors.has(obj as object)) return '[Circular]';
      ancestors.add(obj as object);
      try {
        if (Array.isArray(obj)) return obj.map((item) => Logger.redact(item, depth + 1, ancestors));
        const result: Record<string, unknown> = {};
        let keyCount = 0;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (++keyCount > MAX_REDACT_KEYS) break;
          result[k] = isSensitiveKey(k) ? '[REDACTED]' : Logger.redact(v, depth + 1, ancestors);
        }
        return result;
      } finally {
        ancestors.delete(obj as object);
      }
    }
    if (typeof obj === 'string') return redactString(obj);
    return obj;
  }

  /**
   * Serialize a value to JSON without ever throwing. Guards against the two
   * failure modes plain `JSON.stringify` has — circular references and `bigint`
   * values — and falls back to `String()` (then a sentinel) if anything else
   * goes wrong. Logging must never crash the caller.
   */
  private static safeStringify(value: unknown): string {
    const seen = new WeakSet<object>();
    try {
      const json = JSON.stringify(value, (_key, val) => {
        if (typeof val === 'bigint') return `${val}n`;
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      });
      return json ?? String(value);
    } catch {
      try { return String(value); } catch { return '[Unserializable]'; }
    }
  }

  /**
   * One argument at a time, so a hostile one (a throwing getter, a Proxy whose ownKeys throws) becomes a placeholder
   * instead of dropping the whole line: an error line must survive the odd object attached to it.
   */
  private static serialize(...args: unknown[]): string {
    return args
      .map((a) => {
        try {
          return typeof a === 'object' && a !== null ? Logger.safeStringify(Logger.redact(a)) : redactString(String(a));
        } catch {
          return '[Unserializable]';
        }
      })
      .join(' ');
  }

  /** Expand the key-name redaction denylist at boot (env / tenant settings). */
  static addRedactKeys(keys: string[]): void {
    for (const k of keys) if (k) REDACTED_KEYS.add(k);
  }

  /** Temporarily elevate (or reset) debug logging for a single tenant. */
  static setTenantDebug(tenantId: string, on: boolean): void {
    if (on) elevatedTenants.add(tenantId); else elevatedTenants.delete(tenantId);
  }

  /**
   * Run `fn` inside a logging context — every Logger.X call made by `fn` or
   * anything it awaits will automatically include the context tags.
   *
   *   Logger.runWithContext({ tenantId, userId, requestId }, async () => {
   *     await doStuff(); // logs inside automatically tagged
   *   });
   */
  static runWithContext<T>(ctx: LogContext, fn: () => T): T {
    const enclosing = currentContext();
    const merged = { ...enclosing, ...sanitizeContext(ctx, enclosing) };
    return contextStore.run(merged, fn);
  }

  /**
   * Run `fn` with every line it writes (and everything it awaits) marked class `X`: the lines may carry restricted
   * content such as SQL text, and a node's collector keeps them out of the default stream. Cannot be undone by a
   * nested context. Wrap the single call, not the request: `Logger.runRestricted(() => Logger.warn(sql))`.
   */
  static runRestricted<T>(fn: () => T): T {
    return Logger.runWithContext({ class: 'X' }, fn);
  }

  /** True when lines go to stdout (console transport), false when they go to the daily file under logs/. */
  static writesToConsole(): boolean {
    return TO_CONSOLE;
  }

  static getContext(): LogContext {
    return { ...currentContext() };
  }

  /**
   * Add tags to the context that is ALREADY open, for the rest of it.
   *
   * `runWithContext` can only scope a callback, and some facts are learned in
   * the middle of one: the API dispatcher opens the request's context before
   * the handler runs, but only the auth guard inside the handler finds out that
   * the caller is a delegate from another tenant. Opening a nested context there
   * would end when the guard returns — the handler's own writes would never see
   * it. Mutating the open store is what reaches them.
   *
   * Scoped to that one request: every `runWithContext` call creates a fresh
   * store object, so a mutation cannot leak into a concurrent request.
   *
   * Returns false (and does nothing) when no context is open — a caller that
   * relies on the tag being read back must treat that as "nobody will see it",
   * not as an error.
   */
  static annotateContext(values: LogContext): boolean {
    const store = contextStore.getStore();
    if (!store) return false;
    Object.assign(store, sanitizeContext(values, store));
    return true;
  }

  /**
   * `message` and its extra arguments as one line. The message text is value-redacted when `redactMessage` is set (always
   * for info/event/debug; for warn/error unless the single-role escape hatch is on); the arguments always are.
   */
  private static compose(message: string, args: unknown[], redactMessage: boolean): string {
    const text = redactMessage ? redactString(message) : message;
    return args.length > 0 ? `${text} ${Logger.serialize(...args)}` : text;
  }

  /** Logging must never take the caller down: a failure anywhere in the log path is dropped. */
  private static emit(write: () => void): void {
    try {
      write();
    } catch {
      // intentionally empty
    }
  }

  static info(message: string, ...args: unknown[]) {
    // Sampling under high load — drop a fraction of info logs (never warn/error).
    // Elevated tenants always log in full.
    if (SAMPLE_RATE < 1 && !elevatedTenants.has(currentContext().tenantId ?? '') && Math.random() > SAMPLE_RATE) return;
    Logger.emit(() => Logger.infoLogger.info(Logger.compose(message, args, true)));
  }

  /**
   * A lifecycle record: info level, never sampled.
   *
   * `info` is the right SEVERITY for "a call started" and the wrong CHANNEL,
   * because `LOG_SAMPLE_RATE` thins it. Sampling chatter is fine; sampling a
   * lifecycle stream is not, because these lines come in PAIRS — a `call.started`
   * whose matching `call.ended` was dropped reads as a leaked call, which is
   * worse than having logged neither.
   *
   * Value-pattern redaction applies, as it does to every level.
   *
   * For events, not for volume. Anything emitted per request, per packet or per
   * loop iteration belongs in `info` precisely so it CAN be sampled away.
   */
  static event(message: string, ...args: unknown[]) {
    Logger.emit(() => Logger.infoLogger.info(Logger.compose(message, args, true)));
  }

  static error(message: string, ...args: unknown[]) {
    Logger.emit(() => Logger.errorLogger.error(Logger.compose(message, args, REDACT_MESSAGES)));
  }

  static warn(message: string, ...args: unknown[]) {
    Logger.emit(() => Logger.warnLogger.warn(Logger.compose(message, args, REDACT_MESSAGES)));
  }

  static debug(message: string, ...args: unknown[]) {
    // Only emit debug when globally enabled or the active tenant is elevated —
    // keeps normal operation quiet while allowing targeted per-tenant tracing.
    if (!GLOBAL_DEBUG && !elevatedTenants.has(currentContext().tenantId ?? '')) return;
    Logger.emit(() => Logger.infoLogger.info(`[DEBUG] ${Logger.compose(message, args, true)}`));
  }
}
