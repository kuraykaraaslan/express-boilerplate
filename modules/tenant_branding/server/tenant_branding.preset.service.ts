import 'reflect-metadata'
import { tenantDataSourceFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { Tenant } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity'
import { TenantMember } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity'
import { BrandingPreset } from './entities/branding_presets.entity'
import TenantBrandingService from './tenant_branding.service'
import { TENANT_BRANDING_KEYS } from './tenant_branding.setting.keys'
import type { TenantBranding } from './tenant_branding.types'

export const PRESET_MESSAGES = {
  PRESET_NOT_FOUND: 'Branding preset not found',
  PRESET_NOT_YOURS: 'That preset belongs to somebody else',
  PRESET_INACTIVE: 'That preset has been switched off',
  PRESET_NAME_REQUIRED: 'A preset needs a name',
  TARGET_NOT_FOUND: 'Target workspace not found',
  TARGET_FORBIDDEN: 'You do not administer the target workspace',
} as const

/**
 * The keys a preset may carry: the branding allow-list minus `customJs`. Script is never copied between workspaces:
 * a preset applied onto another tenant (ROOT included) would otherwise plant the preset author's code into that
 * tenant's pages (F.branding.01 / tenant_branding.01, fixed 2026-10-20).
 */
const PRESET_KEYS = TENANT_BRANDING_KEYS.filter((k) => k !== 'customJs')

/** Member roles that may overwrite a workspace's brand from a preset owned by another tenant. */
const TARGET_ADMIN_ROLES = new Set(['OWNER', 'ADMIN'])

/**
 * Named branding bundles, and copying one onto a tenant.
 *
 * ### Cloning is a copy, never a live link
 *
 * `clonePreset` writes the preset's values onto the target tenant's settings and
 * then forgets about it. If the client later changes their own colour, the
 * preset does not take it back — the brand belongs to the client's workspace,
 * not to whoever set it up. An agency that wants "re-apply this preset to
 * everyone" is asking for a separate and explicitly destructive action, not a
 * silent sync, and this service does not pretend otherwise.
 *
 * ### Ownership is checked, not assumed
 *
 * Every write takes an `ownerTenantId` and refuses a preset belonging to
 * somebody else. The presets of two agencies live in the same table; the only
 * thing keeping them apart is this check and the index behind it.
 */
export default class TenantBrandingPresetService {
  static async list(ownerTenantId: string, includeInactive = false): Promise<BrandingPreset[]> {
    const ds = await tenantDataSourceFor(ownerTenantId)
    return ds.getRepository(BrandingPreset).find({
      where: includeInactive ? { ownerTenantId } : { ownerTenantId, isActive: true },
      order: { name: 'ASC' },
    })
  }

  static async getById(ownerTenantId: string, brandingPresetId: string): Promise<BrandingPreset> {
    const ds = await tenantDataSourceFor(ownerTenantId)
    const row = await ds.getRepository(BrandingPreset).findOne({ where: { brandingPresetId } })
    if (!row) throw new AppError(PRESET_MESSAGES.PRESET_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    // A wrong owner answers like a missing row on the read path too, so the
    // endpoint cannot be used to find out which preset ids exist.
    if (row.ownerTenantId !== ownerTenantId) {
      throw new AppError(PRESET_MESSAGES.PRESET_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    }
    return row
  }

  static async create(
    ownerTenantId: string,
    input: { name: string; description?: string | null; values?: Record<string, string> },
    actorId?: string,
  ): Promise<BrandingPreset> {
    if (!input.name?.trim()) {
      throw new AppError(PRESET_MESSAGES.PRESET_NAME_REQUIRED, 422, ErrorCode.VALIDATION_ERROR)
    }
    const ds = await tenantDataSourceFor(ownerTenantId)
    const repo = ds.getRepository(BrandingPreset)
    const saved = await repo.save(repo.create({
      ownerTenantId,
      name: input.name.trim(),
      description: input.description ?? null,
      values: TenantBrandingPresetService.pick(input.values ?? {}),
      isActive: true,
      createdByUserId: actorId ?? null,
    }))
    audit(ownerTenantId, actorId, 'tenant_branding.preset_created', saved.brandingPresetId, {
      name: saved.name,
    })
    return saved
  }

  /**
   * Snapshot a tenant's live branding into a new preset.
   *
   * The obvious way to make one: get the look right on a workspace, then keep
   * it. Typing twelve settings into a form a second time is how the preset ends
   * up subtly different from the thing it was supposed to capture.
   */
  static async captureFrom(
    ownerTenantId: string,
    sourceTenantId: string,
    input: { name: string; description?: string | null },
    actorId?: string,
  ): Promise<BrandingPreset> {
    const branding = await TenantBrandingService.get(sourceTenantId)
    return TenantBrandingPresetService.create(ownerTenantId, {
      ...input,
      values: TenantBrandingPresetService.pick(branding as unknown as Record<string, string>),
    }, actorId)
  }

  static async update(
    ownerTenantId: string,
    brandingPresetId: string,
    input: { name?: string; description?: string | null; values?: Record<string, string>; isActive?: boolean },
    actorId?: string,
  ): Promise<BrandingPreset> {
    const row = await TenantBrandingPresetService.getById(ownerTenantId, brandingPresetId)
    if (input.name !== undefined) row.name = input.name.trim()
    if (input.description !== undefined) row.description = input.description
    if (input.values !== undefined) row.values = TenantBrandingPresetService.pick(input.values)
    if (input.isActive !== undefined) row.isActive = input.isActive

    const ds = await tenantDataSourceFor(ownerTenantId)
    const saved = await ds.getRepository(BrandingPreset).save(row)
    audit(ownerTenantId, actorId, 'tenant_branding.preset_updated', brandingPresetId, {
      changed: Object.keys(input),
    })
    return saved
  }

  /**
   * Delete a preset.
   *
   * Nothing is checked about who is *using* it, because nothing is: a client
   * carries a copy of the values, not a link to this row. Deleting a preset can
   * therefore never change how an existing workspace looks — which is the whole
   * argument for cloning rather than referencing.
   */
  static async remove(ownerTenantId: string, brandingPresetId: string, actorId?: string): Promise<void> {
    await TenantBrandingPresetService.getById(ownerTenantId, brandingPresetId)
    const ds = await tenantDataSourceFor(ownerTenantId)
    await ds.getRepository(BrandingPreset).softDelete({ brandingPresetId })
    audit(ownerTenantId, actorId, 'tenant_branding.preset_deleted', brandingPresetId, {})
  }

  /**
   * Copy a preset onto a tenant.
   *
   * A settings `updateMany` through the branding service, so every value goes
   * through the same sanitiser and validator a human edit does — a preset must
   * not be a way to smuggle unsanitised CSS or a `javascript:` URL onto a
   * workspace.
   */
  static async clonePreset(
    ownerTenantId: string,
    brandingPresetId: string,
    targetTenantId: string,
    actorId?: string,
  ): Promise<TenantBranding> {
    const preset = await TenantBrandingPresetService.getById(ownerTenantId, brandingPresetId)
    if (!preset.isActive) throw new AppError(PRESET_MESSAGES.PRESET_INACTIVE, 409, ErrorCode.CONFLICT)
    if (targetTenantId !== ownerTenantId) {
      await TenantBrandingPresetService.assertMayApplyTo(ownerTenantId, targetTenantId, actorId)
    }

    const applied = await TenantBrandingService.update(
      targetTenantId,
      TenantBrandingPresetService.pick(preset.values ?? {}) as Partial<TenantBranding>,
      actorId,
    )
    audit(ownerTenantId, actorId, 'tenant_branding.preset_applied', brandingPresetId, {
      targetTenantId,
      keys: Object.keys(preset.values ?? {}),
    })
    return applied
  }

  /**
   * The apply TARGET is authorized here, not only the preset owner (the URL tenant the route guard checked).
   *
   * Fail closed (F.branding.01, fixed 2026-10-20): the target must exist (404 otherwise, no settings rows for a phantom
   * tenant), the ROOT (platform) tenant is never a target of another tenant's preset, and the caller must be an ACTIVE
   * OWNER or ADMIN member of the target. A call with no actor (a background path) cannot write into another tenant.
   */
  private static async assertMayApplyTo(ownerTenantId: string, targetTenantId: string, actorId?: string): Promise<void> {
    // Read in the TARGET's tenant scope: under RLS an ambient read of `tenants` sees nothing (tenant.sweep-guard).
    const { tenant, member } = await withTenantTransactionFor(targetTenantId, async (qr) => ({
      tenant: await qr.manager.getRepository(Tenant).findOne({ where: { tenantId: targetTenantId } }),
      member: actorId ? await qr.manager.getRepository(TenantMember).findOne({ where: { tenantId: targetTenantId, userId: actorId } }) : null,
    }))
    if (!tenant || tenant.deletedAt) {
      throw new AppError(PRESET_MESSAGES.TARGET_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    }
    if (isRootTenant(targetTenantId) && !isRootTenant(ownerTenantId)) {
      throw new AppError(PRESET_MESSAGES.TARGET_FORBIDDEN, 403, ErrorCode.FORBIDDEN)
    }
    if (!actorId) throw new AppError(PRESET_MESSAGES.TARGET_FORBIDDEN, 403, ErrorCode.FORBIDDEN)
    if (!member || member.deletedAt || member.memberStatus !== 'ACTIVE' || !TARGET_ADMIN_ROLES.has(String(member.memberRole))) {
      throw new AppError(PRESET_MESSAGES.TARGET_FORBIDDEN, 403, ErrorCode.FORBIDDEN)
    }
  }

  /**
   * Best-effort clone for a provisioning path.
   *
   * Returns whether it happened. A workspace that came up with the wrong colours
   * is a fixable annoyance; one that failed to be created because a logo could
   * not be copied is not.
   */
  static async tryClone(
    ownerTenantId: string,
    brandingPresetId: string,
    targetTenantId: string,
    actorId?: string,
  ): Promise<boolean> {
    try {
      await TenantBrandingPresetService.clonePreset(ownerTenantId, brandingPresetId, targetTenantId, actorId)
      return true
    } catch (error) {
      Logger.warn(`[TenantBrandingPresetService.tryClone][tenant:${ownerTenantId}] ${error}`)
      return false
    }
  }

  /**
   * Keep only keys this module still recognises.
   *
   * A preset saved a year ago must not be able to write back a setting that has
   * since been retired, and a caller must not be able to use a preset as a
   * general-purpose settings writer.
   */
  private static pick(values: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const key of PRESET_KEYS) {
      const value = values?.[key]
      if (typeof value === 'string' && value !== '') out[key] = value
    }
    return out
  }
}

function audit(
  tenantId: string,
  actorId: string | undefined,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): void {
  AuditLogService.log({
    tenantId,
    actorType: actorId ? 'USER' : 'SYSTEM',
    actorId: actorId ?? null,
    action,
    resourceType: 'branding_preset',
    resourceId,
    metadata: { tenantId, ...metadata },
  })
}
