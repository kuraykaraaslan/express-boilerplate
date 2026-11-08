import type { Redis } from 'ioredis';
import redis from '@kuraykaraaslan-labs/redis/server/redis.service';

/**
 * Tenant fence: no handshake of a suspended tenant is admitted, whatever ticket it presents.
 *
 * A suspension drops the tenant's live sockets (`disconnect_tenant` on the control channel), but a handshake ticket minted a
 * moment before it is still in Redis for up to its TTL (30 s by default) and would open a fresh socket afterwards. Tickets
 * are flat, single-use keys under each domain's own prefix, so they cannot be found by tenant; instead the HTTP process sets
 * this fence when the tenant is suspended and every gateway node refuses a handshake whose identity names a fenced tenant.
 *
 * The fence outlives every ticket that could have been minted before the suspension ({@link TENANT_FENCE_TTL_SECONDS}); after
 * that no new ticket is minted at all, because the ticket routes refuse a suspended tenant (tenant_session). Resuming lifts it.
 *
 * Like `websocket.pubsub` it imports only the socket.io-free `redis.service`, so the Next process can reach it.
 */
export const TENANT_FENCE_PREFIX = 'ws:tenant-fence';

/** Four times the default ticket TTL: a ticket minted just before the suspension has expired long before the fence does. */
export const TENANT_FENCE_TTL_SECONDS = 120;

export const tenantFenceKey = (tenantId: string): string => `${TENANT_FENCE_PREFIX}:${tenantId}`;

/** The Redis commands a fence needs; the gateway passes its own connection, the HTTP process the shared client. */
export type FenceRedis = Pick<Redis, 'set' | 'get' | 'del'>;

/** Fence the tenant (on suspension). Throws when Redis cannot take it: the caller logs it, the sockets are still dropped. */
export async function fenceTenant(tenantId: string, client: FenceRedis = redis): Promise<void> {
  await client.set(tenantFenceKey(tenantId), '1', 'EX', TENANT_FENCE_TTL_SECONDS);
}

/** Lift the fence (on resume), so a resumed tenant's members connect again at once instead of after the TTL. */
export async function unfenceTenant(tenantId: string, client: FenceRedis = redis): Promise<void> {
  await client.del(tenantFenceKey(tenantId));
}

/** True when the tenant is fenced. Throws when Redis cannot answer: the gateway then refuses (the ticket needed Redis too). */
export async function isTenantFenced(tenantId: string, client: FenceRedis = redis): Promise<boolean> {
  return (await client.get(tenantFenceKey(tenantId))) !== null;
}
