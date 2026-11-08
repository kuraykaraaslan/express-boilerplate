import { publishToChannel } from '@kuraykaraaslan-labs/websocket/server/websocket.pubsub'
import { LIVE_CHANNEL, type LiveDelta, type LiveEnvelope } from './live.types'

/**
 * Producer API for live queries (docs/phases/07-dashboard/11 §11.1): a socket.io-free
 * leaf, safe in a Next route and in a worker. Best-effort — the write that
 * triggered the delta is already durable, and a board that misses one re-queries
 * on reconnect (deltas are not replayed).
 *
 * Imports ONLY `websocket.pubsub` (see its header for why not the barrel).
 */
export async function publishLiveDelta(tenantId: string, topic: string, delta: LiveDelta): Promise<void> {
  const envelope: LiveEnvelope = { tenantId, topic, delta }
  await publishToChannel(LIVE_CHANNEL, envelope)
}
