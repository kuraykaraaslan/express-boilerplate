import { z } from 'zod'

/**
 * Shared realtime contract for the public status page (phase 3). Kept
 * dependency-light and socket.io-FREE, mirroring
 * `dynamic_page/server/collab.realtime.ts`; the websocket module is
 * deliberately not imported at all here — the ONE publish call site loads the
 * pubsub subpath dynamically, because the gateway is an optional enhancement
 * (locked decision: the page works on polling without it).
 *
 * The event carries NO status payload on purpose: it is a "something changed,
 * refetch" signal. Serializing state into events would create a second
 * serializer next to the public DTO allowlist — and a second serializer is a
 * second place to leak a monitor target.
 */

/** Redis pub/sub channel the gateway subscribes to for status events. */
export const STATUS_CHANNEL = 'status:rt'

/** Public status room per tenant — the `tenantEntityRoom(tenantId, 'status',
 *  'public')` convention (`t:<tid>:status:public`), written out so this file
 *  needs no websocket import. Tenant prefix = cross-tenant isolation. */
export const statusRoom = (tenantId: string): string => `t:${tenantId}:status:public`

export const STATUS_EVENTS = {
  CHANGED: 'status:changed',
} as const

export const StatusChangedSchema = z.object({
  kind: z.literal('status:changed'),
  tenantId: z.string(),
  at: z.number(),
})
export const StatusEventSchema = z.discriminatedUnion('kind', [StatusChangedSchema])
export type StatusEvent = z.infer<typeof StatusEventSchema>

type StatusChangeListener = (tenantId: string) => void
const listeners = new Set<StatusChangeListener>()

/**
 * In-process subscribers to "the public status of this tenant changed", for work that must follow every change but is not the gateway's
 * (the static snapshot of phase 15.9). A listener never delays or fails the announcement: it is called after it, errors swallowed.
 */
export function onStatusChanged(listener: StatusChangeListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Announce "the public status of this tenant changed" for the gateway to fan
 * into the tenant's status room. Best-effort and gateway-optional: the pubsub
 * subpath is imported lazily, and its absence (websocket module not installed)
 * degrades silently — pages fall back to their polling interval.
 */
export async function publishStatusChanged(tenantId: string): Promise<void> {
  try {
    const { publishToChannel } = await import('@kuraykaraaslan-labs/websocket/server/websocket.pubsub')
    await publishToChannel(STATUS_CHANNEL, {
      kind: 'status:changed', tenantId, at: Date.now(),
    } satisfies StatusEvent)
  } catch {
    // No gateway — polling covers it.
  }
  for (const listener of listeners) {
    try { listener(tenantId) } catch { /* a listener must not change what the announcement did */ }
  }
}
