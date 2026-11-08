import 'reflect-metadata';
import type { TenantSeedHints } from './tenant.extension-points';
import { IsNull, type DeepPartial, type Repository } from 'typeorm';
import { withSystemRLS, withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { assertDeletionAllowed } from './tenant.deletion-guard';
import { assertNoFleetDeletionBlock } from './tenant.deletion-rules';
import { FLEET_TENANT_NAME, isFleetTenant, isRefusedTenantId, isReservedSubdomainLabel, isReservedTenant, tenantLabelProblem, TENANT_LABEL_MIN } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { Tenant as TenantEntity } from './entities/tenant.entity';
import { TenantSlugTombstone } from './entities/tenant_slug_tombstone.entity';
import { SafeTenant, SafeTenantSchema } from './tenant.types';
import { CreateTenantInput, UpdateTenantInput } from './tenant.dto';
import TenantMessages from './tenant.messages';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import TenantMemberService from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.service';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { clearCache, seedDefaults } from './tenant.helpers';
import { deliverTenantCacheDrop, recordTenantCacheDrop } from './tenant.cache-drop';
import { announceSlugChange, announceSuspension, recordLifecycle } from './tenant.extension-points';
import { sessionEndOrderedBy as orderedBy } from './tenant.session-end';
import { enforceTenantCeiling, tenantCeiling } from './tenant.ceiling';
import { normalizeCountryCode, regionForCountry, type CountrySource } from './tenant.country';
import Logger from '@kuraykaraaslan-labs/logger';
import { recordSessionEndInTx, type SessionEndInTx } from '@kuraykaraaslan-labs/session_end/server/session_end.in-tx';

/**
 * Lifecycle audit trail for tenant administration (best-effort). Mirrors
 * `auditWebhook` in `webhook.crud.service`: a single `AuditLogService.log`
 * whose promise is always swallowed so an audit outage can never block — or
 * roll back — the tenant mutation that triggered it. `actorId` is the acting
 * user when a route provides one (create/update/delete), otherwise SYSTEM.
 */
/** Postgres unique_violation, however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

const SLUG_TAKEN = 'Tenant slug already taken';
const SLUG_RESERVED = 'Tenant slug is reserved';
const SLUG_INVALID = 'Tenant slug must be 5 to 63 lowercase letters, digits and hyphens, without a dot';
const TENANT_ID_TAKEN = 'Tenant id already in use';
const TENANT_ID_RESERVED = 'Tenant id is reserved for platform tenants';
const COUNTRY_UNKNOWN = 'Unknown country code';
const REGION_FOLLOWS_COUNTRY = 'This tenant has a country and its price region follows it: change the country instead of the region';
const FLEET_IDENTITY_FIXED = 'The fleet tenant keeps its name and has no slug';
const TENANT_PENDING_DELETION = 'Tenant is scheduled for deletion: cancel the deletion first';
const TENANT_DELETED = 'Tenant is deleted: its status cannot be changed';

/**
 * Is `slug` used by any tenant other than `exceptTenantId`, or tombstoned because it belonged to a purged tenant (docs/phases/02-fleet/05 section
 * 5.2: a squatter never inherits a deleted tenant's links)? Slugs are global, so a cross-tenant read.
 */
async function slugTaken(slug: string, exceptTenantId?: string): Promise<boolean> {
  return withSystemRLS(async (qr) => {
    const existing = await qr.manager.getRepository(TenantEntity).findOne({ where: { slug } });
    if (existing && existing.tenantId !== exceptTenantId) return true;
    return qr.manager.getRepository(TenantSlugTombstone).exists({ where: { slug } });
  });
}

/** The slug the tenant holds now (null: none, or no such tenant). */
async function currentSlug(tenantId: string): Promise<string | null> {
  return withSystemRLS(async (qr) => (await qr.manager.getRepository(TenantEntity).findOne({ where: { tenantId }, select: { tenantId: true, slug: true } }))?.slug ?? null);
}

export type SlugAvailability = { available: true } | { available: false; reason: 'invalid' | 'reserved' | 'taken' };

/**
 * Whether a new tenant may take `slug` (the self-service onboarding asks while the person types): the slug format, the
 * platform's reserved labels, and every slug in use or tombstoned — the checks `create` makes, answered without creating.
 */
export async function slugAvailability(slug: string): Promise<SlugAvailability> {
  const problem = tenantLabelProblem(slug);
  if (problem === 'reserved') return { available: false, reason: 'reserved' };
  if (problem) return { available: false, reason: 'invalid' };
  if (await slugTaken(slug)) return { available: false, reason: 'taken' };
  return { available: true };
}

/**
 * The statuses only the fleet migration contract moves a tenant in and out of (docs/phases/02-fleet/05 section 6): a status change by hand would
 * unfreeze a source mid-transfer, expose a target before its verification or revive a tombstone, so `update` refuses it.
 */
const CONTRACT_STATUSES: ReadonlySet<string> = new Set(['MIGRATING', 'IMPORTING', 'RELOCATED']);

/** Where the fleet directory placed a tenant: set by `tenant.provision` on a node, never by a route. */
export interface TenantHome {
  regionId: string;
  nodeId: string;
  assignmentVersion: number;
  residencyRequirement?: string | null;
}

function auditTenant(
  tenantId: string,
  actorId: string | null | undefined,
  action: string,
  metadata?: Record<string, unknown>,
): void {
  AuditLogService.log({
    tenantId,
    actorId: actorId ?? null,
    actorType: actorId ? 'USER' : 'SYSTEM',
    action,
    resourceType: 'Tenant',
    resourceId: tenantId,
    metadata: metadata ?? {},
  }).catch(() => { /* audit failure must not block the mutation */ });
}

/**
 * `opts.tenantId`: a tenant id issued elsewhere (the fleet directory, docs/phases/02-fleet/05 section 1): internal callers only, never part of the DTO a route
 * parses. An id that exists already, even soft-deleted, is refused (409): an id is never reused; one of the platform range other than root and
 * fleet is refused too (422, phase 46). `opts.home`: where the directory placed it (stage 2),
 * written with the row so a provisioned tenant is never routable without its home.
 */
export async function create(data: CreateTenantInput, actorId?: string, opts: { tenantId?: string; home?: TenantHome; seedHints?: TenantSeedHints } = {}): Promise<SafeTenant> {
  const { defaults, ...rawTenantData } = data;
  // Phase 49.1: a country (the operator's pick, or the sign-up's detection) fixes the bloc `region` (none for a country no bloc lists, as in update(): the
  // caller's own region is a placeholder then, never kept) and says where it came from. A caller that gives none
  // (the fleet directory's provisioning, the platform tenants) leaves the tenant without one: it then prices from its `region`, as before.
  const country = rawTenantData.countryCode === undefined || rawTenantData.countryCode === null ? null : normalizeCountryCode(rawTenantData.countryCode);
  if (rawTenantData.countryCode && !country) throw new AppError(COUNTRY_UNKNOWN, 422, ErrorCode.VALIDATION_ERROR);
  const tenantData = country
    ? { ...rawTenantData, countryCode: country, countrySource: rawTenantData.countrySource ?? ('operator' as CountrySource), region: regionForCountry(country) }
    : rawTenantData;
  // Phase 46 (D46-5): 00000000-0000-4000-8000-0000000000xx is the platform tenants' range; only root and fleet are created in it.
  if (isRefusedTenantId(opts.tenantId)) throw new AppError(TENANT_ID_RESERVED, 422, ErrorCode.VALIDATION_ERROR);
  // A reserved label (admin, www, api, auth, app ...) would name a platform-looking free subdomain. The reserved platform
  // tenants (root, fleet: created here with their fixed id) are the operator and keep their names.
  if (tenantData.slug && !isReservedTenant(opts.tenantId) && isReservedSubdomainLabel(tenantData.slug)) {
    throw new AppError(SLUG_RESERVED, 422, ErrorCode.VALIDATION_ERROR);
  }
  // A new label is 5 to 63 characters, one DNS label (owner 2026-11-04). A tenant arriving with an id issued elsewhere (the fleet
  // directory moving an existing tenant) keeps the slug it already had.
  if (tenantData.slug && !opts.tenantId && tenantLabelProblem(tenantData.slug)) {
    throw new AppError(SLUG_INVALID, 422, ErrorCode.VALIDATION_ERROR);
  }
  // Validate slug uniqueness (the partial unique index settles a race: 409, not 500)
  if (tenantData.slug && await slugTaken(tenantData.slug)) throw new AppError(SLUG_TAKEN, 409, ErrorCode.CONFLICT);
  if (opts.tenantId && await withSystemRLS((qr) => qr.manager.getRepository(TenantEntity).exists({ where: { tenantId: opts.tenantId }, withDeleted: true }))) {
    throw new AppError(TENANT_ID_TAKEN, 409, ErrorCode.CONFLICT);
  }

  // The deployment's `tenants` cap (fleet 3b.11, S11): the reserved platform tenants are never counted nor capped. A tenant the fleet
  // directory provisions here counts like any other: a node enforces the cap in its own lease.
  const cap = isReservedTenant(opts.tenantId) ? undefined : await tenantCeiling();

  // A new tenant row: there is no tenant context yet to scope it to.
  let saved: TenantEntity;
  try {
    saved = await withSystemRLS(async (qr) => {
      await enforceTenantCeiling(qr, cap, { actorId, path: opts.home ? 'fleet_provision' : 'create' });
      const repo = qr.manager.getRepository(TenantEntity);
      const home = opts.home
        ? { homeRegionId: opts.home.regionId, homeNodeId: opts.home.nodeId, assignmentVersion: opts.home.assignmentVersion, residencyRequirement: opts.home.residencyRequirement ?? null }
        : {};
      return await repo.save(repo.create({ ...tenantData, ...home, ...(opts.tenantId ? { tenantId: opts.tenantId } : {}), tenantStatus: 'ACTIVE' } as DeepPartial<TenantEntity>)) as unknown as TenantEntity;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(SLUG_TAKEN, 409, ErrorCode.CONFLICT);
    throw err;
  }

  const parsed = SafeTenantSchema.parse(saved);

  // Seed defaults — wait for completion before firing the webhook so the
  // provisioning outcome (success/failure) is reflected in the event payload.
  const seedOutcome = await seedDefaults(parsed.tenantId, defaults, tenantData.region ?? undefined, opts.seedHints);

  await WebhookService.dispatchPlatformEvent('tenant.created', {
    tenantId: parsed.tenantId,
    name: parsed.name,
    region: parsed.region,
    slug: parsed.slug,
    provisioned: seedOutcome.ok,
    provisioningErrors: seedOutcome.errors,
  });

  auditTenant(parsed.tenantId, actorId, 'tenant.created', {
    name: parsed.name,
    slug: parsed.slug ?? null,
    region: parsed.region ?? null,
    provisioned: seedOutcome.ok,
  });
  await recordLifecycle({ tenantId: parsed.tenantId, type: 'PROVISIONED', occurredAt: saved.createdAt ?? new Date() });

  return parsed;
}

/**
 * Undo a tenant row that was just created but could not be given its OWNER (tenant.05, fixed 2026-10-20): the create route
 * provisions the row first and the membership afterwards, so a failed membership insert used to leave an ownerless tenant behind
 * (and a retry made a second one). The row is removed outright (it never had a member or any data of its own) and audited.
 */
export async function discardUnowned(tenantId: string, actorId?: string): Promise<void> {
  if (isReservedTenant(tenantId)) return;
  const drops = await withSystemRLS(async (qr) => {
    await qr.manager.getRepository(TenantEntity).delete({ tenantId });
    return recordTenantCacheDrop(qr, tenantId);
  });
  await clearCache(tenantId).catch(() => {});
  await deliverTenantCacheDrop(drops);
  auditTenant(tenantId, actorId, 'tenant.discarded', { reason: 'owner membership could not be created' });
}

export async function update(tenantId: string, input: UpdateTenantInput, actorId?: string): Promise<SafeTenant> {
  // Phase 49.1: a country change is the operator's (the route parses it from the platform-scoped body only). The bloc `region` follows the
  // country, the source becomes 'operator', and the change is audited and told to the owners below.
  let data: UpdateTenantInput & { countrySource?: CountrySource } = input;
  if (input.countryCode !== undefined) {
    const code = normalizeCountryCode(input.countryCode);
    if (!code) throw new AppError(COUNTRY_UNKNOWN, 422, ErrorCode.VALIDATION_ERROR);
    data = { ...input, countryCode: code, countrySource: 'operator', region: regionForCountry(code) };
  }
  // Reserved platform tenants (root, fleet) stay ACTIVE: suspending or queueing them for deletion through the
  // generic update path would sidestep the deletion guard (review 2026-10-11).
  if (isReservedTenant(tenantId) && data.tenantStatus !== undefined && data.tenantStatus !== 'ACTIVE') {
    throw new AppError('Reserved platform tenants (root, fleet) must stay ACTIVE', 409, ErrorCode.CONFLICT);
  }
  // Phase 46 (D46-5): db:deploy and tenant:rekey tell the fleet tenant from a customer at its id by its name, and a slug would mint it a free
  // subdomain (a domain the deploy also takes for a customer's). Renaming it or giving it a slug would stop every later deploy.
  if (isFleetTenant(tenantId) && ((data.name !== undefined && data.name !== FLEET_TENANT_NAME) || data.slug)) {
    throw new AppError(FLEET_IDENTITY_FIXED, 409, ErrorCode.CONFLICT);
  }
  if (data.slug && !isReservedTenant(tenantId) && isReservedSubdomainLabel(data.slug)) {
    throw new AppError(SLUG_RESERVED, 422, ErrorCode.VALIDATION_ERROR);
  }
  // A changed slug follows the label rule (owner 2026-11-04); the same short slug sent back unchanged is kept.
  if (data.slug && !isReservedTenant(tenantId) && tenantLabelProblem(data.slug) && data.slug !== await currentSlug(tenantId)) {
    throw new AppError(SLUG_INVALID, 422, ErrorCode.VALIDATION_ERROR);
  }
  if (data.slug && await slugTaken(data.slug, tenantId)) throw new AppError(SLUG_TAKEN, 409, ErrorCode.CONFLICT);

  let tenant: TenantEntity;
  let updated: TenantEntity | null;
  let ends: SessionEndInTx | null;
  let drops: Awaited<ReturnType<typeof recordTenantCacheDrop>>;
  try {
    ({ tenant, updated, ends, drops } = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(TenantEntity);
      const tenant = await repo.findOne({ where: { tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new AppError(TenantMessages.TENANT_NOT_FOUND, 404, ErrorCode.TENANT_NOT_FOUND);
      if (data.tenantStatus !== undefined && data.tenantStatus !== tenant.tenantStatus && CONTRACT_STATUSES.has(tenant.tenantStatus)) {
        throw new AppError(`Tenant is ${tenant.tenantStatus}: only the migration flow changes its status`, 409, ErrorCode.CONFLICT);
      }
      // A tenant with a country takes its bloc from it: a `region` sent alone would leave the two disagreeing (pricing walks the country), so it is refused
      // unless it is the bloc the country already gives. Moving the price list is a country change.
      if (input.region !== undefined && input.countryCode === undefined && tenant.countryCode && (input.region ?? null) !== regionForCountry(tenant.countryCode)) {
        throw new AppError(REGION_FOLLOWS_COUNTRY, 422, ErrorCode.VALIDATION_ERROR);
      }
      // (41-ui-fixes/09 A1.2) a scheduled deletion is left only through its own cancel, which clears the horizon and records RESTORED:
      // Archive used to drop it silently, and Set Active left a stale deleteAfter behind.
      if (data.tenantStatus !== undefined && data.tenantStatus !== tenant.tenantStatus && tenant.tenantStatus === 'PENDING_DELETION') {
        throw new AppError(TENANT_PENDING_DELETION, 409, ErrorCode.CONFLICT);
      }
      // (41-ui-fixes/09 A1.3, A3.3) a legacy DELETED row is not brought back by a PUT: no flow restores it (no horizon, no RESTORED
      // record), and the console offers no status change on it. A rename still goes through.
      if (data.tenantStatus !== undefined && data.tenantStatus !== tenant.tenantStatus && tenant.tenantStatus === 'DELETED') {
        throw new AppError(TENANT_DELETED, 409, ErrorCode.CONFLICT);
      }
      await repo.update({ tenantId, deletedAt: IsNull() }, data as Parameters<Repository<TenantEntity>['update']>[1]);
      const updated = await repo.findOne({ where: { tenantId } });
      // D270: the cached profile (an API key's standing check reads its status) is dropped with this commit, also through a Redis outage
      const drops = await recordTenantCacheDrop(qr, tenantId);
      // D249: a suspension's session-ending orders (every live socket of the tenant) in this transaction
      const ends = updated!.tenantStatus === 'SUSPENDED' && tenant.tenantStatus !== 'SUSPENDED'
        ? await recordSessionEndInTx(qr, { type: 'tenant_access_ended', tenantId, reason: 'suspended' })
        : null;
      // A change of country moves the price list, so its audit row is written strictly, inside the transaction: a failed write refuses (503) and rolls
      // the change back, never a repriced tenant with no 'tenant.country.changed' row (the other tenant audits stay best effort).
      if (data.countryCode !== undefined && (updated!.countryCode ?? null) !== (tenant.countryCode ?? null)) {
        await AuditLogService.log({
          tenantId,
          actorId: actorId ?? null,
          actorType: actorId ? 'USER' : 'SYSTEM',
          action: 'tenant.country.changed',
          resourceType: 'Tenant',
          resourceId: tenantId,
          metadata: {
            from: tenant.countryCode ?? null,
            to: updated!.countryCode ?? null,
            fromSource: tenant.countrySource ?? null,
            regionFrom: tenant.region ?? null,
            regionTo: updated!.region ?? null,
          },
        }, { strict: true });
      }
      return { tenant, updated, ends, drops };
    }));
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(SLUG_TAKEN, 409, ErrorCode.CONFLICT);
    throw err;
  }
  await clearCache(tenantId);
  await deliverTenantCacheDrop(drops);
  // after the tenant cache, so a reconnect is judged as suspended; the relay has the orders otherwise
  await ends?.afterCommit();

  await WebhookService.dispatchEvent(tenantId, 'tenant.updated', {
    tenantId,
    name: updated!.name,
    tenantStatus: updated!.tenantStatus,
  });
  auditTenant(tenantId, actorId, 'tenant.updated', {
    fields: Object.keys(data),
    tenantStatus: updated!.tenantStatus,
  });
  // A real change of country (audited above, inside the transaction): the owners are told. The running subscription keeps its price and currency
  // until its next renewal (docs/phases/49-country-pricing section 7, answer 2): nothing is repriced here.
  if (data.countryCode !== undefined && (updated!.countryCode ?? null) !== (tenant.countryCode ?? null)) {
    await notifyOwnersCountryChanged(tenantId, updated!.countryCode ?? null);
  }
  if (updated!.tenantStatus === 'SUSPENDED' && tenant.tenantStatus !== 'SUSPENDED') {
    await WebhookService.dispatchPlatformEvent('tenant.suspended', {
      tenantId,
      name: updated!.name,
    });
    auditTenant(tenantId, actorId, 'tenant.suspended', {
      previousStatus: tenant.tenantStatus,
    });
  }
  // Immediate effect (05 section 7 stage 7): the request path refuses a suspended tenant by itself; listeners end what is already
  // open, its sessions and live sockets (tenant_session, websocket_session), and lift on resume what must not outlive the suspension.
  if (updated!.tenantStatus === 'SUSPENDED' && tenant.tenantStatus !== 'SUSPENDED') await announceSuspension({ tenantId, suspended: true });
  if (tenant.tenantStatus === 'SUSPENDED' && updated!.tenantStatus !== 'SUSPENDED') await announceSuspension({ tenantId, suspended: false });
  // The two moves the fleet directory mirrors (05 section 7 stage 7): reported whoever made them (an operator here, the directory's command, a migration).
  if (tenant.tenantStatus === 'ACTIVE' && updated!.tenantStatus === 'SUSPENDED') await recordLifecycle({ tenantId, type: 'SUSPENDED', occurredAt: updated!.updatedAt ?? new Date(), ...orderedBy(ends, tenantId) });
  if (tenant.tenantStatus === 'SUSPENDED' && updated!.tenantStatus === 'ACTIVE') await recordLifecycle({ tenantId, type: 'RESUMED', occurredAt: updated!.updatedAt ?? new Date() });
  // Something may be named after the slug: tenant_domain's free <slug>.<wildcard> subdomain follows it (point `tenant:slug_changed`).
  if (data.slug !== undefined && (updated!.slug ?? null) !== (tenant.slug ?? null)) {
    await announceSlugChange({ tenantId, previousSlug: tenant.slug ?? null, slug: updated!.slug ?? null });
  }
  return SafeTenantSchema.parse(updated!);
}

/**
 * Tell a tenant's OWNERs that the operator changed its country (and so, from the next renewal, its price list and payment options). Best effort: a
 * notification failure is logged and never undoes the change.
 */
async function notifyOwnersCountryChanged(tenantId: string, countryCode: string | null): Promise<void> {
  try {
    const { members } = await TenantMemberService.getByTenantId({ tenantId, page: 1, pageSize: 50, search: null, memberRole: 'OWNER', memberStatus: null });
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
    for (const owner of members) {
      await NotificationService.notify(
        tenantId,
        { userId: owner.userId, email: owner.user?.email },
        {
          event: 'tenant.country_changed',
          category: 'billing',
          // English, then Turkish: the notification layer takes literal text and the default country is TR (a per-recipient language needs the layer to take keys)
          title: 'Your organization\'s country was changed / Kuruluşunuzun ülkesi değiştirildi',
          body: `The platform operator set your organization's country to ${countryCode ?? 'none'}. Your current plan keeps its price until it renews; the price list and payment options of the new country apply from the next renewal. / Platform operatörü kuruluşunuzun ülkesini ${countryCode ?? 'belirsiz'} olarak ayarladı. Mevcut planınız yenilenene kadar fiyatını korur; yeni ülkenin fiyat listesi ve ödeme seçenekleri bir sonraki yenilemeden itibaren geçerli olur.`,
          data: { path: '/admin/subscription' },
        },
        { idempotencyKey: `tenant-country-changed:${tenantId}:${countryCode ?? 'none'}:${Date.now()}:${owner.userId}` },
      ).catch((err: unknown) => Logger.warn(`[tenant] country-change notice to ${owner.userId} failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  } catch (err) {
    Logger.warn(`[tenant] country-change notice failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function provisionPersonal(userId: string, email: string): Promise<SafeTenant> {
  const name = email.split('@')[0];
  // Generate slug from email prefix
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || undefined;

  // Ensure slug uniqueness. The partial unique index is the real arbiter: a
  // concurrent signup with the same email prefix used to fail registration
  // with a 500 — now it falls back to a suffixed slug.
  let finalSlug: string | undefined = slug;
  // A reserved label (a user called "admin@...") gets the suffixed form straight away.
  // So does a prefix shorter than a label may be (`bob@...`: 5 characters at least, owner 2026-11-04).
  if (slug && (slug.length < TENANT_LABEL_MIN || isReservedSubdomainLabel(slug) || await slugTaken(slug))) finalSlug = `${slug}-${Date.now()}`;

  // A self-serve signup creates a customer tenant: capped like any other (fleet 3b.11, S11).
  const cap = await tenantCeiling();
  const insert = (s: string | undefined) => withSystemRLS(async (qr) => {
    await enforceTenantCeiling(qr, cap, { actorId: userId, path: 'personal' });
    const repo = qr.manager.getRepository(TenantEntity);
    return repo.save(repo.create({ name, tenantStatus: 'ACTIVE', slug: s }));
  });
  let saved: TenantEntity;
  try {
    saved = await insert(finalSlug);
  } catch (err) {
    if (!slug || !isUniqueViolation(err)) throw err;
    saved = await insert(`${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  }

  await TenantMemberService.create({
    tenantId: saved.tenantId,
    userId,
    memberRole: 'OWNER',
    memberStatus: 'ACTIVE',
  });

  const parsed = SafeTenantSchema.parse(saved);
  await seedDefaults(parsed.tenantId);
  // A self-serve signup: on a fleet node this is how the directory learns the id (it registers by the PROVISIONED receipt).
  await recordLifecycle({ tenantId: parsed.tenantId, type: 'PROVISIONED', occurredAt: saved.createdAt ?? new Date() });
  return parsed;
}

export async function remove(tenantId: string, actorId?: string): Promise<void> {
  const tenant = await withTenantRepositoryFor(tenantId, TenantEntity, (repo) =>
    repo.findOne({ where: { tenantId, deletedAt: IsNull() } }));
  if (!tenant) throw new AppError(TenantMessages.TENANT_NOT_FOUND, 404, ErrorCode.TENANT_NOT_FOUND);
  // The row's own objections first (legal hold, migration, tombstone), then every `tenant:deletion_guard` contributor —
  // see tenant.deletion-guard.ts for why that is a seam, not a call.
  assertNoFleetDeletionBlock(tenant);
  await assertDeletionAllowed(tenantId);
  // Conditional: two concurrent deletes announce `tenant.deleted` once.
  const { res, drops } = await withTenantRepositoryFor(tenantId, TenantEntity, async (repo) => {
    const res = await repo.update({ tenantId, deletedAt: IsNull() }, { deletedAt: new Date() });
    return { res, drops: res.affected ? await recordTenantCacheDrop(repo.manager?.queryRunner, tenantId) : [] };
  });
  if (!res.affected) throw new AppError(TenantMessages.TENANT_NOT_FOUND, 404, ErrorCode.TENANT_NOT_FOUND);
  await clearCache(tenantId);
  await deliverTenantCacheDrop(drops);
  await WebhookService.dispatchPlatformEvent('tenant.deleted', {
    tenantId,
    name: tenant.name,
  });
  auditTenant(tenantId, actorId, 'tenant.deleted', { name: tenant.name });
}

/**
 * Verify tenant isolation: run a cross-tenant query check.
 * Returns any tenantId values found in the given table that differ from the expected tenant.
 * Use in integration tests / scheduled audits to detect missing WHERE clauses.
 */
export async function verifyIsolation(tenantId: string, tableName: string): Promise<{ ok: boolean; leakedRows: number }> {
  // The name is interpolated into SQL (identifiers cannot be bound): accept a
  // plain identifier only.
  if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) throw new AppError('Invalid table name', 400, ErrorCode.VALIDATION_ERROR);
  try {
    // Run inside the tenant's chokepoint block: this is exactly what a tenant
    // block can see, so under RLS the check proves the isolation it names.
    const rows = await withTenantTransactionFor(tenantId, (qr) => qr.query(
      `SELECT COUNT(*) as count FROM "${tableName}" WHERE "tenantId" IS NOT NULL AND "tenantId" != $1`,
      [tenantId],
    ));
    const leakedRows = parseInt(rows[0]?.count ?? '0', 10);
    return { ok: leakedRows === 0, leakedRows };
  } catch {
    return { ok: true, leakedRows: 0 }; // table may not have tenantId column — not a leak
  }
}
