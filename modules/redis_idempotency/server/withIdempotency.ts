import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { RedisIdempotencyService } from '@kuraykaraaslan-labs/redis_idempotency';

/** The URL tenant, only when it is a UUID: a segment like `T:abcdefgh` must not address another tenant's record (redis_idempotency.03). */
function extractTenantId(pathname: string): string {
  const seg = pathname.match(/\/tenant\/([^/]+)/)?.[1];
  return seg && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ? seg : 'unknown';
}

/**
 * Who earned a response (D1): a hash of the caller's credential (the session cookie, the Authorization header or the API key
 * header; nothing = anonymous), the method and the route. The wrapper runs before the route's guard, so the credential is not
 * verified here and does not need to be: it only has to differ between callers. The key itself stays `(tenant, key)`, so a
 * duplicate is still never executed twice; only the REPLAY of a stored body is limited to the same fingerprint.
 */
function credentialOf(request: NextRequest): string | null {
  return request.cookies.get('accessToken')?.value
    ?? request.headers.get('authorization')
    ?? request.headers.get('x-api-key')
    ?? null;
}

function ownerOf(request: NextRequest): string {
  const credential = credentialOf(request) ?? 'anonymous';
  return createHash('sha256').update(`${credential}\u0000${request.method}\u0000${request.nextUrl.pathname}`).digest('hex');
}

/** redis_idempotency.04: the fingerprint of the request body, so the same key sent with a different body is told apart. */
async function requestFingerprint(request: NextRequest, fingerprintBody?: (body: string) => string): Promise<string> {
  const body = await request.clone().text().catch(() => '');
  return createHash('sha256').update(fingerprintBody ? fingerprintBody(body) : body).digest('hex');
}

/**
 * HTTP-layer idempotency for mutating route handlers, keyed on the
 * `Idempotency-Key` request header. No header → the handler runs unchanged.
 *
 *  - **Atomic claim** (SET NX via `acquire`) so two concurrent duplicates can't
 *    both execute.
 *  - A duplicate that arrives *after* completion replays the stored response
 *    (`Idempotency-Replayed: true`) to the same caller and route only (D1);
 *    anybody else presenting the key gets 401 (anonymous) or 403.
 *  - A duplicate that arrives while the first is still in flight gets `409`.
 *  - **Only 2xx responses are cached**; a non-2xx (or thrown handler) releases
 *    the claim so a genuine retry can proceed instead of being stuck for 24h.
 *  - Redis down → the claim is taken in the durable store (a database row); only when that cannot answer either is the
 *    request refused 503 with Retry-After (redis_idempotency.02): a request that sent a key is never run unguarded.
 *  - The same key with a different body from the same caller → 422 (redis_idempotency.04).
 */
export interface WithIdempotencyOptions {
  /**
   * Keep the claim (`pending`) when the handler fails with a 5xx or throws, instead of releasing it (payment.22). For a write
   * that may have COMMITTED before the failure reached the client (a lost acknowledgement), a retry with the same key must
   * not run it a second time: it is answered 409 until the claim expires. A 4xx (nothing written) still releases.
   */
  keepClaimOnServerError?: boolean;
  /**
   * What of the body the stored fingerprint covers (default: all of it). The fingerprint is an unkeyed SHA-256 kept for 24h,
   * so a body that carries data which must never be stored, even hashed (a card number and CVV: PCI DSS), passes a
   * function that leaves those fields out. The rest of the body still tells a different request apart.
   */
  fingerprintBody?: (body: string) => string;
}

/**
 * redis_idempotency.05: the keys this process is executing right now. The Redis claim is the cross-process guarantee; this
 * set is the fence for when that claim vanishes mid-flight (maxmemory eviction, FLUSH): a duplicate reaching the SAME process
 * is still refused 409. Across processes the guarantee is only as durable as the Redis key (run Redis with `noeviction`).
 */
const inFlight = new Set<string>();

