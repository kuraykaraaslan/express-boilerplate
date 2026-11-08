/**
 * Promotion of repeat offenders (docs/phases/38-security 02 §2.2 open item, phase 55 00 §0.2; reworked by the phase 55 00 review).
 *
 * The rule: an address whose AUTOMATIC ban is its `BAN_PROMOTION_OFFENSES`th offense (five) within the strike store's offense memory (30 days,
 * limiter.ip-strikes.ts OFFENSE_MEMORY_SECONDS) gets the longest automatic ban at once (`PROMOTED_BAN_SECONDS`, the strike store's cap), instead
 * of climbing to it one doubling at a time. Only automatic bans count (a manual ban never escalates the offense counter), and strikes come only
 * from human sign-in lanes, so a machine lane never gets an address promoted (L-4).
 *
 * It used to append the address to the platform-global blocklist: no end, no Lift on the ban list, and the blocklist refuses every page and API,
 * the operator's own signed-in session included, so a promotion of a shared office or carrier address (strikes are cross-account) could not be
 * undone from the product. FWA-4 wants an end and an undo for every automatic action: a promoted ban is an ordinary automatic ban, persisted
 * (security_ip_bans, it is longer than an hour), listed with the others and lifted with Lift; the global blocklist stays the operator's own list.
 *
 * Never promoted: an address a ROOT member signed in from within `PROMOTION_OPERATOR_GRACE_DAYS` (a ROOT-tenant session that is not a central-login
 * account-only one, matched on the ban bucket: the address, or its IPv6 /64). Such an address keeps the normal escalation, so the platform's own
 * operators are not shut out for the longest ban by someone failing sign-ins behind the same NAT. Best-effort: a database that cannot be read
 * means "not an operator's address" and the address is promoted.
 *
 * The promotion is audited (`security.ip_ban_promoted`, high) next to the ban's own `security.ip_banned` row.
 */
import Logger from '@kuraykaraaslan-labs/logger';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { rateLimitBucketOf } from './limiter.ip-bucket';
import { banKindOf } from './limiter.ban-target';

/** The automatic offense (1-based, within the offense memory) from which an address's ban is the longest one. */
export const BAN_PROMOTION_OFFENSES = 5;
/** The promoted ban: seven days, the strike store's own cap (limiter.ip-strikes.ts BAN_MAX_SECONDS), so it has an end like every ban. */
export const PROMOTED_BAN_SECONDS = 7 * 24 * 60 * 60;
/** How far back a ROOT member's sign-in from an address keeps that address from being promoted. */
export const PROMOTION_OPERATOR_GRACE_DAYS = 30;
/** The ROOT sessions read for the guard at most (the platform's own operators; a handful in practice). */
const OPERATOR_SESSIONS_MAX = 2_000;

/** Whether a ROOT member (not a central-login account-only session) signed in from this ban bucket within the grace period. */
export async function isOperatorAddress(bucket: string, now: number = Date.now()): Promise<boolean> {
  if (banKindOf(bucket) !== 'address' && !bucket.endsWith('::/64')) return false;
  try {
    // Loaded here, not at the top: every limiter caller imports the strike store, and this runs only on an automatic ban of the promotion
    // offense (the strike store loads its durable store the same way).
    const [{ MoreThan }, { getDataSource }, { runWithTenant }, { UserSession }] = await Promise.all([
      import('typeorm'),
      import('@kuraykaraaslan-labs/db'),
      import('@kuraykaraaslan-labs/db/server/db.context'),
      import('@kuraykaraaslan-labs/user_session/server/entities/user_session.entity'),
    ]);
    const since = new Date(now - PROMOTION_OPERATOR_GRACE_DAYS * 24 * 60 * 60 * 1000);
    const rows = await runWithTenant(ROOT_TENANT_ID, async () => (await getDataSource()).getRepository(UserSession).find({
      select: { ipAddress: true, metadata: true },
      where: { tenantId: ROOT_TENANT_ID, createdAt: MoreThan(since) },
      order: { createdAt: 'DESC' },
      take: OPERATOR_SESSIONS_MAX,
    }));
    return rows.some((s) => !!s.ipAddress && rateLimitBucketOf(s.ipAddress) === bucket
      && (s.metadata as { accountOnly?: unknown } | null | undefined)?.accountOnly !== true);
  } catch (err) {
    Logger.warn(`[ip-strikes] operator address check failed for ${bucket}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * The length of an automatic ban of `offense` (1-based): `PROMOTED_BAN_SECONDS` from the promotion offense on, unless the address is an operator's;
 * else null (the normal escalation applies). Never throws.
 */
export async function promotedBanSeconds(bucket: string, offense: number): Promise<number | null> {
  if (!Number.isFinite(offense) || offense < BAN_PROMOTION_OFFENSES) return null;
  if (await isOperatorAddress(bucket)) {
    Logger.info(`[ip-strikes] ${bucket} not promoted: a ROOT member signed in from it within ${PROMOTION_OPERATOR_GRACE_DAYS} days`);
    return null;
  }
  return PROMOTED_BAN_SECONDS;
}

/** The audit row of a promotion (after the ban itself is in force). Never throws. */
export function auditPromotion(bucket: string, offense: number, seconds: number): void {
  AuditLogService.log({
    tenantId: null,
    actorId: null,
    actorType: 'SYSTEM',
    action: AuditActions.SECURITY_IP_BAN_PROMOTED,
    resourceType: 'ip',
    resourceId: bucket,
    metadata: { ip: bucket, offense, threshold: BAN_PROMOTION_OFFENSES, seconds, source: 'auto' },
  } as never).catch(() => {});
}
