/**
 * Shared contract of the live-tail namespace (phase 18.2): names, limits, the ticket payload, the bridge event. socket.io-FREE and
 * websocket-module-free on purpose, like `status.realtime.ts`: the Next process (the ticket route, the erasure announcement) and the
 * gateway both read it, and `websocket` is an OPTIONAL dependency, so the one publish call loads its pubsub subpath lazily.
 */
import { z } from 'zod';

export const TAIL_NAMESPACE_PATH = '/telemetry-tail';
/** Redis channel the gateway listens on for "this tenant's tails must end" announcements (erasure). */
export const TAIL_CHANNEL = 'obs:telemetry-tail';
export const TAIL_TICKET_PREFIX = 'obs:tail-ticket';

/** Client -> server events and server -> client events. There is no client `join`: the tenant comes from the ticket and nowhere else. */
export const TAIL_EVENTS = {
  START: 'tail:start',
  STOP: 'tail:stop',
  LINES: 'tail:lines',
  STARTED: 'tail:started',
  ERROR: 'tail:error',
  END: 'tail:end',
} as const;

export type TailErrorCode = 'invalid_filter' | 'busy' | 'not_configured' | 'unsupported' | 'backend_unavailable' | 'rate_limited';
export type TailEndReason = 'stopped' | 'line_budget' | 'session_time' | 'erased' | 'backend_unavailable';

/** What bounds one tail. The gateway enforces the connection caps (`limits` on the descriptor); the session enforces the rest. */
export const TAIL_LIMITS = {
  /** Sockets per tenant, counted cluster-wide by the gateway. */
  maxConnectionsPerTenant: 20,
  /** Sockets per user. */
  maxConnectionsPerUser: 3,
  /** A socket runs one tail at a time; a second `tail:start` replaces the first. */
  maxRoomsPerSocket: 1,
  /** `tail:start` / `tail:stop` frames per minute per socket. */
  inboundEventsPerMinute: 30,
  /** Seconds between polls of the backend. */
  pollSeconds: 2,
  /** Lines one poll may hand back (50 lines/s at the default interval). */
  maxLinesPerPoll: 100,
  /** Lines one session may export before it ends; the client starts a new one on purpose. */
  maxLinesPerSession: 20_000,
  /** A session ends after this long and the client mints a new ticket, which re-runs the permission check. */
  maxSessionSeconds: 15 * 60,
  /** Consecutive backend failures before the session gives up. */
  maxConsecutiveFailures: 5,
} as const;

export type TailLimits = { -readonly [K in keyof typeof TAIL_LIMITS]: number };

/** The ticket's payload: who and where, decided by the minting route AFTER the session guard. The gateway trusts nothing else. */
export const TailTicketPayloadSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().min(1).max(64),
  userSessionId: z.string().optional(),
  sessionExpiresAt: z.number().optional(),
  origin: z.string().min(1).max(256).optional(),
  iat: z.number(),
}).strict();
export type TailTicketPayload = z.infer<typeof TailTicketPayloadSchema>;

/** The room a tenant's tails are in, built here and never from client input (`t:<tenant>:telemetry-tail`). */
export const tailRoom = (tenantId: string): string => `t:${tenantId}:telemetry-tail`;

export const TailBridgeEventSchema = z.object({
  kind: z.literal('tail:end'),
  tenantId: z.string().uuid(),
  reason: z.enum(['erased']),
}).strict();
export type TailBridgeEvent = z.infer<typeof TailBridgeEventSchema>;

/** Tell every gateway node to end this tenant's tails. Best effort: with no gateway there is no tail to end. */
export async function publishTailEnd(tenantId: string, reason: TailBridgeEvent['reason']): Promise<void> {
  try {
    const { publishToChannel } = await import('@kuraykaraaslan-labs/websocket/server/websocket.pubsub');
    await publishToChannel(TAIL_CHANNEL, { kind: 'tail:end', tenantId, reason } satisfies TailBridgeEvent);
  } catch {
    // no gateway, no tails
  }
}
