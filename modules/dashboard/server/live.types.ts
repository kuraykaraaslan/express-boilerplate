import { z } from 'zod'

/**
 * The live-data wire contract (docs/phases/07-dashboard/11). Pure types and zod — no
 * socket.io, no Redis — so Next routes, workers, the gateway descriptor and the
 * browser can all import it.
 */

/** Redis channel the producers publish to and the `/dashboard` namespace subscribes to. */
export const LIVE_CHANNEL = 'dashboard:live'
/** Socket.IO namespace the browser connects to. */
export const LIVE_NAMESPACE_PATH = '/dashboard'
/** Ticket key prefix (`createWsTicketService`). */
export const LIVE_TICKET_PREFIX = 'dash:ws-ticket'
/** Topics one ticket may carry / one socket may join. */
export const MAX_TICKET_TOPICS = 200
/** Bindings one ticket request may cover. */
export const MAX_TICKET_BINDINGS = 50
/**
 * Board contexts one ticket request may carry (page frames, docs/phases/07-dashboard/29 "How it fits the data path"):
 * the base page plus three open layers, each with its own parameter values. Still ONE board and ONE socket.
 */
export const MAX_TICKET_CONTEXTS = 4
/** After this long a socket is told to re-authorise (`server:reauth`) and closed, unless a fresh ticket replaced its own first. */
export const DEFAULT_MAX_SESSION_SECONDS = 900

/**
 * How long a socket on a ticket minted at `now` runs before the gateway re-authorises it, in whole seconds (the live
 * ticket's `sessionExpiresIn`, docs/phases/07-dashboard/40 D40-5): the namespace's bound, or less when the session the
 * ticket was minted under ends sooner (the gateway closes the socket then too). Relative, so the client's clock does
 * not matter. A ticket with no session expiry gets the bound.
 */
export function liveSessionSeconds(sessionExpiresAt: number | undefined, now: number): number {
  const sessionLeft = typeof sessionExpiresAt === 'number' && Number.isFinite(sessionExpiresAt)
    ? Math.floor((sessionExpiresAt - now) / 1000)
    : DEFAULT_MAX_SESSION_SECONDS
  return Math.max(0, Math.min(DEFAULT_MAX_SESSION_SECONDS, sessionLeft))
}

/**
 * A delta carries the same pieces as a `DataSourceResult`, so merging is driven
 * by the SHAPE of the query rather than by what it is about.
 */
export const LiveDeltaSchema = z.object({
  at: z.string().max(40),
  value: z.union([z.number(), z.string(), z.null()]).optional(),
  series: z.array(z.object({
    name: z.string().max(200),
    points: z.array(z.object({ t: z.string().max(40), v: z.number() })).max(1000),
  })).max(50).optional(),
  rows: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
  record: z.record(z.string(), z.unknown()).optional(),
}).strict()
export type LiveDelta = z.infer<typeof LiveDeltaSchema>

/** What the producer puts on the Redis channel. */
export const LiveEnvelopeSchema = z.object({
  tenantId: z.string().uuid(),
  topic: z.string().min(1).max(300),
  delta: LiveDeltaSchema,
}).strict()
export type LiveEnvelope = z.infer<typeof LiveEnvelopeSchema>

/** What the browser receives on the `delta` event. */
export interface LiveWireDelta { topic: string; delta: LiveDelta }

/** Ticket payload: the server-authorised topic list, bound to the minting user. */
export interface LiveTicketPayload {
  tenantId: string
  userId: string
  topics: string[]
  /** Session the ticket was minted under; lets a revoked session drop only its own sockets (websocket phase 04 §4.2). */
  userSessionId?: string
  /** Epoch ms the session expires; the gateway closes the socket then (websocket phase 04 §4.5). */
  sessionExpiresAt?: number
  /** The Origin of the request that minted the ticket the handshake accepts an upgrade from it (risk register websocket.04). */
  origin?: string
  iat: number
}

/**
 * The shape a consumed ticket must have before the gateway treats it as an identity. The minter
 * writes exactly this; a value of any other shape (Redis tampering, a writer sharing the prefix)
 * is refused instead of reaching `onConnection` (dashboard.18).
 */
export const LiveTicketPayloadSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().min(1).max(200),
  topics: z.array(z.string().min(1).max(300)).max(MAX_TICKET_TOPICS),
  userSessionId: z.string().min(1).max(200).optional(),
  sessionExpiresAt: z.number().finite().optional(),
  origin: z.string().min(1).max(256).optional(),
  iat: z.number().finite(),
})

/** The Socket.IO room a topic maps to — tenant-prefixed, so topics never cross tenants. */
export const liveRoom = (tenantId: string, topic: string): string => `t:${tenantId}:dash:${topic}`
