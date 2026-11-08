import { lookup as dnsLookup } from 'node:dns';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { fetch as undiciFetch, request as undiciRequest, Agent, type RequestInit as UndiciRequestInit, type Response as UndiciResponse } from 'undici';
import { isAddressAllowed, ipv4ToInt, ipv6ToBigInt, type AllowlistMode } from './ip-guard';

/**
 * SSRF-safe outbound fetch with DNS-rebinding-proof IP pinning.
 *
 * The problem `safeFetch` closes: validating a URL by resolving its host and
 * then calling `fetch(url)` re-resolves DNS, so an attacker can answer the first
 * lookup with a public IP and the second with `169.254.169.254`. Here the SAME
 * resolution that validates the address is the one the connection uses — undici
 * connects to whatever the `connect.lookup` returns — so there is no second
 * lookup and no window. The Host header and TLS SNI stay the URL's hostname
 * (undici sets those from the request, not from the pinned IP).
 *
 * Uses undici's `fetch` directly (not the global) so the per-request `dispatcher`
 * is honoured even where Next.js wraps global fetch.
 */

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | { address: string; family: number }[], family?: number) => void;

/**
 * A `net.connect`-compatible lookup that resolves ALL addresses, rejects the
 * connection if ANY is a blocked/disallowed range, and otherwise hands back a
 * validated address for the socket to connect to.
 */
