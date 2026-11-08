import crypto from 'crypto';
import { z } from 'zod';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import TenantService from '@kuraykaraaslan-labs/tenant/server/tenant.service';
import TenantMemberService from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.service';
import { SlugSchema } from '@kuraykaraaslan-labs/tenant/server/tenant.dto';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { DetectedCountry } from '@kuraykaraaslan-labs/tenant/server/tenant.country';
import { registrationOpen, selfServiceTenantLimit } from './auth.registration';
import { resolveSignupZone } from './auth.signup-zone';

/**
 * Self-service onboarding (platform sign-up, auth.registration.ts): a signed-in person opens their own organization.
 *
 * Allowed while the platform sign-up is open (root `allowSelfRegistration` + access policy) and the person owns fewer
 * tenants than `selfServiceTenantLimit` (root setting, default 3). The new tenant goes through the same
 * `TenantService.create` as the platform admin's (slug rules, reserved labels, tombstones, default plan, modules, the
 * free `<slug>.<wildcard>` subdomain, webhook, audit), with the person as its OWNER. A per-person lock keeps two
 * concurrent requests from both passing the limit; an OWNER membership that cannot be written removes the tenant again,
 * so no ownerless tenant is left behind (risk register tenant.05).
 */
export const CreateOwnTenantDTO = z.strictObject({
  name: z.string().trim().min(2).max(100),
  // The address as typed, normalised the way the availability check normalises it (trimmed, lowercase).
  slug: z.string().trim().toLowerCase().pipe(SlugSchema.unwrap()),
  // Phase 56 (D346): the platform base domain the person picked for the address, when the root tenant lets tenants choose. Only a hint:
  // tenant_domain mints under it only if it is on offer, else under the default.
  baseDomain: z.string().trim().toLowerCase().max(253).regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/).optional(),
  // Fleet phase 6c (F41): the zone the fleet instance's chooser sent the person here for (`?zone=`). On a fleet node the zone must belong to
  // this node (auth:signup_zone, fleet_agent answers); anywhere else it is ignored.
  zone: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{0,31}$/).optional(),
});
export type CreateOwnTenantInput = z.infer<typeof CreateOwnTenantDTO>;
/**
 * The onboarding POST's body: the new organization, plus `enter: 'fleet-id'` when the client will enter it through a Fleet ID login of its
 * own (FID-09; the route then mints no handoff and no session). Only a way-in hint for the route; never passed to createOwnTenant.
 */
export const OnboardingCreateDTO = CreateOwnTenantDTO.extend({ enter: z.literal('fleet-id').optional() });

export type OnboardingStatus = {
  /** May this person open an organization now? */
  canCreate: boolean;
  /** Why not: the platform sign-up is closed, or the person reached the limit. */
  reason?: 'closed' | 'limit';
  owned: number;
  limit: number;
};

const LOCK_TTL_SECONDS = 120;
const lockKey = (userId: string) => `onboarding:create:${userId}`;

async function ownedTenants(userId: string): Promise<number> {
  const memberships = await TenantMemberService.getUserTenants(userId);
  // ACTIVE memberships (getUserTenants reads only those) of tenants that still exist; a suspended tenant still counts.
  return memberships.filter((m) => m.memberRole === 'OWNER' && m.tenantId !== ROOT_TENANT_ID && !!m.tenant).length;
}

export async function onboardingStatus(userId: string): Promise<OnboardingStatus> {
  const [open, limit, owned] = await Promise.all([registrationOpen(ROOT_TENANT_ID), selfServiceTenantLimit(), ownedTenants(userId)]);
  if (!open) return { canCreate: false, reason: 'closed', owned, limit };
  if (owned >= limit) return { canCreate: false, reason: 'limit', owned, limit };
  return { canCreate: true, owned, limit };
}

/** Open an organization for `userId` as its OWNER. Throws an AppError (403 closed/limit, 409 busy/slug taken, 422 slug reserved). */
export async function createOwnTenant(userId: string, input: CreateOwnTenantInput, detected?: DetectedCountry) {
  const data = CreateOwnTenantDTO.parse(input);
  // The lock holds this request's own token, so a request that outlived the TTL never releases a newer one's lock.
  const token = crypto.randomBytes(16).toString('hex');
  const locked = await redis.set(lockKey(userId), token, 'EX', LOCK_TTL_SECONDS, 'NX');
  if (locked !== 'OK') throw new AppError('An organization is already being created for you. Try again in a moment.', 409, ErrorCode.CONFLICT);
  try {
    const status = await onboardingStatus(userId);
    if (!status.canCreate) {
      throw new AppError(
        status.reason === 'closed' ? 'Opening an organization is not available right now.' : 'You have reached the number of organizations you can open yourself.',
        403,
        ErrorCode.FORBIDDEN,
      );
    }
    // Phase 6c (F41): a sign-up for a zone of another node is refused before anything is written, with the way back to the chooser.
    const zone = data.zone ? await resolveSignupZone(data.zone) : null;
    if (zone && !zone.ok) {
      throw new AppError('This location does not open workspaces here. Choose your location again.', 409, ErrorCode.CONFLICT, {
        details: { reason: 'ZONE_NOT_HERE', zoneReason: zone.reason, chooserUrl: zone.chooserUrl },
      });
    }
    const seedHints = {
      ...(data.baseDomain ? { baseDomain: data.baseDomain } : {}),
      ...(zone?.ok ? { language: zone.defaultLocale } : {}),
    };
    // Phase 49.1: the country is detected silently from the request (geo-IP, else the browser language, else TR) by the route and stored with its
    // source; the bloc `region` follows it. The person is never asked, and cannot change it afterwards (only the operator does).
    const tenant = await TenantService.create({
      name: data.name, description: null, region: 'TR', slug: data.slug,
      ...(detected ? { countryCode: detected.countryCode, countrySource: detected.source } : {}),
    }, userId, Object.keys(seedHints).length ? { seedHints } : undefined);
    try {
      await TenantMemberService.create({ tenantId: tenant.tenantId, userId, memberRole: 'OWNER', memberStatus: 'ACTIVE' });
    } catch (e) {
      // No ownerless tenant: take it back, and report the original failure.
      await TenantService.delete(tenant.tenantId, userId).catch((err: unknown) =>
        Logger.error(`[onboarding] could not remove ownerless tenant ${tenant.tenantId}: ${err instanceof Error ? err.message : String(err)}`));
      throw e;
    }
    return tenant;
  } finally {
    try {
      if ((await redis.get(lockKey(userId))) === token) await redis.del(lockKey(userId));
    } catch { /* the TTL releases it */ }
  }
}