export function withIdempotency<Ctx>(
  handler: (request: NextRequest, context: Ctx) => Promise<NextResponse>,
  options: WithIdempotencyOptions = {},
): (request: NextRequest, context: Ctx) => Promise<NextResponse> {
  return async (request: NextRequest, context: Ctx): Promise<NextResponse> => {
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) return handler(request, context);

    try {
      RedisIdempotencyService.validateKey(idempotencyKey);
    } catch {
      return NextResponse.json(
        { message: 'Idempotency-Key must be 8-255 chars of [A-Za-z0-9._:-].' },
        { status: 422 },
      );
    }

    const tenantId = extractTenantId(request.nextUrl.pathname);
    const fence = `${tenantId.toLowerCase()}\u0000${idempotencyKey}`;
    if (inFlight.has(fence)) {
      return NextResponse.json(
        { message: 'A request with this Idempotency-Key is already being processed.' },
        { status: 409, headers: { 'Retry-After': '1' } },
      );
    }
    const owner = ownerOf(request);
    const fingerprint = await requestFingerprint(request, options.fingerprintBody);
    const claim = await RedisIdempotencyService.acquire(tenantId, idempotencyKey);

    // redis_idempotency.02: the caller SENT a key, i.e. asked not to be executed twice. Without Redis that promise cannot be
    // kept, so the request is refused (503, retryable) instead of run unguarded, where every retry would execute again.
    // (`degraded` means the durable store could not answer either; a durable claim is a normal claim.)
    if (claim.degraded) {
      return NextResponse.json(
        { message: 'Idempotency is temporarily unavailable; retry the request later.' },
        { status: 503, headers: { 'Retry-After': '5' } },
      );
    }

    // Someone else owns the key (and Redis is healthy).
    if (!claim.acquired) {
      // D1: the stored body is replayed only to the caller (credential, method, route) that earned it. Anybody else who
      // presents the key gets the same 409 as an in-flight duplicate: nothing runs twice and nothing leaks.
      if (claim.existing?.status === 'completed' && claim.existing.response) {
        // redis_idempotency.01: outside /tenant/<id>/ every caller shares one namespace, and anonymous callers share one
        // fingerprint, so a stored body is never replayed to an anonymous caller there: the duplicate is refused (409).
        if (tenantId === 'unknown' && !credentialOf(request)) {
          return NextResponse.json(
            { message: 'A request with this Idempotency-Key was already processed.' },
            { status: 409 },
          );
        }
        if (claim.existing.response.owner === owner) {
          // redis_idempotency.04: the same caller reusing the key for a DIFFERENT body is a client error, never answered with
          // the first body's response (it would look like the second operation succeeded).
          if (claim.existing.response.request && claim.existing.response.request !== fingerprint) {
            return NextResponse.json(
              { message: 'This Idempotency-Key was already used with a different request body.' },
              { status: 422 },
            );
          }
          return NextResponse.json(claim.existing.response.body, {
            status: claim.existing.response.statusCode,
            headers: { 'Idempotency-Replayed': 'true' },
          });
        }
        // D1: a completed key presented by anybody but the caller and route that earned it: nothing runs, nothing is replayed.
        // An anonymous caller is told to authenticate (401), a signed-in one that the key is not theirs (403).
        return NextResponse.json(
          { message: 'This Idempotency-Key belongs to another request.' },
          { status: credentialOf(request) ? 403 : 401 },
        );
      }
      return NextResponse.json(
        { message: 'A request with this Idempotency-Key is already being processed.' },
        { status: 409, headers: { 'Retry-After': '1' } },
      );
    }

    let response: NextResponse;
    inFlight.add(fence);
    try {
      response = await handler(request, context);
    } catch (err) {
      if (!options.keepClaimOnServerError) await RedisIdempotencyService.release(tenantId, idempotencyKey);
      throw err;
    } finally {
      inFlight.delete(fence);
    }

    if (response.status >= 200 && response.status < 300) {
      const body = await response.clone().json().catch(() => null);
      await RedisIdempotencyService.setCompleted(tenantId, idempotencyKey, {
        body,
        statusCode: response.status,
        owner,
        request: fingerprint,
      });
    } else if (!(options.keepClaimOnServerError && response.status >= 500)) {
      // Never cache a failure — the client should be able to retry (unless a 5xx may have committed, see keepClaimOnServerError).
      await RedisIdempotencyService.release(tenantId, idempotencyKey);
    }

    return response;
  };
}
