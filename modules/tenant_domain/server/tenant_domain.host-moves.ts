import Logger from '@kuraykaraaslan-labs/logger';
import { TenantDomainHostMove } from './entities/tenant_domain_host_move.entity';

/**
 * Hosts a tenant left (phase 56, D347). `recordHostMove` is called when a free subdomain is renamed (a base-domain change, a slug rename);
 * `hostMoveFor` is what the proxy asks for a host no tenant serves. A move points at the tenant's CURRENT host: a second move rewrites the
 * earlier rows of the tenant, and a move back to an old name deletes that row (the host serves again). The database package is loaded
 * lazily: the proxy imports this file through the tenant_domain facade.
 */
export const HOST_MOVE_DAYS = 30;
export type HostMoveReason = 'base_change' | 'slug_change';

const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 30_000;
const MAX_CACHED = 2_000;
const cache = new Map<string, { at: number; toHost: string | null; expiresAt: number }>();

export function invalidateHostMoveCache(): void { cache.clear(); }

const norm = (h: string) => h.trim().toLowerCase().replace(/\.$/, '');

async function sys<T>(fn: (repo: import('typeorm').Repository<TenantDomainHostMove>) => Promise<T>): Promise<T> {
  const { withSystemRLS } = await import('@kuraykaraaslan-labs/db');
  return withSystemRLS((qr) => fn(qr.manager.getRepository(TenantDomainHostMove)));
}

export async function recordHostMove(input: { fromHost: string; toHost: string; tenantId: string; reason: HostMoveReason; now?: Date }): Promise<void> {
  const fromHost = norm(input.fromHost);
  const toHost = norm(input.toHost);
  if (!fromHost || !toHost || fromHost === toHost) return;
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + HOST_MOVE_DAYS * 86_400_000);
  await sys(async (repo) => {
    // The new host serves again if it was an old one; earlier moves of the tenant follow it to the new host.
    await repo.delete({ fromHost: toHost });
    await repo.update({ tenantId: input.tenantId }, { toHost });
    await repo.upsert({ fromHost, tenantId: input.tenantId, toHost, reason: input.reason, expiresAt }, ['fromHost']);
  });
  invalidateHostMoveCache();
  Logger.info(`[tenant_domain] ${JSON.stringify(fromHost)} of ${input.tenantId} now redirects to ${JSON.stringify(toHost)} until ${expiresAt.toISOString().slice(0, 10)}`);
}

/** The host `host` moved to, while the redirect lasts; null otherwise or when the lookup fails (an unknown host, then). */
export async function hostMoveFor(host: string): Promise<string | null> {
  const h = norm(host);
  if (!h) return null;
  const now = Date.now();
  const hit = cache.get(h);
  if (hit && now - hit.at < (hit.toHost ? HIT_TTL_MS : MISS_TTL_MS)) return hit.toHost && hit.expiresAt > now ? hit.toHost : null;
  let toHost: string | null = null;
  let expiresAt = 0;
  try {
    const row = await sys((repo) => repo.findOne({ where: { fromHost: h } }));
    if (row && new Date(row.expiresAt).getTime() > now) { toHost = row.toHost; expiresAt = new Date(row.expiresAt).getTime(); }
  } catch (err) {
    Logger.warn(`[tenant_domain] host move lookup failed for ${JSON.stringify(h)}: ${err instanceof Error ? err.message : 'unknown'}`);
  }
  if (cache.size >= MAX_CACHED) for (const k of Array.from(cache.keys()).slice(0, MAX_CACHED / 10)) cache.delete(k);
  cache.set(h, { at: now, toHost, expiresAt });
  return toHost;
}

/** Deletes the redirects that ended (the DNS recheck job, every 6 hours). */
export async function expireHostMoves(now: Date = new Date()): Promise<number> {
  const { LessThan } = await import('typeorm');
  const res = await sys((repo) => repo.delete({ expiresAt: LessThan(now) }));
  if (res.affected) invalidateHostMoveCache();
  return res.affected ?? 0;
}
