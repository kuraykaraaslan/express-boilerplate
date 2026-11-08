/**
 * What this gateway node was told was revoked in the last `ttlMs`, so a ticket minted before a revocation and presented
 * after it is not admitted (risk register websocket.17). A `disconnect_user` / `disconnect_tenant` event drops the
 * sockets open at that moment; without a memory, a ticket minted a second earlier (it lives 30 s) opened a socket for a
 * session that no longer existed. Every node hears every control event, so each keeps its own memory. Dependency-free,
 * like the auth middleware that asks it.
 *
 * - a revoked SESSION refuses every identity of that session (no ticket can be minted for it any more);
 * - a revoked USER (in a tenant, or everywhere) and a revoked TENANT refuse identities whose ticket was minted (`iat`)
 *   at or before the revocation, or that carry no `iat`; a ticket minted afterwards (re-added, re-activated) passes.
 */
export const REVOCATION_MEMORY_MS = 60_000;

export interface RevocationMemory {
  session(userSessionId: string): void;
  user(userId: string, tenantId?: string): void;
  tenant(tenantId: string): void;
  /** True when `identity` belongs to something revoked within the memory. */
  refuses(identity: unknown): boolean;
}

export function createRevocationMemory(ttlMs: number = REVOCATION_MEMORY_MS, now: () => number = Date.now): RevocationMemory {
  const entries = new Map<string, number>(); // key -> revoked at (ms)
  const sweep = () => {
    const cutoff = now() - ttlMs;
    for (const [key, at] of entries) if (at < cutoff) entries.delete(key);
  };
  const mark = (key: string) => { sweep(); entries.set(key, now()); };
  const revokedAt = (key: string): number | undefined => {
    const at = entries.get(key);
    return at !== undefined && at >= now() - ttlMs ? at : undefined;
  };
  return {
    session: (id) => mark(`s|${id}`),
    user: (userId, tenantId) => mark(`u|${tenantId ?? '*'}|${userId}`),
    tenant: (tenantId) => mark(`t|${tenantId}`),
    refuses(identity) {
      if (entries.size === 0 || !identity || typeof identity !== 'object') return false;
      const id = identity as { userId?: unknown; tenantId?: unknown; userSessionId?: unknown; iat?: unknown };
      if (typeof id.userSessionId === 'string' && revokedAt(`s|${id.userSessionId}`) !== undefined) return true;
      const iat = typeof id.iat === 'number' && Number.isFinite(id.iat) ? id.iat : null;
      const mintedBefore = (at: number | undefined) => at !== undefined && (iat === null || iat <= at);
      if (typeof id.tenantId === 'string' && mintedBefore(revokedAt(`t|${id.tenantId}`))) return true;
      if (typeof id.userId === 'string') {
        if (mintedBefore(revokedAt(`u|*|${id.userId}`))) return true;
        if (typeof id.tenantId === 'string' && mintedBefore(revokedAt(`u|${id.tenantId}|${id.userId}`))) return true;
      }
      return false;
    },
  };
}
