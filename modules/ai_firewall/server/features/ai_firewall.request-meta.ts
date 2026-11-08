import type { Indicator, RouteClass, StatusClass, UaFamily } from './ai_firewall.feature-windows';

/**
 * The request metadata of `attack.v1` (docs/phases/55-ai-firewall/02 §2.1): what one request says about itself, as COUNTS AND CLASSES
 * only. Pure and synchronous; called for every request the proxy or the dispatcher observes, so it reads only what the request already
 * holds (no URL parse beyond `nextUrl`, no body, no lookup) and its regular expressions have bounded repetition (no backtracking blow-up
 * on attacker-chosen text; the scanned text is capped at INDICATOR_SCAN_MAX characters).
 *
 * Never kept: the path, the query, the body, a header value. The only value that leaves this file is a numeric id at the end of the path
 * (`numericId`), which the fold compares with the actor's previous one in memory to count sequential steps and then forgets.
 */
export interface RequestMetaInput {
  phase: 'proxy' | 'api';
  method: string;
  /** Tenant-relative path. */
  path: string;
  /** The query string with or without its `?`, or ''. */
  search: string;
  headers: { get(name: string): string | null };
  /** The registry route template (dispatcher), or null. */
  route: string | null;
  /** The answer's status, null when unknown (a page the proxy forwarded). */
  status: number | null;
  responseBytes: number | null;
}

export interface RequestMeta {
  routeClass: RouteClass;
  statusClass: StatusClass;
  write: boolean;
  oddMethod: boolean;
  pathDepth: number;
  /** Shannon entropy of the path's characters, bits per character × 100, rounded. */
  pathEntropy100: number;
  paramCount: number;
  paramBytes: number;
  payloadBytes: number;
  responseBytes: number;
  indicators: Record<Indicator, number>;
  uaFamily: UaFamily;
  headerAnomalies: number;
  numericId: number | null;
  pageDepth: number | null;
  authOutcome: 'ok' | 'fail' | null;
  adminAction: boolean;
  exportBytes: number;
}

export const INDICATOR_SCAN_MAX = 2_048;
const ENTROPY_SCAN_MAX = 512;
const PARAMS_MAX = 1_000;
const BYTES_MAX = 1e12;
export const DEEP_PAGE = 10;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const USUAL_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']);

const AUTH_ROUTE = /^\/api\/auth(?:\/|$)/;
const PUBLIC_ROUTE = /^\/api\/public(?:\/|$)/;
const EXPORT_ROUTE = /(?:^|[/-])(?:exports?|download)(?:[/-]|$)/;
const ADMIN_ROUTE = /\/(?:admin|settings|roles?|permissions?|members|api-keys|impersonat[a-z]*|sso|saml|scim|audit-logs?|ai-firewall|security|billing|platform)(?:\/|$)/;
const PARAM_SEGMENT = /^\[{1,2}(?:\.\.\.)?[^\]]+\]{1,2}$/;
const ID_SEGMENT = /^(?:\d{1,19}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const NUMERIC_SEGMENT = /^\d{1,15}$/;

/**
 * Whether a proxy request is a document navigation (D55-44): a Next client-side navigation or prefetch (`RSC`, `Next-Router-Prefetch`,
 * `Purpose: prefetch`) and a browser fetch of anything but a document (`Sec-Fetch-Dest`) are not page loads, so a returning browser
 * (assets cached) does not read as "pages without assets". A client sending no fetch metadata (a script) counts as a navigation.
 */
export function isDocumentNavigation(headers: RequestMetaInput['headers'] | undefined): boolean {
  if (!headers) return true;
  if (headers.get('rsc') !== null || headers.get('next-router-prefetch') !== null) return false;
  const purpose = headers.get('purpose') ?? headers.get('sec-purpose');
  if (purpose && /prefetch/i.test(purpose)) return false;
  const dest = headers.get('sec-fetch-dest');
  return !dest || dest === 'document' || dest === 'iframe';
}

/**
 * The route class (sensitivity) of a request: the template when the dispatcher matched one, else the path. A proxy request for a page
 * is `page` when it is a document navigation (`headers` given, `isDocumentNavigation`), else `other`.
 */
export function routeClassOf(
  phase: 'proxy' | 'api', method: string, path: string, route: string | null, headers?: RequestMetaInput['headers'],
): RouteClass {
  const p = route ?? path;
  if (phase === 'proxy' && !/^\/api(?:\/|$)/.test(p)) return isDocumentNavigation(headers) ? 'page' : 'other';
  if (AUTH_ROUTE.test(p)) return 'auth';
  if (PUBLIC_ROUTE.test(p)) return 'public';
  if (EXPORT_ROUTE.test(p)) return 'export';
  if (ADMIN_ROUTE.test(p)) return 'admin';
  if (!SAFE_METHODS.has(method)) return 'write';
  const segments = p.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  if (route ? PARAM_SEGMENT.test(last) : ID_SEGMENT.test(last)) return 'read';
  return segments.length > 1 ? 'list' : 'other';
}

export function statusClassOf(status: number | null): StatusClass {
  if (status === null || !Number.isFinite(status)) return 'fwd';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status === 401 || status === 403 || status === 404 || status === 429) return String(status) as StatusClass;
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500) return '5xx';
  return 'fwd';
}