export function createValidatingLookup(ipAllowlist?: string[] | null, resolve: typeof dnsLookup = dnsLookup, mode: AllowlistMode = 'only') {
  return (hostname: string, options: { family?: number; hints?: number; all?: boolean } | number, callback: LookupCb): void => {
    const opts = typeof options === 'number' ? { family: options } : (options || {});
    resolve(hostname, { all: true, family: opts.family ?? 0, hints: opts.hints }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as { address: string; family: number }[];
      if (!list || list.length === 0) {
        return callback(new SsrfError(`Host "${hostname}" did not resolve to any address.`) as NodeJS.ErrnoException);
      }
      for (const a of list) {
        if (!isAddressAllowed(a.address, ipAllowlist, mode)) {
          return callback(new SsrfError(`Host "${hostname}" resolves to ${a.address}, a private/blocked or non-allowlisted address.`) as NodeJS.ErrnoException);
        }
      }
      // Every resolved address passed; connect to the first. `all` is false for
      // net.connect, so return a single (address, family); honour all:true too.
      if (opts.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

// The no-allowlist case is the overwhelmingly common one — share a single Agent
// (each Agent owns a connection pool) so we don't build one per request.
// common.05: undici's own defaults wait 300 s for headers and 300 s between body chunks, so a slow-loris target holds a
// connection (and the caller's request) for minutes. Every agent of this module answers within these bounds instead; a
// caller that needs less passes its own AbortSignal.
export const SAFE_FETCH_HEADERS_TIMEOUT_MS = 30_000;
export const SAFE_FETCH_BODY_TIMEOUT_MS = 60_000;
const TIMEOUTS = { headersTimeout: SAFE_FETCH_HEADERS_TIMEOUT_MS, bodyTimeout: SAFE_FETCH_BODY_TIMEOUT_MS };

const defaultAgent = new Agent({ ...TIMEOUTS, connect: { lookup: createValidatingLookup(null) as never } });

/**
 * TLS material merged into the pinned agent's `connect` options (automation 10 §10.3, NX-04): a custom CA bundle, a client
 * certificate and key (mutual TLS), and `rejectUnauthorized: false` for a sink that turned verification off. The pinning
 * lookup stays: TLS options never widen what may be reached.
 */
export interface SafeFetchTls {
  /** PEM CA bundle that replaces the default trust store. */
  ca?: string;
  /** PEM client certificate (the chain may follow it) and its private key. */
  cert?: string;
  key?: string;
  passphrase?: string;
  rejectUnauthorized?: boolean;
}

export interface SafeFetchOptions {
  /** IP allowlist. Default mode `only`: ONLY these may be reached, and only where they are public (a tenant's list narrows). */
  ipAllowlist?: string[] | null;
  /** `operator`: an operator list that may open private ranges; `public_or_listed`: public addresses plus the listed ones (a probe runner inside a private network). Default `only`. */
  ipAllowlistMode?: AllowlistMode;
  tls?: SafeFetchTls;
}

/**
 * Agents for an allowlist or TLS material, one per distinct (allowlist, material): the same config version reuses its
 * connection pool, a changed certificate gets a new agent. Keyed by a hash so no key material is held as a map key;
 * the oldest agent is closed past the cap.
 */
const MAX_AGENTS = 256;
const agents = new Map<string, Agent>();

function agentFor(allow: string[] | null, tls: SafeFetchTls | undefined, mode: AllowlistMode = 'only'): Agent {
  const key = createHash('sha256').update(JSON.stringify([allow, tls ?? null, mode])).digest('hex');
  const hit = agents.get(key);
  if (hit) {
    agents.delete(key);
    agents.set(key, hit);
    return hit;
  }
  const agent = new Agent({ ...TIMEOUTS, connect: { ...tls, lookup: createValidatingLookup(allow, undefined, mode) as never } });
  agents.set(key, agent);
  if (agents.size > MAX_AGENTS) {
    const [oldKey, old] = agents.entries().next().value as [string, Agent];
    agents.delete(oldKey);
    void old.close().catch(() => undefined);
  }
  return agent;
}

/**
 * Drop-in replacement for `fetch` for any request to a user/tenant-controlled URL.
 * Defaults to `redirect: 'manual'` (a redirect re-resolves DNS; even though the
 * pinning lookup would re-validate each hop, not following is safer for webhooks).
 * Pass `redirect: 'follow'` explicitly when a sink must follow — hops are still
 * validated by the same pinning lookup.
 */
/** The URL's host when it is an IP literal (`10.0.0.1`, `[::1]`, and the integer / hex / octal IPv4 forms the URL parser normalises), else null. */
function ipLiteralHost(url: string | URL): string | null {
  let host: string;
  try { host = new URL(String(url)).hostname; } catch { return null; }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (ipv4ToInt(host) !== null) return host;
  return host.includes(':') && ipv6ToBigInt(host) !== null ? host : null;
}

/** The dispatcher a request goes through, after the IP literal of the URL has been judged (it never reaches the pinning lookup). Throws `SsrfError` for a blocked literal. */
function guardedDispatcher(url: string | URL, opts: SafeFetchOptions): Agent {
  const allow = opts.ipAllowlist?.filter(Boolean);
  // F.common.01 / common.02: Node never calls the pinning `lookup` for a host that is already an IP literal, so such a URL used
  // to connect wherever it pointed (169.254.169.254, 127.0.0.1, [::1]). It is judged here, with the same predicate, before any
  // connection is attempted.
  const literal = ipLiteralHost(url);
  if (literal !== null && !isAddressAllowed(literal, allow, opts.ipAllowlistMode)) {
    throw new SsrfError(`Address ${literal} is a private/blocked or non-allowlisted address.`);
  }
  const tls = opts.tls && Object.values(opts.tls).some((v) => v !== undefined) ? opts.tls : undefined;
  return (allow && allow.length > 0) || tls ? agentFor(allow && allow.length > 0 ? allow : null, tls, opts.ipAllowlistMode) : defaultAgent;
}

export async function safeFetch(
  url: string | URL,
  init: UndiciRequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<UndiciResponse> {
  const dispatcher = guardedDispatcher(url, opts);
  return undiciFetch(url, {
    redirect: 'manual',
    ...init,
    dispatcher,
  });
}

/** The largest request body `safeFetchGetBody` sends: a request document (a few hundred bytes in practice), never a payload. */
export const SAFE_GET_BODY_MAX_BYTES = 16 * 1024;

export interface SafeGetBodyInit {
  headers?: Record<string, string>;
  /** The request body (a document); sent with its length. At most `SAFE_GET_BODY_MAX_BYTES` bytes (a `RangeError` before any connection otherwise). */
  body: string | Uint8Array;
  signal?: AbortSignal;
}

/**
 * `GET` WITH a request body, through the same IP-pinned agents, literal check and timeouts as `safeFetch`. The fetch standard forbids a body on a GET
 * (`safeFetch` throws), yet some devices (Hikvision cameras' `ContentMgmt/download`) only answer a GET that carries its request document in the body.
 * Only that one shape is offered: the method is fixed, the body is a string or bytes (never a stream), a redirect is never followed (the answer's 3xx is
 * returned for the caller to refuse). The answer is a `Response` whose body is the unread stream, so a caller's bounded reader and its abort work as with `safeFetch`.
 * `request` does not decode a `Content-Encoding` as `fetch` does, so the request asks for `identity` (replacing any `Accept-Encoding` of the caller) and an
 * answer that is encoded anyway is refused rather than handed over as compressed bytes under a header that says so.
 */
export async function safeFetchGetBody(url: string | URL, init: SafeGetBodyInit, opts: SafeFetchOptions = {}): Promise<UndiciResponse> {
  const size = typeof init.body === 'string' ? Buffer.byteLength(init.body) : init.body.byteLength;
  if (size > SAFE_GET_BODY_MAX_BYTES) throw new RangeError(`A GET request body is at most ${SAFE_GET_BODY_MAX_BYTES} bytes (got ${size}).`);
  const dispatcher = guardedDispatcher(url, opts);
  // undici's `request` connects before it looks at a signal that is already aborted (`fetch` does not): an ended call must not open a connection
  init.signal?.throwIfAborted();
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).filter(([name]) => name.toLowerCase() !== 'accept-encoding'));
  headers['accept-encoding'] = 'identity';
  const res = await undiciRequest(url, { method: 'GET', headers, body: init.body, signal: init.signal, dispatcher });
  const answered = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (Array.isArray(value)) for (const v of value) answered.append(name, v);
    else if (value !== undefined) answered.append(name, value);
  }
  const encoding = (answered.get('content-encoding') ?? '').trim().toLowerCase();
  if (encoding !== '' && encoding !== 'identity') {
    await res.body.dump().catch(() => undefined);
    throw new Error(`The answer is encoded (Content-Encoding: ${encoding}) although only identity was asked for.`);
  }
  const bodyless = res.statusCode === 204 || res.statusCode === 205 || res.statusCode === 304;
  if (bodyless) await res.body.dump(); // releases the connection; destroy() would raise an unhandled AbortError
  return new Response(bodyless ? null : (Readable.toWeb(res.body) as ReadableStream<Uint8Array>), { status: res.statusCode, headers: answered }) as unknown as UndiciResponse;
}
