import { emitHoneytokenTouch, type ActorRef } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { Lane } from '@kuraykaraaslan-labs/common/server/lane.policy';
import { rateLimitBucketOf } from './limiter.ip-bucket';

/**
 * The trap routes (docs/phases/55-ai-firewall/02 §2.5, the decoy `limiter.trap_routes` of limiter.firewall-honeytokens.ts).
 *
 * A few plausible API paths an intruder or a scanner looking for an old admin or backup endpoint tries, and that no page, link, sitemap,
 * route listing or API document of the product contains. They are NOT routes: no module declares them, so the tenant API dispatcher
 * answers them with its own missing-route 404, byte for byte the answer of any other unknown path, and no listing can ever show them.
 * The limiter's answer watcher (`Limiter.noteAnswer`, which sees every answer of the dispatcher) recognises the path on that 404 and
 * reports one critical signal (`limiter.trap_route_touched`); a test keeps every trap path clear of every declared route.
 *
 * Rate-limited twice: the 404 is a miss of the address like any other (the misbehaviour count divides the address's ceiling, D40-10(d)),
 * and the signals are bounded per trap, tenant and actor and per process (`emitHoneytokenTouch`), so a scanner hammering a trap cannot
 * flood the signal stream. The check is one Set lookup on a 404 and nothing on any other answer (FWA-7).
 */

export const TRAP_SIGNAL = 'limiter.trap_route_touched';

/** The trap paths (tenant-relative, lower case) and the stable code each signal carries. */
export const TRAP_ROUTES: Readonly<Record<string, string>> = {
  '/api/admin/backup': 'admin_backup',
  '/api/admin/backup/download': 'admin_backup_download',
  '/api/admin/db-dump': 'admin_db_dump',
  '/api/admin/users/export': 'admin_users_export',
  '/api/internal/debug': 'internal_debug',
  '/api/internal/env': 'internal_env',
  '/api/backup': 'backup',
  '/api/legacy/admin': 'legacy_admin',
};

const TRAPS = new Map(Object.entries(TRAP_ROUTES));
/** Longest path worth normalising (every trap is far shorter). */
const PATH_MAX = 64;

/** The trap code of a dispatcher API path (`/api/...`), or null. Case, repeated and trailing slashes do not hide a trap. */
export function trapOf(apiPath: string): string | null {
  if (typeof apiPath !== 'string' || apiPath.length > PATH_MAX) return null;
  const exact = TRAPS.get(apiPath);
  if (exact) return exact;
  const normal = apiPath.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return TRAPS.get(normal) ?? null;
}

export interface TrapTouch {
  trap: string;
  /** The tenant the request was addressed to (null: none; the ROOT tenant's is the platform's). */
  tenantId: string | null;
  /** The signed-in person, when the request carries a valid session (by signature only). */
  userId: string | null;
  /** The client address, or null when unknown. */
  ip: string | null;
  lane: Lane | 'unknown';
  method: string | null;
}

/** One trap hit: a critical signal about the person when signed in, else the address, else `anon`. Never throws. */
export function noteTrapTouch(t: TrapTouch): boolean {
  const actor: ActorRef = t.userId
    ? { kind: 'user', id: t.userId }
    // an address is its rate-limit bucket (an IPv6 /64), as every producer keys one (D55-67)
    : t.ip ? { kind: 'ip', id: rateLimitBucketOf(t.ip) } : { kind: 'anon', id: 'anonymous' };
  return emitHoneytokenTouch({
    kind: TRAP_SIGNAL,
    source: 'limiter',
    tenantId: t.tenantId,
    actor,
    lane: t.lane,
    attrs: {
      trap: t.trap,
      method: t.method ? t.method.toUpperCase().slice(0, 8) : null,
      // the address of a signed-in caller travels as an attribute (network data), the actor being the person
      ip: t.userId && t.ip ? t.ip : null,
    },
  });
}