/** Bits per character × 100 over the first ENTROPY_SCAN_MAX characters. */
export function entropy100(text: string): number {
  const n = Math.min(text.length, ENTROPY_SCAN_MAX);
  if (n === 0) return 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    const c = text.charCodeAt(i);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let h = 0;
  for (const k of counts.values()) {
    const p = k / n;
    h -= p * Math.log2(p);
  }
  return Math.round(h * 100);
}

const INDICATOR_PATTERNS: Readonly<Record<Indicator, RegExp>> = {
  sql: /\bunion\b[\s\S]{0,40}?\bselect\b|\bselect\b[\s\S]{0,80}?\bfrom\b|\b(?:or|and)\s+['"]?\d{1,9}['"]?\s{0,4}=\s{0,4}['"]?\d{1,9}|'\s{0,4}(?:or|and)\s+'|--\s|;\s{0,4}(?:drop|delete|insert|update|truncate)\b|\bsleep\s{0,4}\(|\bbenchmark\s{0,4}\(|information_schema|\bwaitfor\s+delay\b/g,
  script: /<\s{0,4}script|javascript:|\bon(?:error|load|mouseover|focus|click)\s{0,4}=|<\s{0,4}(?:svg|iframe|img|object|embed)\b|\balert\s{0,4}\(|document\.cookie/g,
  traversal: /\.\.[/\\]|%2e%2e|\betc\/(?:passwd|shadow|hosts)|\\windows\\|win\.ini|\/proc\/self/g,
  template: /\{\{|\$\{|<%|#\{|\{%/g,
  command: /[;&|]\s{0,4}(?:ls|cat|id|whoami|uname|wget|curl|nc|bash|sh|ping|nslookup|powershell)\b|`[^`]{1,40}`|\$\([^)]{1,40}\)/g,
};
const INDICATOR_KEYS = Object.keys(INDICATOR_PATTERNS) as Indicator[];

function countMatches(re: RegExp, text: string): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) {
    n += 1;
    if (n >= 100) break;
  }
  re.lastIndex = 0;
  return n;
}

/** Indicator token counts in the path and query, decoded once (a failed decode scans the raw text), lower case. */
export function indicatorCounts(path: string, search: string): Record<Indicator, number> {
  const raw = (search ? `${path} ${search}` : path).slice(0, INDICATOR_SCAN_MAX);
  let text = raw;
  if (raw.includes('%') || raw.includes('+')) {
    try { text = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { text = raw; }
  }
  text = text.toLowerCase();
  const out = { sql: 0, script: 0, traversal: 0, template: 0, command: 0 } as Record<Indicator, number>;
  for (const k of INDICATOR_KEYS) out[k] = countMatches(INDICATOR_PATTERNS[k], text);
  return out;
}

const UA_BOT = /bot\b|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|phantomjs|selenium|puppeteer|playwright/i;
const UA_CLI = /^(?:curl|wget|httpie|libwww|lwp|powershell|fetch\/)/i;
const UA_LIBRARY = /python-requests|python-urllib|python\/|aiohttp|httpx|go-http-client|java\/|okhttp|apache-httpclient|axios|node-fetch|undici|\bgot\b|ruby|php\/|guzzle|scrapy|postman|insomnia|dart\//i;
const UA_MOBILE = /mobile|android|iphone|ipad/i;
const UA_BROWSER = /^mozilla\/5\.0/i;

export function uaFamilyOf(userAgent: string | null): UaFamily {
  const ua = (userAgent ?? '').trim();
  if (!ua) return 'empty';
  if (UA_BOT.test(ua)) return 'bot';
  if (UA_CLI.test(ua)) return 'cli';
  if (UA_LIBRARY.test(ua)) return 'library';
  if (UA_BROWSER.test(ua)) return UA_MOBILE.test(ua) ? 'mobile' : 'browser';
  return 'other';
}

/** How many of the cheap header and request-line anomalies this request shows (0..8). */
export function headerAnomaliesOf(method: string, path: string, search: string, headers: RequestMetaInput['headers'], family: UaFamily): number {
  let n = 0;
  if (!headers.get('accept')) n += 1;
  if ((family === 'browser' || family === 'mobile') && !headers.get('accept-language')) n += 1;
  const ua = headers.get('user-agent');
  if (ua && ua.length > 512) n += 1;
  const xff = headers.get('x-forwarded-for');
  if (xff && xff.split(',').length > 8) n += 1;
  if (SAFE_METHODS.has(method) && Number(headers.get('content-length') ?? 0) > 0) n += 1;
  if (path.includes('//') || path.includes('\\') || /%2f|%5c/i.test(path)) n += 1;
  if (/%00|\u0000/.test(path) || /%00/.test(search)) n += 1;
  if (/%25[0-9a-f]{2}/i.test(path) || /%25[0-9a-f]{2}/i.test(search)) n += 1;
  return n;
}

function bytes(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, BYTES_MAX) : 0;
}

/** The query's parameter count and the page depth of a list read (page=N, or offset / limit). One pass, no URLSearchParams. */
function queryShape(search: string): { count: number; pageDepth: number | null } {
  const q = search.startsWith('?') ? search.slice(1) : search;
  if (!q) return { count: 0, pageDepth: null };
  let count = 0;
  let page: number | null = null;
  let offset: number | null = null;
  let limit: number | null = null;
  for (const part of q.split('&')) {
    if (!part) continue;
    count += 1;
    if (count > PARAMS_MAX) break;
    const eq = part.indexOf('=');
    const name = (eq === -1 ? part : part.slice(0, eq)).toLowerCase();
    const value = eq === -1 ? '' : part.slice(eq + 1);
    if (!/^\d{1,9}$/.test(value)) continue;
    if (name === 'page' || name === 'p') page = Number(value);
    else if (name === 'offset' || name === 'skip') offset = Number(value);
    else if (name === 'limit' || name === 'take' || name === 'pagesize' || name === 'page_size' || name === 'per_page') limit = Number(value);
  }
  let pageDepth: number | null = page;
  if (pageDepth === null && offset !== null) pageDepth = Math.floor(offset / Math.max(1, limit ?? 20)) + 1;
  return { count: Math.min(count, PARAMS_MAX), pageDepth };
}

/** The whole metadata of one request. Never throws on any input (the caller still guards it). */
export function requestMetaOf(input: RequestMetaInput): RequestMeta {
  const method = (input.method || 'GET').toUpperCase();
  const path = input.path || '/';
  const search = input.search || '';
  const routeClass = routeClassOf(input.phase, method, path, input.route, input.headers);
  const statusClass = statusClassOf(input.status);
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  const { count, pageDepth } = queryShape(search);
  const uaFamily = uaFamilyOf(input.headers.get('user-agent'));
  const responseBytes = input.responseBytes !== null && input.responseBytes > 0 ? Math.min(input.responseBytes, BYTES_MAX) : 0;
  const ok = statusClass === '2xx' || statusClass === '3xx';
  return {
    routeClass,
    statusClass,
    write: !SAFE_METHODS.has(method),
    oddMethod: !USUAL_METHODS.has(method),
    pathDepth: segments.length,
    pathEntropy100: entropy100(path),
    paramCount: count,
    paramBytes: Math.max(0, search.startsWith('?') ? search.length - 1 : search.length),
    payloadBytes: bytes(input.headers.get('content-length')),
    responseBytes,
    indicators: indicatorCounts(path, search),
    uaFamily,
    headerAnomalies: headerAnomaliesOf(method, path, search, input.headers, uaFamily),
    numericId: NUMERIC_SEGMENT.test(last) ? Number(last) : null,
    pageDepth: !SAFE_METHODS.has(method) ? null : pageDepth,
    authOutcome: routeClass !== 'auth' || statusClass === 'fwd' ? null : ok ? 'ok' : statusClass === '5xx' ? null : 'fail',
    adminAction: routeClass === 'admin' && !SAFE_METHODS.has(method),
    exportBytes: routeClass === 'export' && statusClass === '2xx' ? responseBytes : 0,
  };
}
