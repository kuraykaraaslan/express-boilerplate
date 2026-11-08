import crypto from 'crypto';
import { z } from 'zod';
import redis from '@kuraykaraaslan-labs/redis';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

/**
 * Generic short-lived, single-use WebSocket handshake tickets.
 *
 * Flow: the client calls an authenticated HTTP endpoint to mint a ticket, then
 * presents it on the Socket.IO handshake. The gateway consumes it atomically
 * (GETDEL) so a ticket can never be replayed. The ticket string IS the Redis
 * lookup key suffix (flat, not tenant-prefixed — the gateway only receives the
 * opaque ticket); the identity/payload travels inside the value.
 *
 * Redis-only (no `socket.io`). A consumer parameterizes the key prefix (e.g.
 * `msg:ws-ticket`) so multiple domains never collide.
 *
 * Every ticket names a user (docs/phases/13-websocket/04 §4.8): `mint` throws on a
 * payload without a non-empty `userId`, and `consume` treats one as no ticket, so
 * the handshake refuses it with `unauthorized`. The mint routes take the user from
 * `wsTicketSubject` (`websocket.session-binding.ts`), which also refuses a caller
 * that is not a full user session.
 */

/** The one field every ticket payload carries: the user the socket belongs to. */
export interface WsTicketPayloadBase {
  userId: string;
}

/**
 * The longest string `consume` will look up. A real ticket is 43 base64url characters (32 random bytes); anything longer,
 * or with other characters, cannot be one, so it is refused before it costs a Redis round trip on a key of its size
 * (risk register websocket.05: any string in `handshake.auth.ticket` used to become a `GETDEL` key).
 */
export const MAX_TICKET_LENGTH = 128;
const TICKET_SHAPE = /^[A-Za-z0-9_-]+$/;

const ticketId = z.string().min(1).max(64);

/**
 * The fields every ticket payload shares, as a schema a namespace extends with its own and parses in `authenticate`
 * (risk register websocket.11): a payload altered in Redis (a numeric tenant, an object for an id) is then no identity,
 * instead of becoming room names. Unknown keys are stripped.
 */
export const WsTicketBaseSchema = z.object({
  userId: ticketId,
  tenantId: ticketId,
  userSessionId: ticketId.optional(),
  sessionExpiresAt: z.number().finite().optional(),
  /** The Origin of the request that minted the ticket (websocket.04). */
  origin: z.string().min(1).max(256).optional(),
  iat: z.number().finite().optional(),
});

/** Parse a consumed payload with a namespace's schema: the identity, or null when it is missing or of the wrong shape. */
export function parseTicketPayload<S extends z.ZodTypeAny>(schema: S, payload: unknown): z.infer<S> | null {
  if (payload == null) return null;
  const parsed = schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function namesUser(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const userId = (payload as { userId?: unknown }).userId;
  return typeof userId === 'string' && userId.length > 0;
}

export interface WsTicketServiceOptions {
  /** TTL in seconds for a minted ticket. Default 30. */
  ttlSeconds?: number;
}

export function createWsTicketService<Payload extends WsTicketPayloadBase>(keyPrefix: string, options: WsTicketServiceOptions = {}) {
  const TICKET_TTL_SECONDS = options.ttlSeconds ?? 30;

  /** Flat Redis key for a ticket — shared by minter (HTTP) and consumer (gateway). */
  const ticketKey = (ticket: string): string => `${keyPrefix}:${ticket}`;

  /** Mint a single-use ticket carrying `payload`. */
  async function mint(payload: Payload): Promise<{ ticket: string; expiresIn: number }> {
    if (!namesUser(payload)) throw new Error(`${keyPrefix}: a socket ticket must name a user`);
    const ticket = crypto.randomBytes(32).toString('base64url');
    // A ticket that was not stored cannot be consumed, so handing it out would only fail later at the handshake. A Redis that cannot
    // answer (ioredis gives up with MaxRetriesPerRequestError) or a refused NX is the defined 503, not a raw client error turned into a 500
    // (live lane 1, dynamic_page "the collab ticket mint settles (refused) within a bound when Redis is offline").
    let stored: unknown;
    try {
      stored = await redis.set(ticketKey(ticket), JSON.stringify(payload), 'EX', TICKET_TTL_SECONDS, 'NX');
    } catch {
      stored = null;
    }
    if (stored !== 'OK') throw new AppError('Real-time connection is temporarily unavailable', 503, ErrorCode.PROVIDER_UNAVAILABLE);
    return { ticket, expiresIn: TICKET_TTL_SECONDS };
  }

  /**
   * Atomically consume a ticket (read + delete in one round trip). Returns the
   * payload on success or null if missing/expired/already used, if the stored
   * payload names no user, or (without touching Redis) if the string cannot be a
   * ticket at all.
   */
  async function consume(ticket: string): Promise<Payload | null> {
    if (typeof ticket !== 'string' || !ticket || ticket.length > MAX_TICKET_LENGTH || !TICKET_SHAPE.test(ticket)) return null;
    let raw: string | null;
    try {
      // GETDEL (Redis 6.2+) — single-use without a GET/DEL race.
      raw = (await redis.call('GETDEL', ticketKey(ticket))) as string | null;
    } catch {
      return null;
    }
    if (!raw) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
    return namesUser(payload) ? (payload as Payload) : null;
  }

  return { TICKET_TTL_SECONDS, ticketKey, mint, consume };
}

export type WsTicketService<Payload extends WsTicketPayloadBase> = ReturnType<typeof createWsTicketService<Payload>>;
