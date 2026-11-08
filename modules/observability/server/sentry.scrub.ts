/**
 * What may leave the platform in a Sentry event. Pure functions, no SDK and no I/O: `sentry.init.ts` wires them as
 * `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`, and the tests drive them with synthetic events.
 *
 * Sentry is a third-party processor. An event is therefore reduced to what is needed to find the bug: the stack, the
 * route TEMPLATE, the release and the R-class tags the init adds (`tenantId`, `requestId`). Everything that can carry a
 * person or a payload goes:
 *
 *   - the user (`event.user`) and any user-id tag: nothing identifies a person to Sentry;
 *   - the request body, headers, cookies, query string and environment;
 *   - local variables of stack frames (`frame.vars`);
 *   - uuid, long hex, numeric and tenant segments of a URL path, and the same shapes inside free text (exception,
 *     breadcrumb and event messages, string values of `extra`): an id in a path is how a record is looked up;
 *   - a dashboard display link token (`dsp_…`, the credential in a `/display/<token>` page path), in a path and in text.
 *
 * The functions never throw, never mutate their input and are idempotent (their placeholders do not match their own
 * patterns), so applying them twice, or to a malformed event, is safe.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
const NUMERIC = /^\d+$/;
/** A display link token (dashboard `display-token.ts`): `dsp_` + 32 bytes base64url. */
const DISPLAY_TOKEN = /^dsp_[A-Za-z0-9_-]{43}$/;
/** A segment that is already a placeholder or a Next route-template parameter (`[tenantId]`, `[...slug]`). */
const PLACEHOLDER = /^\[[^\]]*\]$/;

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_IN_TEXT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const DISPLAY_TOKEN_IN_TEXT = /dsp_[A-Za-z0-9_-]{43}/g;
const TENANT_PATH_IN_TEXT = /(\/tenant\/)(?!\[)[^/\s?#'"]+/g;

/** Placeholders. Each one contains brackets, which no pattern above matches. */
const P = { uuid: '[uuid]', hex: '[hex]', num: '[num]', tenant: '[tenant]', token: '[token]', email: '[email]', jwt: '[jwt]' } as const;

function scrubSegment(seg: string, afterTenant: boolean): string {
  if (seg === '' || PLACEHOLDER.test(seg)) return seg;
  if (afterTenant) return P.tenant;
  if (DISPLAY_TOKEN.test(seg)) return P.token;
  if (UUID.test(seg)) return P.uuid;
  if (LONG_HEX.test(seg)) return P.hex;
  if (NUMERIC.test(seg)) return P.num;
  return seg;
}

/** A URL path as a route template: id-shaped segments and the segment after `/tenant/` replaced by placeholders. */
export function scrubPath(path: string): string {
  const segments = path.split('/');
  return segments.map((seg, i) => scrubSegment(seg, segments[i - 1] === 'tenant')).join('/');
}

/**
 * A request URL as a path template. The origin is dropped (a tenant's subdomain identifies the tenant), and so are the
 * query string and the fragment. Anything that does not parse as a URL is treated as a path.
 */
export function scrubUrl(url: string): string {
  let path = url;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try {
      path = new URL(url).pathname;
    } catch {
      path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
    }
  }
  const cut = path.search(/[?#]/);
  return scrubPath(cut === -1 ? path : path.slice(0, cut));
}

/** A transaction name: `GET /tenant/<id>/api/x` becomes `GET /tenant/[tenant]/api/x`. A name that is not path-like is left alone. */
export function scrubTransactionName(name: string): string {
  const m = /^([A-Z]+ )?(\/.*)$/.exec(name);
  return m ? `${m[1] ?? ''}${scrubUrl(m[2]!)}` : name;
}

/** Free text (an exception or breadcrumb message): JWTs, display tokens, uuids, emails and `/tenant/<segment>` paths replaced. */
export function scrubText(text: string): string {
  return text.replace(JWT_IN_TEXT, P.jwt).replace(DISPLAY_TOKEN_IN_TEXT, P.token).replace(EMAIL_IN_TEXT, P.email).replace(UUID_IN_TEXT, P.uuid).replace(TENANT_PATH_IN_TEXT, `$1${P.tenant}`);
}

const scrubStr = (v: unknown, fn: (s: string) => string): unknown => (typeof v === 'string' ? fn(v) : v);

function scrubRequest(request: unknown): unknown {
  if (!isObj(request)) return request;
  const { data: _data, headers: _headers, cookies: _cookies, query_string: _query, env: _env, ...rest } = request;
  return { ...rest, ...(typeof rest.url === 'string' ? { url: scrubUrl(rest.url) } : {}) };
}

function scrubException(exception: unknown): unknown {
  if (!isObj(exception) || !Array.isArray(exception.values)) return exception;
  return {
    ...exception,
    values: exception.values.map((v) => {
      if (!isObj(v)) return v;
      const out: Obj = { ...v };
      if (typeof v.value === 'string') out.value = scrubText(v.value);
      const frames = isObj(v.stacktrace) && Array.isArray(v.stacktrace.frames) ? v.stacktrace.frames : null;
      if (frames) {
        out.stacktrace = { ...(v.stacktrace as Obj), frames: frames.map((f) => (isObj(f) ? Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'vars')) : f)) };
      }
      return out;
    }),
  };
}

/** `beforeBreadcrumb`: message and url-like data scrubbed, request payload fields dropped. Returns a copy. */
export function scrubBreadcrumb<T>(breadcrumb: T): T {
  if (!isObj(breadcrumb)) return breadcrumb;
  const out: Obj = { ...breadcrumb };
  if (typeof breadcrumb.message === 'string') out.message = scrubText(breadcrumb.message);
  if (isObj(breadcrumb.data)) {
    const { request_body_size: _a, response_body_size: _b, body: _c, headers: _d, ...data } = breadcrumb.data;
    for (const key of ['url', 'from', 'to']) if (typeof data[key] === 'string') data[key] = scrubUrl(data[key] as string);
    out.data = data;
  }
  return out as T;
}

/**
 * A span of a transaction event: timings, op and name are kept; `data` is dropped (it carries urls, statements and bodies),
 * a database span loses its description (the statement is restricted content, class X), a url-shaped description becomes a template.
 */
function scrubSpan(span: unknown): unknown {
  if (!isObj(span)) return span;
  const { data: _data, ...rest } = span;
  if (typeof rest.description !== 'string') return rest;
  if (typeof rest.op === 'string' && rest.op.startsWith('db')) return { ...rest, description: '[statement]' };
  const m = /^([A-Z]+ )?((?:[a-z][a-z0-9+.-]*:\/\/|\/)\S*)$/i.exec(rest.description);
  return { ...rest, description: m ? `${m[1] ?? ''}${scrubUrl(m[2]!)}` : scrubText(rest.description) };
}

function scrubContexts(contexts: unknown): unknown {
  if (!isObj(contexts) || !isObj(contexts.trace)) return contexts;
  const { data: _data, ...trace } = contexts.trace;
  return { ...contexts, trace };
}

const USER_TAGS = new Set(['user.id', 'userId', 'user_id', 'user.email', 'user.username']);

/**
 * `beforeSend` / `beforeSendTransaction`: the event reduced to what may leave. Tags other than user identifiers are kept,
 * so `tenantId` and `requestId` survive. A non-object is returned unchanged.
 */
export function scrubSentryEvent<T>(event: T): T {
  if (!isObj(event)) return event;
  const { user: _user, ...rest } = event;
  const out: Obj = { ...rest };
  if ('request' in out) out.request = scrubRequest(out.request);
  if ('exception' in out) out.exception = scrubException(out.exception);
  if (typeof out.transaction === 'string') out.transaction = scrubTransactionName(out.transaction);
  if (typeof out.message === 'string') out.message = scrubText(out.message);
  if (isObj(out.logentry) && typeof out.logentry.message === 'string') out.logentry = { ...out.logentry, message: scrubText(out.logentry.message) };
  if (isObj(out.tags)) out.tags = Object.fromEntries(Object.entries(out.tags).filter(([k]) => !USER_TAGS.has(k)));
  if (isObj(out.extra)) out.extra = Object.fromEntries(Object.entries(out.extra).map(([k, v]) => [k, scrubStr(v, scrubText)]));
  if (Array.isArray(out.spans)) out.spans = out.spans.map(scrubSpan);
  if ('contexts' in out) out.contexts = scrubContexts(out.contexts);
  if (Array.isArray(out.breadcrumbs)) out.breadcrumbs = out.breadcrumbs.map((b) => scrubBreadcrumb(b));
  return out as T;
}
